import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { saleItems, sales, stocks } from "@db/schema";
import { and, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { log } from "../lib/logger";

// MegaPay webhook — receives the payment result after an STK push.
// Set this URL in your MegaPay account (Account Settings → Webhook):
//   http://169.58.58.133:5105/api/megapay/callback

export const megapayRoutes = new Hono();

type WebhookPayload = {
  ResponseCode?: number | string;
  ResponseDescription?: string;
  TransactionID?: string; // = transaction_request_id from initiatestk
  TransactionReceipt?: string;
  Msisdn?: string;
  TransactionAmount?: number;
};

megapayRoutes.post("/callback", async (c) => {
  const body = (await c.req.json().catch(() => null)) as WebhookPayload | null;
  if (!body?.TransactionID) {
    return c.json({ ok: false, error: "missing TransactionID" }, 400);
  }
  const db = getDb();
  const sale = db
    .select()
    .from(sales)
    .where(eq(sales.mpesaRequestId, body.TransactionID))
    .get();
  if (!sale) {
    log.info("megapay webhook for unknown transaction", {});
    return c.json({ ok: true }); // ack anyway so MegaPay stops retrying
  }
  if (sale.status !== "pending") {
    return c.json({ ok: true }); // already settled (poll or earlier webhook)
  }

  const code = Number(body.ResponseCode);
  if (code === 0) {
    db.update(sales)
      .set({ status: "completed", mpesaReceipt: body.TransactionReceipt ?? null })
      .where(eq(sales.id, sale.id))
      .run();
    log.info("megapay webhook: sale completed", { saleId: sale.id });
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
    log.info("megapay webhook: sale failed", { saleId: sale.id, code });
  }
  return c.json({ ok: true });
});
