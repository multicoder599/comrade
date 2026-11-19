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

  // Shown on the login screen and admin Settings so it's easy to confirm
  // what's actually deployed.
  appVersion: "1.7.0",
  // Changes on every server start — the tills poll it to detect a redeploy
  // and offer a one-tap refresh (kills stale-cache confusion).
  bootId: `${Date.now()}`,

  // Ports — the user runs the shop till on SHOP_PORT and the admin on ADMIN_PORT.
  port: int("PORT", 3000),
  shopPort: int("SHOP_PORT", 5105),
  adminPort: int("ADMIN_PORT", 5106),

  // SQLite database file location (created automatically on first boot).
  databasePath: process.env.DATABASE_PATH || "./data/comrade-shop.db",

  // Secret used to sign login tokens. MUST be overridden on the VPS.
  jwtSecret: process.env.JWT_SECRET || "comrade-shop-dev-secret",

  // MegaPay (megapay.co.ke) M-Pesa STK Push credentials. Each shop prompts
  // through its OWN MegaPay account so the money lands in the right place:
  //   Shop A → MEGAPAY_API_KEY / MEGAPAY_EMAIL
  //   Shop B → MEGAPAY_B_API_KEY / MEGAPAY_B_EMAIL
  megapay: {
    a: {
      apiKey: process.env.MEGAPAY_API_KEY || "",
      email: process.env.MEGAPAY_EMAIL || "",
    },
    b: {
      apiKey: process.env.MEGAPAY_B_API_KEY || "",
      email: process.env.MEGAPAY_B_EMAIL || "",
    },
    baseUrl: process.env.MEGAPAY_BASE_URL || "https://megapay.co.ke/backend/v1",
    // Where MegaPay posts the payment result. Must be publicly reachable and
    // match the webhook URL set in the MegaPay dashboard(s).
    callbackUrl:
      process.env.MEGAPAY_CALLBACK_URL ||
      "http://169.58.58.133:5105/api/megapay/webhook",
  },
};

export type ShopId = "A" | "B";

export function megapayConfigured(shop: ShopId): boolean {
  const creds = shop === "A" ? env.megapay.a : env.megapay.b;
  return Boolean(creds.apiKey && creds.email);
}
