import {
  sqliteTable,
  integer,
  text,
  real,
  primaryKey,
} from "drizzle-orm/sqlite-core";

// All money values are stored as integer cents (KES).
// Timestamps are ISO-8601 strings (UTC).

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role", { enum: ["admin", "cashier"] }).notNull(),
  shop: text("shop", { enum: ["A", "B"] }),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const products = sqliteTable("products", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sku: text("sku").notNull().unique(),
  name: text("name").notNull(),
  category: text("category").notNull().default("General"),
  unit: text("unit").notNull().default("pc"),
  buyingPrice: integer("buying_price").notNull().default(0),
  retailPrice: integer("retail_price").notNull().default(0),
  wholesalePrice: integer("wholesale_price").notNull().default(0),
  wholesaleMinQty: real("wholesale_min_qty").notNull().default(1),
  allowBargain: integer("allow_bargain", { mode: "boolean" })
    .notNull()
    .default(true),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const stocks = sqliteTable(
  "stocks",
  {
    productId: integer("product_id")
      .notNull()
      .references(() => products.id),
    shop: text("shop", { enum: ["A", "B"] }).notNull(),
    qty: real("qty").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.productId, t.shop] })],
);

export const sales = sqliteTable("sales", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  receiptNo: text("receipt_no").notNull().unique(),
  shop: text("shop", { enum: ["A", "B"] }).notNull(),
  cashierId: integer("cashier_id").notNull(),
  cashierName: text("cashier_name").notNull(),
  mode: text("mode", { enum: ["retail", "wholesale"] }).notNull(),
  paymentMethod: text("payment_method", { enum: ["cash", "megapay"] }).notNull(),
  status: text("status", {
    enum: ["completed", "pending", "failed", "cancelled"],
  }).notNull(),
  subtotal: integer("subtotal").notNull(),
  discount: integer("discount").notNull().default(0),
  total: integer("total").notNull(),
  tendered: integer("tendered"),
  change: integer("change"),
  customerName: text("customer_name"),
  customerPhone: text("customer_phone"),
  mpesaRequestId: text("mpesa_request_id"),
  mpesaReceipt: text("mpesa_receipt"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const saleItems = sqliteTable("sale_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  saleId: integer("sale_id")
    .notNull()
    .references(() => sales.id),
  productId: integer("product_id").notNull(),
  name: text("name").notNull(),
  qty: real("qty").notNull(),
  unitPrice: integer("unit_price").notNull(),
  listPrice: integer("list_price").notNull(),
  buyingPrice: integer("buying_price").notNull(),
  lineTotal: integer("line_total").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type User = typeof users.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Stock = typeof stocks.$inferSelect;
export type Sale = typeof sales.$inferSelect;
export type SaleItem = typeof saleItems.$inferSelect;
