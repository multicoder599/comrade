import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, ne, or, gte, lt, inArray, sql } from "drizzle-orm";
import { debtPayments, debts, products, saleItems, sales, stocks } from "@db/schema";
import { getDb } from "../queries/connection";
import { createRouter, authedQuery, adminQuery } from "../middleware";
import {
  checkTransactionStatus,
  initiateStkPush,
  isMegaPayReady,
  MegaPayError,
} from "../megapay";
import { log } from "../lib/logger";

const lineInput = z.object({
  productId: z.number().int(),
  qty: z.number().positive(),
  priceType: z.enum(["retail", "wholesale"]).default("retail"),
  unitPrice: z.number().int().min(0), // cents — may differ from list price (bargain)
});

function receiptNo(shop: string, id: number): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `${shop}-${ymd}-${String(id).padStart(4, "0")}`;
}

type Db = ReturnType<typeof getDb>;
type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

function restockTx(t: DbOrTx, sale: { id: number; shop: string }) {
  const items = t.select().from(saleItems).where(eq(saleItems.saleId, sale.id)).all();
  for (const item of items) {
    t.update(stocks)
      .set({ qty: sql`${stocks.qty} + ${item.qty}` })
      .where(and(eq(stocks.productId, item.productId), eq(stocks.shop, sale.shop)))
      .run();
  }
}

function debtStatus(amount: number, paid: number): "open" | "partial" | "settled" {
  return paid >= amount ? "settled" : paid > 0 ? "partial" : "open";
}

/** Store credit: what the customer overpaid before, minus credit already used. */
export function customerCredit(db: DbOrTx, shop: "A" | "B", phone: string): number {
  const rows = db
    .select()
    .from(debts)
    .where(
      and(
        eq(debts.shop, shop),
        eq(debts.customerPhone, phone),
        ne(debts.status, "cancelled"),
      ),
    )
    .all();
  let overpaid = 0;
  for (const d of rows) overpaid += Math.max(0, d.amountPaid - d.amount);
  const ids = rows.map((d) => d.id);
  let consumed = 0;
  if (ids.length > 0) {
    const row = db
      .select({ total: sql<number>`coalesce(sum(${debtPayments.amount}), 0)` })
      .from(debtPayments)
      .where(
        and(
          inArray(debtPayments.debtId, ids),
          eq(debtPayments.method, "credit"),
        ),
      )
      .get();
    consumed = row?.total ?? 0;
  }
  return Math.max(0, overpaid - consumed);
}

type PreparedLine = {
  productId: number;
  name: string;
  qty: number;
  priceType: "retail" | "wholesale";
  unitPrice: number;
  listPrice: number;
  buyingPrice: number;
  lineTotal: number;
};

