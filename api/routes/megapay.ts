import { Hono, type Context } from "hono";
import { desc, eq, inArray } from "drizzle-orm";
import { saleItems, sales, stocks } from "@db/schema";
import { and, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { log } from "../lib/logger";

// MegaPay webhook — receives the payment result after an STK push.
// The STK payload sends MegaPay our callback_url (MEGAPAY_CALLBACK_URL,
// default http://169.58.58.133:5105/api/megapay/webhook — the same URL set
// in the MegaPay dashboard). Both shops' accounts post here; our reference
// (COMRADE-A-… / COMRADE-B-…) tells them apart.
//
// Payload parsing and match fallbacks mirror the shop's proven Stallion
// Minimart integration: MegaPay's field names have varied over time, so we
// accept every variant seen in the wild and match by (1) request id,
// (2) our reference, (3) phone + amount within a 10-minute window.

export const megapayRoutes = new Hono();

type WebhookPayload = Record<string, unknown>;

function str(v: unknown): string {
  return v === undefined || v === null ? "" : String(v);
}

// MegaPay posts to the URL configured in its dashboard — the shop's account
// uses /api/megapay/webhook. Both paths land on the same handler.
megapayRoutes.post("/webhook", megapayWebhookHandler);
megapayRoutes.post("/callback", megapayWebhookHandler);

async function megapayWebhookHandler(c: Context) {
  let data: WebhookPayload | null = await c.req.json().catch(() => null);
  if (typeof data === "string") {
    try {
      data = JSON.parse(data) as WebhookPayload;
    } catch {
      data = null;
    }
  }
  if (!data || Object.keys(data).length === 0) {
    return c.json({ ok: false, error: "empty body" }, 400);
  }

  const responseCode =
    data.ResponseCode !== undefined
      ? str(data.ResponseCode)
      : data.ResultCode !== undefined
        ? str(data.ResultCode)
        : "";
  const amount = parseFloat(
    str(data.TransactionAmount || data.amount || data.Amount || "0"),
  );
  const receipt =
    str(
      data.TransactionReceipt || data.MpesaReceiptNumber || data.receipt,
    ) || null;
  const phoneRaw = str(
    data.Msisdn || data.phone || data.PhoneNumber || data.msisdn,
  );
  const last9 = phoneRaw.replace(/\D/g, "").slice(-9);
  const reference = str(
    data.reference ||
      data.Reference ||
      data.TransactionReference ||
      data.BillRefNumber,
  );
  const transactionId = str(data.TransactionID);

  const db = getDb();

  // --- Match the pending sale ---
  let sale = transactionId
    ? db.select().from(sales).where(eq(sales.mpesaRequestId, transactionId)).get()
    : undefined;
  if (!sale && reference) {
    sale = db
      .select()
      .from(sales)
      .where(eq(sales.mpesaReference, reference))
      .get();
    // Older rows stored our reference in mpesa_request_id (no request id came
    // back from initiatestk).
    if (!sale) {
      sale = db
        .select()
        .from(sales)
        .where(eq(sales.mpesaRequestId, reference))
        .get();
    }
  }
  if (!sale && last9 && amount > 0) {
    const candidates = db
      .select()
      .from(sales)
      .where(
        and(
          eq(sales.status, "pending"),
          inArray(sales.paymentMethod, ["megapay", "split"]),
        ),
      )
      .orderBy(desc(sales.id))
      .limit(20)
      .all();
    const now = Date.now();
    sale = candidates.find((s) => {
      if (now - Date.parse(s.createdAt) > 10 * 60 * 1000) return false;
      const phone = (s.customerPhone ?? "").replace(/\D/g, "");
      return (
        phone.endsWith(last9) &&
        Math.abs((s.mpesaAmount ?? 0) / 100 - amount) < 0.01
      );
    });
  }

  if (!sale) {
    log.info("megapay webhook: no matching sale", { reference, receipt });
    return c.json({ ok: true }); // ack anyway so MegaPay stops retrying
  }
  if (sale.status !== "pending") {
    return c.json({ ok: true }); // already settled (poll or earlier webhook)
  }

  if (responseCode === "0") {
    db.update(sales)
      .set({ status: "completed", mpesaReceipt: receipt })
      .where(eq(sales.id, sale.id))
      .run();
    log.info("megapay webhook: sale completed", {
      saleId: sale.id,
      shop: sale.shop,
      receipt,
    });
  } else {
    db.transaction((t) => {
      t.update(sales).set({ status: "failed" }).where(eq(sales.id, sale.id)).run();
      const items = t.select().from(saleItems).where(eq(saleItems.saleId, sale.id)).all();
      for (const item of items) {
        t.update(stocks)
          .set({ qty: sql`${stocks.qty} + ${item.qty}` })
          .where(and(eq(stocks.productId, item.productId), eq(stocks.shop, sale.shop)))
          .run();
      }
    });
    log.info("megapay webhook: sale failed", {
      saleId: sale.id,
      shop: sale.shop,
      code: responseCode,
    });
  }
  return c.json({ ok: true });
}
