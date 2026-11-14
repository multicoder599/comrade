import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { debtPayments, debts, saleItems, sales } from "@db/schema";
import { getDb } from "../queries/connection";
import { createRouter, authedQuery } from "../middleware";

// Customer debts: goods taken on credit, paid back over time.

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

  // One debt with its payment history and the items taken.
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
      let items: (typeof saleItems.$inferSelect)[] = [];
      let receiptNo: string | null = null;
      if (debt.saleId) {
        items = db
          .select()
          .from(saleItems)
          .where(eq(saleItems.saleId, debt.saleId))
          .all();
        const sale = db
          .select({ receiptNo: sales.receiptNo })
          .from(sales)
          .where(eq(sales.id, debt.saleId))
          .get();
        receiptNo = sale?.receiptNo ?? null;
      }
      return { debt, payments, items, receiptNo };
    }),

  // Record a (partial) repayment. Cash is taken at the till; the method is
  // recorded for the books.
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
      const balance = debt.amount - debt.amountPaid;
      const amount = Math.min(input.amount, balance);
      const paid = debt.amountPaid + amount;
      const status = paid >= debt.amount ? "settled" : "partial";
      const now = new Date().toISOString();
      db.transaction((t) => {
        t.insert(debtPayments)
          .values({
            debtId: debt.id,
            amount,
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
      return db.select().from(debts).where(eq(debts.id, debt.id)).get()!;
    }),
});
