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
  barcode TEXT,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  unit TEXT NOT NULL DEFAULT 'pc',
  buying_price INTEGER NOT NULL DEFAULT 0,
  retail_price INTEGER NOT NULL DEFAULT 0,
  wholesale_price INTEGER NOT NULL DEFAULT 0,
  wholesale_min_qty REAL NOT NULL DEFAULT 1,
  last_sold_price INTEGER,
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
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','megapay','split','debt')),
  status TEXT NOT NULL CHECK (status IN ('completed','pending','failed','cancelled')),
  subtotal INTEGER NOT NULL,
  discount INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  tendered INTEGER,
  change INTEGER,
  cash_amount INTEGER,
  mpesa_amount INTEGER,
  customer_name TEXT,
  customer_phone TEXT,
  debt_id INTEGER,
  mpesa_request_id TEXT,
  mpesa_receipt TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sales_shop_date ON sales(shop, created_at);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);
CREATE INDEX IF NOT EXISTS idx_sales_debt ON sales(debt_id);
CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  product_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  qty REAL NOT NULL,
  price_type TEXT NOT NULL DEFAULT 'retail',
  unit_price INTEGER NOT NULL,
  list_price INTEGER NOT NULL,
  buying_price INTEGER NOT NULL,
  line_total INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE TABLE IF NOT EXISTS debts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop TEXT NOT NULL CHECK (shop IN ('A','B')),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  sale_id INTEGER REFERENCES sales(id),
  amount INTEGER NOT NULL,
  amount_paid INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','partial','settled','cancelled')),
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_debts_shop_status ON debts(shop, status);
CREATE TABLE IF NOT EXISTS debt_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  debt_id INTEGER NOT NULL REFERENCES debts(id),
  amount INTEGER NOT NULL,
  method TEXT NOT NULL DEFAULT 'cash' CHECK (method IN ('cash','megapay','credit')),
  cashier_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_debt_payments_debt ON debt_payments(debt_id);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

function columnNames(sqlite: Database.Database, table: string): string[] {
  return (sqlite.pragma(`table_info(${table})`) as { name: string }[]).map(
    (c) => c.name,
  );
}

function ensureColumn(
  sqlite: Database.Database,
  table: string,
  column: string,
  ddl: string,
) {
  if (!columnNames(sqlite, table).includes(column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

// Older databases have a CHECK constraint that only allows payment_method
// 'cash'/'megapay'. SQLite can't alter CHECK constraints, so the table is
// rebuilt (data copied over) when the old definition is detected.
function migrateSalesTable(sqlite: Database.Database) {
  const row = sqlite
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sales'",
    )
    .get() as { sql: string } | undefined;
  if (!row || row.sql.includes("'split'")) return;

  sqlite.pragma("foreign_keys = OFF");
  sqlite.exec("BEGIN");
  try {
    sqlite.exec(`
      CREATE TABLE sales_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        receipt_no TEXT NOT NULL UNIQUE,
        shop TEXT NOT NULL CHECK (shop IN ('A','B')),
        cashier_id INTEGER NOT NULL,
        cashier_name TEXT NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('retail','wholesale')),
        payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','megapay','split','debt')),
        status TEXT NOT NULL CHECK (status IN ('completed','pending','failed','cancelled')),
        subtotal INTEGER NOT NULL,
        discount INTEGER NOT NULL DEFAULT 0,
        total INTEGER NOT NULL,
        tendered INTEGER,
        change INTEGER,
        cash_amount INTEGER,
        mpesa_amount INTEGER,
        customer_name TEXT,
        customer_phone TEXT,
        debt_id INTEGER,
        mpesa_request_id TEXT,
        mpesa_receipt TEXT,
        created_at TEXT NOT NULL
      );
      INSERT INTO sales_new (
        id, receipt_no, shop, cashier_id, cashier_name, mode, payment_method,
        status, subtotal, discount, total, tendered, change, customer_name,
        customer_phone, mpesa_request_id, mpesa_receipt, created_at
      )
      SELECT
        id, receipt_no, shop, cashier_id, cashier_name, mode, payment_method,
        status, subtotal, discount, total, tendered, change, customer_name,
        customer_phone, mpesa_request_id, mpesa_receipt, created_at
      FROM sales;
      DROP TABLE sales;
      ALTER TABLE sales_new RENAME TO sales;
      CREATE INDEX IF NOT EXISTS idx_sales_shop_date ON sales(shop, created_at);
      CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);
      CREATE INDEX IF NOT EXISTS idx_sales_debt ON sales(debt_id);
    `);
    sqlite.exec("COMMIT");
  } catch (err) {
    sqlite.exec("ROLLBACK");
    throw err;
  }
  sqlite.pragma("foreign_keys = ON");
}

// debt_payments from the previous release only allows method cash/megapay.
// Rebuild it if the CHECK constraint predates the 'credit' method.
function migrateDebtPaymentsTable(sqlite: Database.Database) {
  const row = sqlite
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'debt_payments'",
    )
    .get() as { sql: string } | undefined;
  if (!row || row.sql.includes("'credit'")) return;

  sqlite.pragma("foreign_keys = OFF");
  sqlite.exec("BEGIN");
  try {
    sqlite.exec(`
      CREATE TABLE debt_payments_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        debt_id INTEGER NOT NULL REFERENCES debts(id),
        amount INTEGER NOT NULL,
        method TEXT NOT NULL DEFAULT 'cash' CHECK (method IN ('cash','megapay','credit')),
        cashier_name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO debt_payments_new (id, debt_id, amount, method, cashier_name, created_at)
      SELECT id, debt_id, amount, method, cashier_name, created_at FROM debt_payments;
      DROP TABLE debt_payments;
      ALTER TABLE debt_payments_new RENAME TO debt_payments;
      CREATE INDEX IF NOT EXISTS idx_debt_payments_debt ON debt_payments(debt_id);
    `);
    sqlite.exec("COMMIT");
  } catch (err) {
    sqlite.exec("ROLLBACK");
    throw err;
  }
  sqlite.pragma("foreign_keys = ON");
}

// Add columns/tables introduced after first release to existing databases.
function migrate(sqlite: Database.Database) {
  ensureColumn(sqlite, "products", "barcode", "barcode TEXT");
  ensureColumn(sqlite, "products", "last_sold_price", "last_sold_price INTEGER");
  ensureColumn(
    sqlite,
    "sale_items",
    "price_type",
    "price_type TEXT NOT NULL DEFAULT 'retail'",
  );
  ensureColumn(sqlite, "sales", "cash_amount", "cash_amount INTEGER");
  ensureColumn(sqlite, "sales", "mpesa_amount", "mpesa_amount INTEGER");
  ensureColumn(sqlite, "sales", "debt_id", "debt_id INTEGER");
  migrateSalesTable(sqlite);
  migrateDebtPaymentsTable(sqlite);
  sqlite.exec(
    "CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode)",
  );
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_sales_debt ON sales(debt_id)");
}

function bootstrap(sqlite: Database.Database) {
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(DDL);
  migrate(sqlite);

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
