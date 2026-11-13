import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, like, or } from "drizzle-orm";
import { products, stocks } from "@db/schema";
import { getDb } from "../queries/connection";
import { createRouter, authedQuery, adminQuery } from "../middleware";

const productInput = z.object({
  sku: z.string().min(1).max(50),
  name: z.string().min(1).max(120),
  category: z.string().min(1).max(60).default("General"),
  unit: z.string().min(1).max(20).default("pc"),
  buyingPrice: z.number().int().min(0),
  retailPrice: z.number().int().min(0),
  wholesalePrice: z.number().int().min(0),
  wholesaleMinQty: z.number().min(0).default(1),
  allowBargain: z.boolean().default(true),
});

export const productsRouter = createRouter({
  // Till catalogue: active products with the stock level of one shop.
  listForShop: authedQuery
    .input(z.object({ shop: z.enum(["A", "B"]) }))
    .query(({ ctx, input }) => {
      if (ctx.user.role === "cashier" && ctx.user.shop !== input.shop) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const db = getDb();
      const rows = db
        .select({ product: products, qty: stocks.qty })
        .from(products)
        .leftJoin(
          stocks,
          and(eq(stocks.productId, products.id), eq(stocks.shop, input.shop)),
        )
        .where(eq(products.active, true))
        .all();
      return rows.map((r) => ({
        ...r.product,
        stockQty: r.qty ?? 0,
        shop: input.shop,
      }));
    }),

  // Admin catalogue: all products (incl. inactive) with stock in both shops.
  listAll: adminQuery
    .input(z.object({ search: z.string().optional() }).optional())
    .query(({ input }) => {
      const db = getDb();
      const term = input?.search?.trim();
      const rows = db
        .select()
        .from(products)
        .where(
          term
            ? or(like(products.name, `%${term}%`), like(products.sku, `%${term}%`))
            : undefined,
        )
        .all();
      const stockRows = db.select().from(stocks).all();
      const stockMap = new Map<string, number>();
      for (const s of stockRows) stockMap.set(`${s.productId}:${s.shop}`, s.qty);
      return rows.map((p) => ({
        ...p,
        stockA: stockMap.get(`${p.id}:A`) ?? 0,
        stockB: stockMap.get(`${p.id}:B`) ?? 0,
      }));
    }),

  create: adminQuery.input(productInput).mutation(({ input }) => {
    const db = getDb();
    const existing = db.select().from(products).where(eq(products.sku, input.sku)).get();
    if (existing) {
      throw new TRPCError({ code: "CONFLICT", message: "SKU already exists" });
    }
    const now = new Date().toISOString();
    const tx = db.transaction((t) => {
      const info = t
        .insert(products)
        .values({ ...input, createdAt: now, updatedAt: now })
        .run();
      const id = Number(info.lastInsertRowid);
      t.insert(stocks).values({ productId: id, shop: "A", qty: 0 }).run();
      t.insert(stocks).values({ productId: id, shop: "B", qty: 0 }).run();
      return id;
    });
    return { id: tx };
  }),

  update: adminQuery
    .input(productInput.partial().extend({ id: z.number().int(), active: z.boolean().optional() }))
    .mutation(({ input }) => {
      const db = getDb();
      const { id, active, ...rest } = input;
      const target = db.select().from(products).where(eq(products.id, id)).get();
      if (!target) throw new TRPCError({ code: "NOT_FOUND" });
      if (rest.sku && rest.sku !== target.sku) {
        const clash = db.select().from(products).where(eq(products.sku, rest.sku)).get();
        if (clash) throw new TRPCError({ code: "CONFLICT", message: "SKU already exists" });
      }
      db.update(products)
        .set({ ...rest, ...(active !== undefined ? { active } : {}), updatedAt: new Date().toISOString() })
        .where(eq(products.id, id))
        .run();
      return { ok: true };
    }),

  // Set or add stock for a shop. `delta` adds to current qty, `setQty` overrides.
  adjustStock: adminQuery
    .input(
      z.object({
        productId: z.number().int(),
        shop: z.enum(["A", "B"]),
        delta: z.number().optional(),
        setQty: z.number().min(0).optional(),
      }),
    )
    .mutation(({ input }) => {
      if (input.delta === undefined && input.setQty === undefined) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Give delta or setQty" });
      }
      const db = getDb();
      const row = db
        .select()
        .from(stocks)
        .where(and(eq(stocks.productId, input.productId), eq(stocks.shop, input.shop)))
        .get();
      const current = row?.qty ?? 0;
      const next =
        input.setQty !== undefined ? input.setQty : current + (input.delta ?? 0);
      if (next < 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Stock cannot go below 0" });
      }
      db.insert(stocks)
        .values({ productId: input.productId, shop: input.shop, qty: next })
        .onConflictDoUpdate({
          target: [stocks.productId, stocks.shop],
          set: { qty: next },
        })
        .run();
      return { qty: next };
    }),
});