export const salesRouter = createRouter({
  checkout: authedQuery
    .input(
      z.object({
        paymentMethod: z.enum(["cash", "megapay", "split", "debt"]),
        lines: z.array(lineInput).min(1),
        discount: z.number().int().min(0).default(0),
        tendered: z.number().int().min(0).optional(),
        // Split payments: the cash part; the rest goes to M-Pesa.
        cashAmount: z.number().int().min(0).optional(),
        customerName: z.string().max(80).optional(),
        customerPhone: z.string().max(20).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const user = ctx.user;
      const shop = user.role === "cashier" ? user.shop : null;
      if (!shop) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Admins cannot sell from the till — log in as a shop cashier",
        });
      }
      const needsMpesa =
        input.paymentMethod === "megapay" || input.paymentMethod === "split";
      if (
        input.paymentMethod === "debt" &&
        (!input.customerName?.trim() || !input.customerPhone?.trim())
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Debt sales need the customer's name and phone number",
        });
      }

      // Validate lines against the live catalogue and compute totals.
      const ids = input.lines.map((l) => l.productId);
      const catalog = db.select().from(products).where(inArray(products.id, ids)).all();
      const byId = new Map(catalog.map((p) => [p.id, p]));

      const lines: PreparedLine[] = [];
      for (const l of input.lines) {
        const p = byId.get(l.productId);
        if (!p || !p.active) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Product #${l.productId} is not available` });
        }
        const listPrice =
          l.priceType === "retail" ? p.retailPrice : p.wholesalePrice;
        if (l.unitPrice !== listPrice && !p.allowBargain && user.role !== "admin") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Price of "${p.name}" cannot be adjusted`,
          });
        }
        const stock = db
          .select()
          .from(stocks)
          .where(and(eq(stocks.productId, p.id), eq(stocks.shop, shop)))
          .get();
        const available = stock?.qty ?? 0;
        if (available < l.qty) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Not enough stock for "${p.name}" in Shop ${shop} (${available} ${p.unit} left)`,
          });
        }
        lines.push({
          productId: p.id,
          name: p.name,
          qty: l.qty,
          priceType: l.priceType,
          unitPrice: l.unitPrice,
          listPrice,
          buyingPrice: p.buyingPrice,
          lineTotal: Math.round(l.unitPrice * l.qty),
        });
      }

      const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
      if (input.discount > subtotal) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Discount is more than the total" });
      }
      const total = subtotal - input.discount;
      const mode = lines.some((l) => l.priceType === "wholesale")
        ? ("wholesale" as const)
        : ("retail" as const);
      const now = new Date().toISOString();

      // Insert sale + lines, decrement stock, remember each product's last
      // sold price (tracks bargained prices).
      function insertSaleTx(
        t: DbOrTx,
        fields: {
          status: "completed" | "pending";
          paymentMethod: "cash" | "megapay" | "split" | "debt";
          tendered?: number | null;
          change?: number | null;
          cashAmount?: number | null;
          mpesaAmount?: number | null;
          mpesaRequestId?: string | null;
          mpesaReference?: string | null;
          debtId?: number | null;
        },
      ): number {
        const info = t
          .insert(sales)
          .values({
            receiptNo: fields.mpesaRequestId ?? "TMP",
            shop,
            cashierId: user.id,
            cashierName: user.displayName,
            mode,
            paymentMethod: fields.paymentMethod,
            status: fields.status,
            subtotal,
            discount: input.discount,
            total,
            tendered: fields.tendered ?? null,
            change: fields.change ?? null,
            cashAmount: fields.cashAmount ?? null,
            mpesaAmount: fields.mpesaAmount ?? null,
            customerName: input.customerName?.trim() || null,
            customerPhone: input.customerPhone?.trim() || null,
            debtId: fields.debtId ?? null,
            mpesaRequestId: fields.mpesaRequestId ?? null,
            mpesaReference: fields.mpesaReference ?? null,
          })
          .run();
        const id = Number(info.lastInsertRowid);
        t.update(sales).set({ receiptNo: receiptNo(shop, id) }).where(eq(sales.id, id)).run();
        for (const l of lines) {
          t.insert(saleItems).values({ saleId: id, ...l }).run();
          t.update(stocks)
            .set({ qty: sql`${stocks.qty} - ${l.qty}` })
            .where(and(eq(stocks.productId, l.productId), eq(stocks.shop, shop)))
            .run();
          t.update(products)
            .set({ lastSoldPrice: l.unitPrice, updatedAt: now })
            .where(eq(products.id, l.productId))
            .run();
        }
        return id;
      }

      // --- Debt path: goods leave now, customer pays later. If the customer
      // already has a running tab, this purchase is added to it; any store
      // credit from previous overpayments is applied automatically. ---
      if (input.paymentMethod === "debt") {
        const phone = input.customerPhone!.trim();
        const name = input.customerName!.trim();
        const credit = customerCredit(db, shop, phone);
        const creditApplied = Math.min(credit, total);

        const saleId = db.transaction((t) => {
          const existing = t
            .select()
            .from(debts)
            .where(
              and(
                eq(debts.shop, shop),
                eq(debts.customerPhone, phone),
                or(eq(debts.status, "open"), eq(debts.status, "partial")),
              ),
            )
            .orderBy(desc(debts.id))
            .get();

          let debtId: number;
          if (existing) {
            debtId = existing.id;
            const amount = existing.amount + total;
            const paid = existing.amountPaid + creditApplied;
            t.update(debts)
              .set({ amount, amountPaid: paid, status: debtStatus(amount, paid), updatedAt: now })
              .where(eq(debts.id, debtId))
              .run();
          } else {
            const info = t
              .insert(debts)
              .values({
                shop,
                customerName: name,
                customerPhone: phone,
                saleId: null,
                amount: total,
                amountPaid: creditApplied,
                status: debtStatus(total, creditApplied),
                createdAt: now,
                updatedAt: now,
              })
              .run();
            debtId = Number(info.lastInsertRowid);
          }
          if (creditApplied > 0) {
            t.insert(debtPayments)
              .values({
                debtId,
                amount: creditApplied,
                method: "credit",
                cashierName: user.displayName,
                createdAt: now,
              })
              .run();
          }
          const id = insertSaleTx(t, {
            status: "completed",
            paymentMethod: "debt",
            debtId,
          });
          // Keep debts.sale_id pointing at the first sale (legacy reads).
          t.update(debts)
            .set({ saleId: sql`coalesce(${debts.saleId}, ${id})` })
            .where(eq(debts.id, debtId))
            .run();
          return id;
        });

        const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()!;
        log.info("debt sale recorded", { saleId, shop, customer: name, creditApplied });
        return { sale, items: lines, stkMessage: null as string | null, creditApplied };
      }

      // --- MegaPay / split path: STK push first, then a pending sale ---
      if (needsMpesa) {
        if (!isMegaPayReady(shop)) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              shop === "A"
                ? "MegaPay is not configured for Shop A yet (MEGAPAY_API_KEY / MEGAPAY_EMAIL)"
                : "MegaPay is not configured for Shop B yet (MEGAPAY_B_API_KEY / MEGAPAY_B_EMAIL)",
          });
        }
        let cashPart = 0;
        let tendered: number | null = null;
        let change: number | null = null;
        if (input.paymentMethod === "split") {
          cashPart = input.cashAmount ?? 0;
          if (cashPart <= 0 || cashPart >= total) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Split needs a cash part that is less than the total — use Cash or M-Pesa instead",
            });
          }
          tendered = input.tendered ?? cashPart;
          if (tendered < cashPart) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Cash tendered is less than the cash part",
            });
          }
          change = tendered - cashPart;
        }
        const mpesaPart = total - cashPart;
        const reference = `COMRADE-${shop}-${Date.now()}`;
        let push: { requestId: string; message: string };
        try {
          push = await initiateStkPush({
            shop,
            amountKes: Math.max(1, Math.round(mpesaPart / 100)),
            phone: input.customerPhone ?? "",
            reference,
            description: `Comrade Shop ${shop} Checkout`,
          });
        } catch (err) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: err instanceof MegaPayError ? err.message : "MegaPay request failed",
          });
        }
        const saleId = db.transaction((t) =>
          insertSaleTx(t, {
            status: "pending",
            paymentMethod: input.paymentMethod,
            tendered,
            change,
            cashAmount: input.paymentMethod === "split" ? cashPart : null,
            mpesaAmount: mpesaPart,
            mpesaRequestId: push.requestId,
            mpesaReference: reference,
          }),
        );
        const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()!;
        log.info("megapay stk push sent", { saleId, shop, split: input.paymentMethod === "split" });
        return { sale, items: lines, stkMessage: push.message, creditApplied: 0 };
      }

      // --- Cash path: complete immediately ---
      const tendered = input.tendered ?? total;
      if (tendered < total) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Tendered amount is less than the total" });
      }
      const saleId = db.transaction((t) =>
        insertSaleTx(t, {
          status: "completed",
          paymentMethod: "cash",
          tendered,
          change: tendered - total,
          cashAmount: total,
        }),
      );
      const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()!;
      return { sale, items: lines, stkMessage: null as string | null, creditApplied: 0 };
    }),

  // Poll the state of a pending MegaPay sale (also called after the webhook).
  refreshPayment: authedQuery
    .input(z.object({ saleId: z.number().int() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const sale = db.select().from(sales).where(eq(sales.id, input.saleId)).get();
      if (!sale) throw new TRPCError({ code: "NOT_FOUND" });
      if (sale.status !== "pending" || !sale.mpesaRequestId) return sale;
      try {
        const status = await checkTransactionStatus(
          sale.shop as "A" | "B",
          sale.mpesaRequestId,
        );
        if (status.state === "success") {
          db.update(sales)
            .set({ status: "completed", mpesaReceipt: status.receipt ?? null })
            .where(eq(sales.id, sale.id))
            .run();
        } else if (status.state === "failed") {
          db.transaction((t) => {
            t.update(sales).set({ status: "failed" }).where(eq(sales.id, sale.id)).run();
            restockTx(t, sale);
          });
        }
      } catch (err) {
        log.error("megapay status check failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return db.select().from(sales).where(eq(sales.id, sale.id)).get()!;
    }),

  list: authedQuery
    .input(
      z.object({
        shop: z.enum(["A", "B"]).optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        status: z.enum(["completed", "pending", "failed", "cancelled"]).optional(),
        limit: z.number().int().min(1).max(500).default(100),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(({ ctx, input }) => {
      const db = getDb();
      const shop = ctx.user.role === "cashier" ? (ctx.user.shop ?? undefined) : input.shop;
      const conds = [
        shop ? eq(sales.shop, shop) : undefined,
        input.status ? eq(sales.status, input.status) : undefined,
        input.from ? gte(sales.createdAt, input.from) : undefined,
        input.to ? lt(sales.createdAt, input.to) : undefined,
      ].filter(Boolean);
      return db
        .select()
        .from(sales)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(sales.id))
        .limit(input.limit)
        .offset(input.offset)
        .all();
    }),

  get: authedQuery
    .input(z.object({ id: z.number().int() }))
    .query(({ ctx, input }) => {
      const db = getDb();
      const sale = db.select().from(sales).where(eq(sales.id, input.id)).get();
      if (!sale) throw new TRPCError({ code: "NOT_FOUND" });
      if (ctx.user.role === "cashier" && sale.shop !== ctx.user.shop) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const items = db.select().from(saleItems).where(eq(saleItems.saleId, sale.id)).all();
      return { sale, items };
    }),

  cancel: authedQuery
    .input(z.object({ saleId: z.number().int() }))
    .mutation(({ ctx, input }) => {
      const db = getDb();
      const sale = db.select().from(sales).where(eq(sales.id, input.saleId)).get();
      if (!sale) throw new TRPCError({ code: "NOT_FOUND" });
      if (ctx.user.role === "cashier" && sale.shop !== ctx.user.shop) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      if (sale.status === "cancelled") return sale;
      db.transaction((t) => {
        t.update(sales).set({ status: "cancelled" }).where(eq(sales.id, sale.id)).run();
        reverseSaleEffects(t, sale);
      });
      return db.select().from(sales).where(eq(sales.id, sale.id)).get()!;
    }),

  // Owner corrections: fix a transaction's payment method, status or customer
  // details without touching the database by hand. Setting status to
  // "cancelled" performs the full void (stock restored, debt reduced).
  update: adminQuery
    .input(
      z.object({
        id: z.number().int(),
        paymentMethod: z.enum(["cash", "megapay", "split", "debt"]).optional(),
        status: z
          .enum(["completed", "pending", "failed", "cancelled"])
          .optional(),
        customerName: z.string().max(80).nullable().optional(),
        customerPhone: z.string().max(30).nullable().optional(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDb();
      const sale = db.select().from(sales).where(eq(sales.id, input.id)).get();
      if (!sale) throw new TRPCError({ code: "NOT_FOUND" });
      if (
        sale.debtId &&
        input.paymentMethod &&
        input.paymentMethod !== sale.paymentMethod
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This sale is linked to a customer debt — void or delete it instead of changing the payment method.",
        });
      }
      db.transaction((t) => {
        const cancelling =
          input.status === "cancelled" && sale.status !== "cancelled";
        t.update(sales)
          .set({
            ...(input.paymentMethod
              ? { paymentMethod: input.paymentMethod }
              : {}),
            ...(input.status ? { status: input.status } : {}),
            ...(input.customerName !== undefined
              ? { customerName: input.customerName }
              : {}),
            ...(input.customerPhone !== undefined
              ? { customerPhone: input.customerPhone }
              : {}),
          })
          .where(eq(sales.id, sale.id))
          .run();
        if (cancelling) reverseSaleEffects(t, sale);
      });
      return db.select().from(sales).where(eq(sales.id, input.id)).get()!;
    }),

  // Permanently delete a transaction: stock goes back on the shelf, any linked
  // debt is reduced (and removed entirely if it drops to zero with no
  // payments), and the sale disappears from reports.
  remove: adminQuery
    .input(z.object({ id: z.number().int() }))
    .mutation(({ input }) => {
      const db = getDb();
      const sale = db.select().from(sales).where(eq(sales.id, input.id)).get();
      if (!sale) throw new TRPCError({ code: "NOT_FOUND" });
      db.transaction((t) => {
        if (sale.status !== "cancelled" && sale.status !== "failed") {
          reverseSaleEffects(t, sale);
        }
        // Clear the legacy debts.sale_id back-link so the sale row can go.
        t.update(debts)
          .set({ saleId: null, updatedAt: new Date().toISOString() })
          .where(eq(debts.saleId, sale.id))
          .run();
        t.delete(saleItems).where(eq(saleItems.saleId, sale.id)).run();
        t.delete(sales).where(eq(sales.id, sale.id)).run();
        if (sale.debtId) {
          const debt = t
            .select()
            .from(debts)
            .where(eq(debts.id, sale.debtId))
            .get();
          if (debt && debt.amount === 0 && debt.amountPaid === 0) {
            t.delete(debtPayments).where(eq(debtPayments.debtId, debt.id)).run();
            t.delete(debts).where(eq(debts.id, debt.id)).run();
          }
        }
      });
      return { ok: true };
    }),
});

// Undo a sale's side effects: put the stock back and pull the amount out of
// the customer's debt tab.
function reverseSaleEffects(
  t: DbOrTx,
  sale: { id: number; shop: string; status: string; paymentMethod: string; debtId: number | null; total: number },
) {
  if (sale.status === "completed" || sale.status === "pending") {
    restockTx(t, sale);
  }
  if (sale.paymentMethod === "debt") {
    if (sale.debtId) {
      const debt = t.select().from(debts).where(eq(debts.id, sale.debtId)).get();
      if (debt && debt.status !== "cancelled") {
        const amount = Math.max(0, debt.amount - sale.total);
        t.update(debts)
          .set({
            amount,
            status: debtStatus(amount, debt.amountPaid),
            updatedAt: new Date().toISOString(),
          })
          .where(eq(debts.id, debt.id))
          .run();
      }
    } else {
      // Legacy rows linked via debts.sale_id
      t.update(debts)
        .set({ status: "cancelled", updatedAt: new Date().toISOString() })
        .where(eq(debts.saleId, sale.id))
        .run();
    }
  }
}
