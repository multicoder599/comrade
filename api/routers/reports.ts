import { z } from "zod";
import { and, desc, eq, gte, lt, ne, sql } from "drizzle-orm";
import { debtPayments, debts, products, saleItems, sales, stocks } from "@db/schema";
import { getDb } from "../queries/connection";
import { createRouter, adminQuery } from "../middleware";

const rangeInput = z.object({
  from: z.string(), // ISO timestamp (inclusive)
  to: z.string(), // ISO timestamp (exclusive)
  shop: z.enum(["A", "B"]).optional(),
});

export const reportsRouter = createRouter({
  summary: adminQuery.input(rangeInput).query(({ input }) => {
    const db = getDb();
    // Debt sales are NOT revenue or profit — the money hasn't arrived yet.
    // They enter the books as "Debt payments" when the customer pays up.
    const conds = [
      eq(sales.status, "completed"),
      ne(sales.paymentMethod, "debt"),
      gte(sales.createdAt, input.from),
      lt(sales.createdAt, input.to),
      input.shop ? eq(sales.shop, input.shop) : undefined,
    ].filter(Boolean);
    const where = and(...conds);

    const rows = db
      .select({
        id: sales.id,
        shop: sales.shop,
        total: sales.total,
        discount: sales.discount,
        paymentMethod: sales.paymentMethod,
        createdAt: sales.createdAt,
      })
      .from(sales)
      .where(where)
      .all();

    const itemRows = db
      .select({
        saleId: saleItems.saleId,
        qty: saleItems.qty,
        buyingPrice: saleItems.buyingPrice,
        lineTotal: saleItems.lineTotal,
      })
      .from(saleItems)
      .innerJoin(sales, eq(saleItems.saleId, sales.id))
      .where(where)
      .all();

    const revenue = rows.reduce((s, r) => s + r.total, 0);
    const discountTotal = rows.reduce((s, r) => s + r.discount, 0);
    const cost = itemRows.reduce((s, r) => s + Math.round(r.buyingPrice * r.qty), 0);

    const perShop = (shop: "A" | "B") => {
      const shopSales = rows.filter((r) => r.shop === shop);
      const ids = new Set(shopSales.map((r) => r.id));
      const shopCost = itemRows
        .filter((r) => ids.has(r.saleId))
        .reduce((s, r) => s + Math.round(r.buyingPrice * r.qty), 0);
      const shopRevenue = shopSales.reduce((s, r) => s + r.total, 0);
      return {
        shop,
        sales: shopSales.length,
        revenue: shopRevenue,
        cost: shopCost,
        profit: shopRevenue - shopCost,
      };
    };

    const byMethod = (method: "cash" | "megapay" | "split") => ({
      method,
      sales: rows.filter((r) => r.paymentMethod === method).length,
      revenue: rows.filter((r) => r.paymentMethod === method).reduce((s, r) => s + r.total, 0),
    });

    // Money actually collected against debts in this period.
    const collectionConds = [
      gte(debtPayments.createdAt, input.from),
      lt(debtPayments.createdAt, input.to),
      ne(debtPayments.method, "credit"),
      input.shop ? eq(debts.shop, input.shop) : undefined,
    ].filter(Boolean);
    const collections = db
      .select({
        count: sql<number>`count(*)`,
        total: sql<number>`coalesce(sum(${debtPayments.amount}), 0)`,
      })
      .from(debtPayments)
      .innerJoin(debts, eq(debtPayments.debtId, debts.id))
      .where(and(...collectionConds))
      .get();

    // Group by Nairobi (EAT, UTC+3) calendar day for the trend table,
    // matching the EAT day boundaries the client queries with.
    const byDayMap = new Map<string, { day: string; sales: number; revenue: number }>();
    for (const r of rows) {
      const day = new Date(new Date(r.createdAt).getTime() + 3 * 3600_000)
        .toISOString()
        .slice(0, 10);
      const entry = byDayMap.get(day) ?? { day, sales: 0, revenue: 0 };
      entry.sales += 1;
      entry.revenue += r.total;
      byDayMap.set(day, entry);
    }

    return {
      sales: rows.length,
      revenue,
      discountTotal,
      cost,
      profit: revenue - cost,
      shops: [perShop("A"), perShop("B")],
      payments: [
        byMethod("cash"),
        byMethod("megapay"),
        byMethod("split"),
        {
          method: "debtPayments",
          sales: collections?.count ?? 0,
          revenue: collections?.total ?? 0,
        },
      ],
      byDay: [...byDayMap.values()].sort((a, b) => a.day.localeCompare(b.day)),
    };
  }),

  topProducts: adminQuery
    .input(rangeInput.extend({ limit: z.number().int().min(1).max(50).default(10) }))
    .query(({ input }) => {
      const db = getDb();
      const conds = [
        eq(sales.status, "completed"),
        ne(sales.paymentMethod, "debt"),
        gte(sales.createdAt, input.from),
        lt(sales.createdAt, input.to),
        input.shop ? eq(sales.shop, input.shop) : undefined,
      ].filter(Boolean);
      return db
        .select({
          productId: saleItems.productId,
          name: saleItems.name,
          qty: sql<number>`SUM(${saleItems.qty})`,
          revenue: sql<number>`SUM(${saleItems.lineTotal})`,
          profit: sql<number>`SUM(${saleItems.lineTotal} - ROUND(${saleItems.buyingPrice} * ${saleItems.qty}))`,
        })
        .from(saleItems)
        .innerJoin(sales, eq(saleItems.saleId, sales.id))
        .where(and(...conds))
        .groupBy(saleItems.productId, saleItems.name)
        .orderBy(desc(sql`SUM(${saleItems.lineTotal})`))
        .limit(input.limit)
        .all();
    }),

  lowStock: adminQuery
    .input(z.object({ threshold: z.number().min(0).default(10) }).optional())
    .query(({ input }) => {
      const db = getDb();
      const threshold = input?.threshold ?? 10;
      return db
        .select({
          id: products.id,
          name: products.name,
          sku: products.sku,
          unit: products.unit,
          shop: stocks.shop,
          qty: stocks.qty,
        })
        .from(stocks)
        .innerJoin(products, eq(stocks.productId, products.id))
        .where(and(eq(products.active, true), lt(stocks.qty, threshold)))
        .orderBy(stocks.qty)
        .all();
    }),
});
