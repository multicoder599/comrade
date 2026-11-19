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
  barcode: text("barcode"),
  name: text("name").notNull(),
  category: text("category").notNull().default("General"),
  unit: text("unit").notNull().default("pc"),
  buyingPrice: integer("buying_price").notNull().default(0),
  retailPrice: integer("retail_price").notNull().default(0),
  wholesalePrice: integer("wholesale_price").notNull().default(0),
  wholesaleMinQty: real("wholesale_min_qty").notNull().default(1),
  // Last price this product actually sold at — set after bargained sales.
  lastSoldPrice: integer("last_sold_price"),
  // Per-product low-stock alert threshold (in base units). When a shop's
  // stock drops to this level, the till and dashboard flag it.
  lowStockAt: real("low_stock_at").notNull().default(5),
  // Price floor in cents per base unit — the till refuses a sale below this.
  // NULL/0 means no floor.
  minPrice: integer("min_price"),
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

// Packaging options: a product stocked in base units (e.g. single eggs) can
// also be sold as a pack (e.g. crate of 30) at its own price. Stock is always
// tracked in base units; selling a pack deducts qty × pack size.
export const productPackages = sqliteTable("product_packages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  productId: integer("product_id")
    .notNull()
    .references(() => products.id),
  name: text("name").notNull(), // e.g. "Crate", "Pack of 6"
  qty: real("qty").notNull(), // base units in one pack, e.g. 30
  price: integer("price").notNull(), // cents per pack
  barcode: text("barcode"), // optional: scan the pack directly
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
  // cash | megapay | split (cash + M-Pesa) | debt (customer pays later)
  paymentMethod: text("payment_method", {
    enum: ["cash", "megapay", "split", "debt"],
  }).notNull(),
  status: text("status", {
    enum: ["completed", "pending", "failed", "cancelled"],
  }).notNull(),
  subtotal: integer("subtotal").notNull(),
  discount: integer("discount").notNull().default(0),
  total: integer("total").notNull(),
  tendered: integer("tendered"),
  change: integer("change"),
  // Split payments: how much of the total was cash vs M-Pesa.
  cashAmount: integer("cash_amount"),
  mpesaAmount: integer("mpesa_amount"),
  customerName: text("customer_name"),
  customerPhone: text("customer_phone"),
  // Set on debt sales: the customer's running debt tab this sale belongs to.
  debtId: integer("debt_id"),
  mpesaRequestId: text("mpesa_request_id"),
  // Our own reference sent with the STK push (e.g. COMRADE-A-1718…) — the
  // webhook matches on it when MegaPay doesn't return the request id.
  mpesaReference: text("mpesa_reference"),
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
  // Whether this line was priced retail or wholesale.
  priceType: text("price_type", { enum: ["retail", "wholesale"] })
    .notNull()
    .default("retail"),
  unitPrice: integer("unit_price").notNull(),
  listPrice: integer("list_price").notNull(),
  buyingPrice: integer("buying_price").notNull(),
  lineTotal: integer("line_total").notNull(),
  // Set when the line was sold as a pack: qty is still base units (stock and
  // cost stay exact); pack_name/pack_units let the receipt show "2 crates".
  packName: text("pack_name"),
  packUnits: real("pack_units"),
});

// Customers registered for debt purchases. Only the admin creates them — a
// cashier can sell on debt only to someone on this list.
export const customers = sqliteTable("customers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  shop: text("shop", { enum: ["A", "B"] }).notNull(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// Customer debts: goods taken now, paid later.
export const debts = sqliteTable("debts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  shop: text("shop", { enum: ["A", "B"] }).notNull(),
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone").notNull(),
  saleId: integer("sale_id").references(() => sales.id),
  amount: integer("amount").notNull(),
  amountPaid: integer("amount_paid").notNull().default(0),
  status: text("status", { enum: ["open", "partial", "settled", "cancelled"] })
    .notNull()
    .default("open"),
  note: text("note"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// Payments made against a debt.
export const debtPayments = sqliteTable("debt_payments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  debtId: integer("debt_id")
    .notNull()
    .references(() => debts.id),
  amount: integer("amount").notNull(),
  method: text("method", { enum: ["cash", "megapay", "credit"] })
    .notNull()
    .default("cash"),
  cashierName: text("cashier_name").notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type User = typeof users.$inferSelect;
export type Product = typeof products.$inferSelect;
export type ProductPackage = typeof productPackages.$inferSelect;
export type Stock = typeof stocks.$inferSelect;
export type Sale = typeof sales.$inferSelect;
export type SaleItem = typeof saleItems.$inferSelect;
export type Debt = typeof debts.$inferSelect;
export type DebtPayment = typeof debtPayments.$inferSelect;
export type Customer = typeof customers.$inferSelect;
