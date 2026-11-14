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

  // No demo products — the catalogue starts empty. Add real products with
  // prices and stock from Admin → Products & Prices / Stock.

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
