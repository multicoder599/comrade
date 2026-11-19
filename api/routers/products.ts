import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, like, or, inArray } from "drizzle-orm";
import { productPackages, products, stocks } from "@db/schema";
import { getDb } from "../queries/connection";
import { createRouter, authedQuery, adminQuery } from "../middleware";

// A packaging option: e.g. "Crate" of 30 eggs at KES 450. Stock is always
// kept in base units; a pack sale deducts qty × pack size.
const packageInput = z.object({
  name: z.string().min(1).max(40),
  qty: z.number().positive(),
  price: z.number().int().min(0),
  barcode: z.string().max(60).optional(),
});

// Fields a cashier is trusted with from the till's Database page: selling
// price, price floor and low-stock level for their own shop's catalogue.
const priceInput = z.object({
  id: z.number().int(),
  retailPrice: z.number().int().min(0),
  minPrice: z.number().int().min(0).nullable().optional(),
  lowStockAt: z.number().min(0).optional(),
});

const productInput = z.object({
  sku: z.string().min(1).max(50),
  barcode: z.string().max(60).optional(),
  name: z.string().min(1).max(120),
  category: z.string().min(1).max(60).default("General"),
  unit: z.string().min(1).max(20).default("pc"),
  buyingPrice: z.number().int().min(0),
  retailPrice: z.number().int().min(0),
  // Lowest price this product may be sold at (per unit) — the till refuses
  // anything below it. 0/null = no floor.
  minPrice: z.number().int().min(0).nullable().default(null),
  // Alert level per product: when stock drops to this, it's flagged low.
  lowStockAt: z.number().min(0).default(5),
  packages: z.array(packageInput).default([]),
  allowBargain: z.boolean().default(true),
});

// What a cashier needs to start selling a new item from the till. The code
// doubles as barcode and SKU; buying price stays owner knowledge (admin sets
// it later from the admin panel).
const cashierProductInput = z.object({
  name: z.string().min(1).max(120),
  code: z.string().min(1).max(60),
  category: z.string().min(1).max(60).default("General"),
  unit: z.string().min(1).max(20).default("pc"),
  retailPrice: z.number().int().min(0),
  // Optional cost price — set it so profit counts correctly from day one;
  // the admin can still change it later.
  buyingPrice: z.number().int().min(0).default(0),
  minPrice: z.number().int().min(0).nullable().default(null),
  lowStockAt: z.number().min(0).default(5),
  packages: z.array(packageInput).default([]),
  initialStock: z.number().min(0).default(0),
});

function assertBarcodeFree(
  db: ReturnType<typeof getDb>,
  barcode: string | null | undefined,
  exceptId?: number,
) {
  if (!barcode) return;
  const clash = db
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(eq(products.barcode, barcode))
    .get();
  if (clash && clash.id !== exceptId) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Barcode already used by "${clash.name}"`,
    });
  }
  const packClash = db
    .select({ id: productPackages.id, name: productPackages.name })
    .from(productPackages)
    .where(eq(productPackages.barcode, barcode))
    .get();
  if (packClash) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Barcode already used by the "${packClash.name}" package`,
    });
  }
}

/** Pack barcodes must not collide with product barcodes or other packs. */
function assertPackageBarcodesFree(
  db: ReturnType<typeof getDb>,
  packs: z.infer<typeof packageInput>[],
  exceptProductId?: number,
) {
  const seen = new Set<string>();
  for (const p of packs) {
    const barcode = p.barcode?.trim();
    if (!barcode) continue;
    if (seen.has(barcode)) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `Package barcode "${barcode}" is used twice`,
      });
    }
    seen.add(barcode);
    const productClash = db
      .select({ id: products.id, name: products.name })
      .from(products)
      .where(eq(products.barcode, barcode))
      .get();
    if (productClash && productClash.id !== exceptProductId) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `Package barcode already used by "${productClash.name}"`,
      });
    }
    const others = db
      .select({ id: productPackages.id, productId: productPackages.productId })
      .from(productPackages)
      .where(eq(productPackages.barcode, barcode))
      .all();
    if (others.some((o) => o.productId !== exceptProductId)) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `Package barcode "${barcode}" already used by another product's pack`,
      });
    }
  }
}

type DbOrTx = ReturnType<typeof getDb> | Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

