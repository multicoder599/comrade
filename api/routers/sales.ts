import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, lt, inArray, sql } from "drizzle-orm";
import { debts, products, saleItems, sales, stocks } from "@db/schema";
import { getDb } from "../queries/connection";
import { createRouter, authedQuery } from "../middleware";
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

function restock(db: DbOrTx, saleId: number) {
  const sale = db.select().from(sales).where(eq(sales.id, saleId)).get();
  if (!sale) return;
  const items = db.select().from(saleItems).where(eq(saleItems.saleId, saleId)).all();
  for (const item of items) {
    db.update(stocks)
      .set({ qty: sql`${stocks.qty} + ${item.qty}` })
      .where(and(eq(stocks.productId, item.productId), eq(stocks.shop, sale.shop)))
      .run();
  }
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
      if (needsMpesa && shop !== "A") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "MegaPay is only enabled for Shop A",
        });
      }
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

      // Persist the sale + lines, decrement stock, remember the last sold
      // price of each product (used to track bargained prices).
      function persistSale(fields: {
        status: "completed" | "pending";
        paymentMethod: "cash" | "megapay" | "split" | "debt";
        tendered?: number | null;
        change?: number | null;
        cashAmount?: number | null;
        mpesaAmount?: number | null;
        mpesaRequestId?: string | null;
      }): number {
        return db.transaction((t) => {
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
              mpesaRequestId: fields.mpesaRequestId ?? null,
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
        });
      }

      // --- Debt path: goods leave now, customer pays later ---
      if (input.paymentMethod === "debt") {
        const saleId = persistSale({ status: "completed", paymentMethod: "debt" });
        db.insert(debts)
          .values({
            shop,
            customerName: input.customerName!.trim(),
            customerPhone: input.customerPhone!.trim(),
            saleId,
            amount: total,
            amountPaid: 0,
            status: "open",
            createdAt: now,
            updatedAt: now,
          })
          .run();
        const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()!;
        log.info("debt sale recorded", { saleId, shop, customer: input.customerName });
        return { sale, items: lines, stkMessage: null as string | null };
      }

      // --- MegaPay / split path: STK push first, then a pending sale ---
      if (needsMpesa) {
        if (!isMegaPayReady()) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "MegaPay is not configured on the server yet",
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
            amountKes: Math.max(1, Math.round(mpesaPart / 100)),
            phone: input.customerPhone ?? "",
            reference,
          });
        } catch (err) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: err instanceof MegaPayError ? err.message : "MegaPay request failed",
          });
        }
        const saleId = persistSale({
          status: "pending",
          paymentMethod: input.paymentMethod,
          tendered,
          change,
          cashAmount: input.paymentMethod === "split" ? cashPart : null,
          mpesaAmount: mpesaPart,
          mpesaRequestId: push.requestId,
        });
        const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()!;
        log.info("megapay stk push sent", { saleId, shop, split: input.paymentMethod === "split" });
        return { sale, items: lines, stkMessage: push.message };
      }

      // --- Cash path: complete immediately ---
      const tendered = input.tendered ?? total;
      if (tendered < total) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Tendered amount is less than the total" });
      }
      const saleId = persistSale({
        status: "completed",
        paymentMethod: "cash",
        tendered,
        change: tendered - total,
        cashAmount: total,
      });
      const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()!;
      return { sale, items: lines, stkMessage: null as string | null };
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
        const status = await checkTransactionStatus(sale.mpesaRequestId);
        if (status.state === "success") {
          db.update(sales)
            .set({ status: "completed", mpesaReceipt: status.receipt ?? null })
            .where(eq(sales.id, sale.id))
            .run();
        } else if (status.state === "failed") {
          db.transaction((t) => {
            t.update(sales).set({ status: "failed" }).where(eq(sales.id, sale.id)).run();
            restock(t, sale.id);
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
        if (sale.status === "completed" || sale.status === "pending") {
          restock(t, sale.id);
        }
        // A cancelled debt sale also cancels its debt record.
        if (sale.paymentMethod === "debt") {
          t.update(debts)
            .set({ status: "cancelled", updatedAt: new Date().toISOString() })
            .where(eq(debts.saleId, sale.id))
            .run();
        }
      });
      return db.select().from(sales).where(eq(sales.id, sale.id)).get()!;
    }),
});
