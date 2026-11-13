import "dotenv/config";

// Self-hosted configuration for Comrade Shop POS.
// All values come from .env on the VPS — see .env.example.
// This file was adapted from the Kimi-platform scaffold for standalone
// deployment (no portal OAuth / hosted MySQL dependencies).

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const env = {
  isProduction: process.env.NODE_ENV === "production",

  // Ports — the user runs the shop till on SHOP_PORT and the admin on ADMIN_PORT.
  port: int("PORT", 3000),
  shopPort: int("SHOP_PORT", 5105),
  adminPort: int("ADMIN_PORT", 5106),

  // SQLite database file location (created automatically on first boot).
  databasePath: process.env.DATABASE_PATH || "./data/comrade-shop.db",

  // Secret used to sign login tokens. MUST be overridden on the VPS.
  jwtSecret: process.env.JWT_SECRET || "comrade-shop-dev-secret",

  // MegaPay (megapay.co.ke) M-Pesa STK Push credentials — Shop A payments.
  megapay: {
    apiKey: process.env.MEGAPAY_API_KEY || "",
    email: process.env.MEGAPAY_EMAIL || "",
    baseUrl: process.env.MEGAPAY_BASE_URL || "https://megapay.co.ke/backend/v1",
  },
};

export function megapayConfigured(): boolean {
  return Boolean(env.megapay.apiKey && env.megapay.email);
}
