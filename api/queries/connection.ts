import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { env } from "../lib/env";
import * as schema from "@db/schema";
import { hashPassword } from "../auth";

// SQLite bootstrap: the database file and all tables are created
// automatically on first boot, so a fresh VPS needs zero database setup.

const DDL = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','cashier')),
  shop TEXT CHECK (shop IN ('A','B')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  unit TEXT NOT NULL DEFAULT 'pc',
  buying_price INTEGER NOT NULL DEFAULT 0,
  retail_price INTEGER NOT NULL DEFAULT 0,
  wholesale_price INTEGER NOT NULL DEFAULT 0,
  wholesale_min_qty REAL NOT NULL DEFAULT 1,
  allow_bargain INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stocks (
  product_id INTEGER NOT NULL REFERENCES products(id),
  shop TEXT NOT NULL CHECK (shop IN ('A','B')),
  qty REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, shop)
);
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_no TEXT NOT NULL UNIQUE,
  shop TEXT NOT NULL CHECK (shop IN ('A','B')),
  cashier_id INTEGER NOT NULL,
  cashier_name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('retail','wholesale')),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','megapay')),
  status TEXT NOT NULL CHECK (status IN ('completed','pending','failed','cancelled')),
  subtotal INTEGER NOT NULL,
  discount INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  tendered INTEGER,
  change INTEGER,
  customer_name TEXT,
  customer_phone TEXT,
  mpesa_request_id TEXT,
  mpesa_receipt TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sales_shop_date ON sales(shop, created_at);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);
CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  product_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  qty REAL NOT NULL,
  unit_price INTEGER NOT NULL,
  list_price INTEGER NOT NULL,
  buying_price INTEGER NOT NULL,
  line_total INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

type DemoProduct = {
  sku: string;
  name: string;
  category: string;
  unit: string;
  buying: number;
  retail: number;
  wholesale: number;
  minQty: number;
  bargain: boolean;
  stockA: number;
  stockB: number;
};

// Demo catalogue (KES, cents) — seeded only when the products table is empty.
// Delete or edit these from the admin panel; they exist so the till works
// out of the box on first boot.
const DEMO_PRODUCTS: DemoProduct[] = [
  { sku: "UHT500", name: "Brookside UHT Milk 500ml", category: "Dairy", unit: "pc", buying: 5500, retail: 6500, wholesale: 6000, minQty: 6, bargain: true, stockA: 48, stockB: 30 },
  { sku: "BREAD400", name: "Broadways White Bread 400g", category: "Bakery", unit: "pc", buying: 5000, retail: 6000, wholesale: 5500, minQty: 5, bargain: false, stockA: 25, stockB: 18 },
  { sku: "SUGAR1KG", name: "Mumias Sugar 1kg", category: "Dry Goods", unit: "pc", buying: 14500, retail: 16500, wholesale: 15500, minQty: 10, bargain: true, stockA: 60, stockB: 42 },
  { sku: "RICE2KG", name: "Pishori Rice 2kg", category: "Dry Goods", unit: "pc", buying: 38000, retail: 43000, wholesale: 40500, minQty: 5, bargain: true, stockA: 20, stockB: 15 },
  { sku: "OIL1L", name: "Fresh Fri Cooking Oil 1L", category: "Dry Goods", unit: "pc", buying: 29000, retail: 33000, wholesale: 31000, minQty: 6, bargain: true, stockA: 36, stockB: 24 },
  { sku: "FLOUR2KG", name: "Jogoo Maize Flour 2kg", category: "Dry Goods", unit: "pc", buying: 17500, retail: 19500, wholesale: 18500, minQty: 6, bargain: true, stockA: 40, stockB: 28 },
  { sku: "SOAP800G", name: "Menengai Bar Soap 800g", category: "Household", unit: "pc", buying: 15000, retail: 17500, wholesale: 16000, minQty: 6, bargain: true, stockA: 22, stockB: 16 },
  { sku: "SODA500", name: "Coca-Cola 500ml", category: "Beverages", unit: "pc", buying: 4500, retail: 6000, wholesale: 5000, minQty: 12, bargain: false, stockA: 96, stockB: 72 },
  { sku: "WATER1L", name: "Keringet Water 1L", category: "Beverages", unit: "pc", buying: 4000, retail: 5000, wholesale: 4500, minQty: 12, bargain: false, stockA: 84, stockB: 60 },
  { sku: "AIRTIME", name: "Safaricom Airtime Scratch 100", category: "Airtime", unit: "pc", buying: 9500, retail: 10000, wholesale: 9800, minQty: 10, bargain: false, stockA: 50, stockB: 35 },
];

function bootstrap(sqlite: Database.Database) {
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(DDL);

  const now = new Date().toISOString();

  // Default accounts (change these passwords from the admin panel).
  const userCount = sqlite
    .prepare("SELECT COUNT(*) AS n FROM users")
    .get() as { n: number };
  if (userCount.n === 0) {
    const insert = sqlite.prepare(
      `INSERT INTO users (username, password_hash, display_name, role, shop, active, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
    );
    insert.run("admin", hashPassword("admin123"), "Shop Owner", "admin", null, now);
    insert.run("shopa", hashPassword("shopa123"), "Shop A Cashier", "cashier", "A", now);
    insert.run("shopb", hashPassword("shopb123"), "Shop B Cashier", "cashier", "B", now);
  }

  const productCount = sqlite
    .prepare("SELECT COUNT(*) AS n FROM products")
    .get() as { n: number };
  if (productCount.n === 0) {
    const insertProduct = sqlite.prepare(
      `INSERT INTO products (sku, name, category, unit, buying_price, retail_price, wholesale_price, wholesale_min_qty, allow_bargain, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    );
    const insertStock = sqlite.prepare(
      `INSERT INTO stocks (product_id, shop, qty) VALUES (?, ?, ?)`,
    );
    const tx = sqlite.transaction(() => {
      for (const p of DEMO_PRODUCTS) {
        const info = insertProduct.run(
          p.sku, p.name, p.category, p.unit,
          p.buying, p.retail, p.wholesale, p.minQty, p.bargain ? 1 : 0,
          now, now,
        );
        const id = Number(info.lastInsertRowid);
        insertStock.run(id, "A", p.stockA);
        insertStock.run(id, "B", p.stockB);
      }
    });
    tx();
  }

  const upsertSetting = sqlite.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO NOTHING`,
  );
  upsertSetting.run("shop_a_name", "Comrade Shop A");
  upsertSetting.run("shop_b_name", "Comrade Shop B");
  upsertSetting.run("business_name", "Comrade Shop");
}

let instance: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function getDb() {
  if (!instance) {
    const dbPath = env.databasePath;
    const dir = path.dirname(path.resolve(dbPath));
    fs.mkdirSync(dir, { recursive: true });
    const sqlite = new Database(dbPath);
    bootstrap(sqlite);
    instance = drizzle(sqlite, { schema });
  }
  return instance;
}
