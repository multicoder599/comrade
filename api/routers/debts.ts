import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, like, ne, or, sql } from "drizzle-orm";
import { customers, debtPayments, debts, saleItems, sales } from "@db/schema";
import { getDb } from "../queries/connection";
import { createRouter, authedQuery, adminQuery } from "../middleware";
import { customerCredit } from "./sales";

// Customer debts: goods taken on credit, paid back over time. Overpaying a
// debt leaves the extra as store credit, auto-applied to the customer's next
// debt purchase.

function debtStatus(amount: number, paid: number): "open" | "partial" | "settled" {
  return paid >= amount ? "settled" : paid > 0 ? "partial" : "open";
}

export const debtsRouter = createRouter({
  // Cashiers see their own shop; admins can filter by shop or see everything.
  list: authedQuery
    .input(
      z
        .object({
          shop: z.enum(["A", "B"]).optional(),
          status: z.enum(["open", "partial", "settled", "cancelled"]).optional(),
          // "active" = still owes money (open + partial)
          activeOnly: z.boolean().default(false),
          search: z.string().optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) => {
      const db = getDb();
      const shop =
        ctx.user.role === "cashier" ? (ctx.user.shop ?? undefined) : input?.shop;
      const term = input?.search?.trim();
      const conds = [
        shop ? eq(debts.shop, shop) : undefined,
        input?.status ? eq(debts.status, input.status) : undefined,
        input?.activeOnly && !input?.status
          ? or(eq(debts.status, "open"), eq(debts.status, "partial"))
          : undefined,
        term
          ? or(
              like(debts.customerName, `%${term}%`),
              like(debts.customerPhone, `%${term}%`),
            )
          : undefined,
      ].filter(Boolean);
      return db
        .select()
        .from(debts)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(debts.id))
        .all();
    }),

  // Registered debt customers (for the checkout picker and the admin's
  // customer list). Only the admin can add people here — a cashier can sell
  // on debt only to someone on this list. Each entry carries the customer's
  // current balance (owes) and unused store credit.
  customers: authedQuery.query(({ ctx }) => {
    const db = getDb();
    const shop = ctx.user.role === "cashier" ? ctx.user.shop : undefined;
    const registered = db
      .select()
      .from(customers)
      .where(shop ? eq(customers.shop, shop) : undefined)
      .orderBy(customers.name)
      .all();
    const rows = db
      .select()
      .from(debts)
      .where(and(shop ? eq(debts.shop, shop) : undefined, ne(debts.status, "cancelled")))
      .orderBy(desc(debts.id))
      .all();
    const owesByPhone = new Map<string, number>();
    for (const d of rows) {
      if (d.status === "open" || d.status === "partial") {
        owesByPhone.set(
          d.customerPhone,
          (owesByPhone.get(d.customerPhone) ?? 0) + Math.max(0, d.amount - d.amountPaid),
        );
      }
    }
    return registered
      .map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        shop: c.shop,
        owes: owesByPhone.get(c.phone) ?? 0,
        credit: customerCredit(db, c.shop, c.phone),
      }))
      .sort((a, b) => b.owes - a.owes);
  }),

  // Admin-only: register a customer so cashiers can sell to them on debt.
  addCustomer: adminQuery
    .input(
      z.object({
        shop: z.enum(["A", "B"]),
        name: z.string().min(1).max(80),
        phone: z.string().min(6).max(20),
      }),
    )
    .mutation(({ input }) => {
      const db = getDb();
      const phone = input.phone.trim();
      const existing = db
        .select()
        .from(customers)
        .where(and(eq(customers.shop, input.shop), eq(customers.phone, phone)))
        .get();
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `${existing.name} is already registered with this phone number in Shop ${input.shop}`,
        });
      }
      const info = db
        .insert(customers)
        .values({ shop: input.shop, name: input.name.trim(), phone })
        .run();
      return { id: Number(info.lastInsertRowid) };
    }),

  // Admin-only: take a customer off the debt list. Blocked while they still
  // owe money — settle the debt first.
  removeCustomer: adminQuery
    .input(z.object({ id: z.number().int() }))
    .mutation(({ input }) => {
      const db = getDb();
      const customer = db
        .select()
        .from(customers)
        .where(eq(customers.id, input.id))
        .get();
      if (!customer) throw new TRPCError({ code: "NOT_FOUND" });
      const open = db
        .select({ id: debts.id })
        .from(debts)
        .where(
          and(
            eq(debts.shop, customer.shop),
            eq(debts.customerPhone, customer.phone),
            or(eq(debts.status, "open"), eq(debts.status, "partial")),
          ),
        )
        .get();
      if (open) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${customer.name} still has an unpaid debt — settle it before removing them`,
        });
      }
      db.delete(customers).where(eq(customers.id, input.id)).run();
      return { ok: true };
    }),

  // Outstanding totals per shop (for dashboard badges).
  summary: authedQuery.query(({ ctx }) => {
    const db = getDb();
    const shop = ctx.user.role === "cashier" ? ctx.user.shop : undefined;
    const rows = db
      .select({
        shop: debts.shop,
        outstanding: sql<number>`coalesce(sum(${debts.amount} - ${debts.amountPaid}), 0)`,
        count: sql<number>`count(*)`,
      })
      .from(debts)
      .where(
        and(
          shop ? eq(debts.shop, shop) : undefined,
          or(eq(debts.status, "open"), eq(debts.status, "partial")),
        ),
      )
      .groupBy(debts.shop)
      .all();
    return rows;
  }),

  // One debt with its payment history and every item taken (across all sales
  // merged into this tab).
  get: authedQuery
    .input(z.object({ id: z.number().int() }))
    .query(({ ctx, input }) => {
      const db = getDb();
      const debt = db.select().from(debts).where(eq(debts.id, input.id)).get();
      if (!debt) throw new TRPCError({ code: "NOT_FOUND" });
      if (ctx.user.role === "cashier" && debt.shop !== ctx.user.shop) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const payments = db
        .select()
        .from(debtPayments)
        .where(eq(debtPayments.debtId, debt.id))
        .orderBy(desc(debtPayments.id))
        .all();
      // All sales linked to this tab (new style), plus the legacy first sale.
      const linkedSales = db
        .select({ id: sales.id, receiptNo: sales.receiptNo, createdAt: sales.createdAt })
        .from(sales)
        .where(eq(sales.debtId, debt.id))
        .orderBy(desc(sales.id))
        .all();
      const saleIds = new Set(linkedSales.map((s) => s.id));
      if (debt.saleId) saleIds.add(debt.saleId);
      const items =
        saleIds.size > 0
          ? db
              .select()
              .from(saleItems)
              .where(inArray(saleItems.saleId, [...saleIds]))
              .all()
          : [];
      const credit = customerCredit(db, debt.shop, debt.customerPhone);
      return { debt, payments, items, linkedSales, credit };
    }),

  // Record a repayment. Paying MORE than the balance is allowed — the extra
  // becomes store credit for the customer's next visit.
  recordPayment: authedQuery
    .input(
      z.object({
        debtId: z.number().int(),
        amount: z.number().int().positive(),
        method: z.enum(["cash", "megapay"]).default("cash"),
      }),
    )
    .mutation(({ ctx, input }) => {
      const db = getDb();
      const debt = db
        .select()
        .from(debts)
        .where(eq(debts.id, input.debtId))
        .get();
      if (!debt) throw new TRPCError({ code: "NOT_FOUND" });
      if (ctx.user.role === "cashier" && debt.shop !== ctx.user.shop) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      if (debt.status === "settled" || debt.status === "cancelled") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This debt is already closed",
        });
      }
      const paid = debt.amountPaid + input.amount;
      const status = debtStatus(debt.amount, paid);
      const overpaidBy = Math.max(0, paid - debt.amount);
      const now = new Date().toISOString();
      db.transaction((t) => {
        t.insert(debtPayments)
          .values({
            debtId: debt.id,
            amount: input.amount,
            method: input.method,
            cashierName: ctx.user.displayName,
            createdAt: now,
          })
          .run();
        t.update(debts)
          .set({ amountPaid: paid, status, updatedAt: now })
          .where(eq(debts.id, debt.id))
          .run();
      });
      return {
        debt: db.select().from(debts).where(eq(debts.id, debt.id)).get()!,
        creditAdded: overpaidBy,
      };
    }),
});