function replacePackagesTx(
  t: DbOrTx,
  productId: number,
  packs: z.infer<typeof packageInput>[],
) {
  t.delete(productPackages).where(eq(productPackages.productId, productId)).run();
  for (const p of packs) {
    t.insert(productPackages)
      .values({
        productId,
        name: p.name.trim(),
        qty: p.qty,
        price: p.price,
        barcode: p.barcode?.trim() || null,
      })
      .run();
  }
}

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
      const packs = rows.length
        ? db
            .select()
            .from(productPackages)
            .where(inArray(productPackages.productId, rows.map((r) => r.product.id)))
            .all()
        : [];
      const packsByProduct = new Map<number, typeof packs>();
      for (const p of packs) {
        const list = packsByProduct.get(p.productId) ?? [];
        list.push(p);
        packsByProduct.set(p.productId, list);
      }
      return rows.map((r) => ({
        ...r.product,
        stockQty: r.qty ?? 0,
        shop: input.shop,
        packages: packsByProduct.get(r.product.id) ?? [],
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
            ? or(
                like(products.name, `%${term}%`),
                like(products.sku, `%${term}%`),
                like(products.barcode, `%${term}%`),
              )
            : undefined,
        )
        .all();
      const stockRows = db.select().from(stocks).all();
      const stockMap = new Map<string, number>();
      for (const s of stockRows) stockMap.set(`${s.productId}:${s.shop}`, s.qty);
      const packs = rows.length
        ? db
            .select()
            .from(productPackages)
            .where(inArray(productPackages.productId, rows.map((p) => p.id)))
            .all()
        : [];
      const packsByProduct = new Map<number, typeof packs>();
      for (const p of packs) {
        const list = packsByProduct.get(p.productId) ?? [];
        list.push(p);
        packsByProduct.set(p.productId, list);
      }
      return rows.map((p) => ({
        ...p,
        stockA: stockMap.get(`${p.id}:A`) ?? 0,
        stockB: stockMap.get(`${p.id}:B`) ?? 0,
        packages: packsByProduct.get(p.id) ?? [],
      }));
    }),

  create: adminQuery.input(productInput).mutation(({ input }) => {
    const db = getDb();
    const existing = db.select().from(products).where(eq(products.sku, input.sku)).get();
    if (existing) {
      throw new TRPCError({ code: "CONFLICT", message: "SKU already exists" });
    }
    const barcode = input.barcode?.trim() || null;
    assertBarcodeFree(db, barcode);
    assertPackageBarcodesFree(db, input.packages);
    const now = new Date().toISOString();
    const { packages: packs, ...fields } = input;
    const tx = db.transaction((t) => {
      const info = t
        .insert(products)
        .values({ ...fields, barcode, createdAt: now, updatedAt: now })
        .run();
      const id = Number(info.lastInsertRowid);
      t.insert(stocks).values({ productId: id, shop: "A", qty: 0 }).run();
      t.insert(stocks).values({ productId: id, shop: "B", qty: 0 }).run();
      replacePackagesTx(t, id, packs);
      return id;
    });
    return { id: tx };
  }),

  // Till-side product creation: cashier adds the item with its selling price
  // and opening stock for their own shop. Buying price is optional (default
  // 0) — when given, profit reports are correct from the first sale; the
  // admin can adjust it later.
  cashierCreate: authedQuery
    .input(cashierProductInput)
    .mutation(({ ctx, input }) => {
      const db = getDb();
      const shop = ctx.user.role === "cashier" ? (ctx.user.shop ?? "A") : "A";
      const code = input.code.trim();
      const existing = db
        .select()
        .from(products)
        .where(or(eq(products.sku, code), eq(products.barcode, code)))
        .get();
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `That code is already used by "${existing.name}"`,
        });
      }
      const now = new Date().toISOString();
      assertPackageBarcodesFree(db, input.packages);
      const tx = db.transaction((t) => {
        const info = t
          .insert(products)
          .values({
            sku: code,
            barcode: code,
            name: input.name.trim(),
            category: input.category.trim() || "General",
            unit: input.unit.trim() || "pc",
            buyingPrice: input.buyingPrice,
            retailPrice: input.retailPrice,
            minPrice: input.minPrice,
            lowStockAt: input.lowStockAt,
            allowBargain: true,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        const id = Number(info.lastInsertRowid);
        t.insert(stocks)
          .values({
            productId: id,
            shop: "A",
            qty: shop === "A" ? input.initialStock : 0,
          })
          .run();
        t.insert(stocks)
          .values({
            productId: id,
            shop: "B",
            qty: shop === "B" ? input.initialStock : 0,
          })
          .run();
        replacePackagesTx(t, id, input.packages);
        return id;
      });
      return { id: tx };
    }),

  update: adminQuery
    .input(productInput.partial().extend({ id: z.number().int(), active: z.boolean().optional() }))
    .mutation(({ input }) => {
      const db = getDb();
      const { id, active, packages: packs, ...rest } = input;
      const target = db.select().from(products).where(eq(products.id, id)).get();
      if (!target) throw new TRPCError({ code: "NOT_FOUND" });
      if (rest.sku && rest.sku !== target.sku) {
        const clash = db.select().from(products).where(eq(products.sku, rest.sku)).get();
        if (clash) throw new TRPCError({ code: "CONFLICT", message: "SKU already exists" });
      }
      const barcode =
        rest.barcode !== undefined ? rest.barcode?.trim() || null : undefined;
      assertBarcodeFree(db, barcode, id);
      if (packs !== undefined) assertPackageBarcodesFree(db, packs, id);
      db.transaction((t) => {
        t.update(products)
          .set({
            ...rest,
            ...(barcode !== undefined ? { barcode } : {}),
            ...(active !== undefined ? { active } : {}),
            updatedAt: new Date().toISOString(),
          })
          .where(eq(products.id, id))
          .run();
        if (packs !== undefined) replacePackagesTx(t, id, packs);
      });
      return { ok: true };
    }),

  // Permanently delete a product (stock rows go with it). Past sale lines keep
  // their own name/price snapshots, so receipts and reports stay intact.
  delete: adminQuery
    .input(z.object({ id: z.number().int() }))
    .mutation(({ input }) => {
      const db = getDb();
      const target = db
        .select()
        .from(products)
        .where(eq(products.id, input.id))
        .get();
      if (!target) throw new TRPCError({ code: "NOT_FOUND" });
      db.transaction((t) => {
        t.delete(productPackages).where(eq(productPackages.productId, input.id)).run();
        t.delete(stocks).where(eq(stocks.productId, input.id)).run();
        t.delete(products).where(eq(products.id, input.id)).run();
      });
      return { ok: true };
    }),

  // Cashier-accessible: update the selling price, price floor and low-stock
  // level of a product (cashiers can only manage products, not delete them).
  updatePrices: authedQuery.input(priceInput).mutation(({ input }) => {
    const db = getDb();
    const target = db.select().from(products).where(eq(products.id, input.id)).get();
    if (!target) throw new TRPCError({ code: "NOT_FOUND" });
    db.update(products)
      .set({
        retailPrice: input.retailPrice,
        ...(input.minPrice !== undefined ? { minPrice: input.minPrice } : {}),
        ...(input.lowStockAt !== undefined ? { lowStockAt: input.lowStockAt } : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(products.id, input.id))
      .run();
    return { ok: true };
  }),

  // Move stock from one shop to the other in one action: subtract from the
  // source, add to the destination. Cashiers can only send FROM their own
  // shop; the admin can move stock both ways.
  transfer: authedQuery
    .input(
      z.object({
        productId: z.number().int(),
        from: z.enum(["A", "B"]),
        qty: z.number().positive(),
      }),
    )
    .mutation(({ ctx, input }) => {
      if (ctx.user.role === "cashier" && ctx.user.shop !== input.from) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cashiers can only send stock from their own shop",
        });
      }
      const to: "A" | "B" = input.from === "A" ? "B" : "A";
      const db = getDb();
      const target = db
        .select()
        .from(products)
        .where(eq(products.id, input.productId))
        .get();
      if (!target) throw new TRPCError({ code: "NOT_FOUND" });
      return db.transaction((t) => {
        const fromRow = t
          .select()
          .from(stocks)
          .where(and(eq(stocks.productId, input.productId), eq(stocks.shop, input.from)))
          .get();
        const fromQty = fromRow?.qty ?? 0;
        if (fromQty < input.qty) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Only ${fromQty} ${target.unit} available in shop ${input.from}`,
          });
        }
        const toRow = t
          .select()
          .from(stocks)
          .where(and(eq(stocks.productId, input.productId), eq(stocks.shop, to)))
          .get();
        const fromNext = fromQty - input.qty;
        const toNext = (toRow?.qty ?? 0) + input.qty;
        t.insert(stocks)
          .values({ productId: input.productId, shop: input.from, qty: fromNext })
          .onConflictDoUpdate({
            target: [stocks.productId, stocks.shop],
            set: { qty: fromNext },
          })
          .run();
        t.insert(stocks)
          .values({ productId: input.productId, shop: to, qty: toNext })
          .onConflictDoUpdate({
            target: [stocks.productId, stocks.shop],
            set: { qty: toNext },
          })
          .run();
        return { fromQty: fromNext, toQty: toNext };
      });
    }),

  // Set or add stock for a shop. `delta` adds to current qty, `setQty` overrides.
  // Cashiers can only touch their own shop.
  adjustStock: authedQuery
    .input(
      z.object({
        productId: z.number().int(),
        shop: z.enum(["A", "B"]),
        delta: z.number().optional(),
        setQty: z.number().min(0).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      if (ctx.user.role === "cashier" && ctx.user.shop !== input.shop) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Cashiers manage their own shop's stock only" });
      }
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
