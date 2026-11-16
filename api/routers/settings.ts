import { z } from "zod";
import { settings } from "@db/schema";
import { getDb } from "../queries/connection";
import { createRouter, publicQuery, authedQuery, adminQuery } from "../middleware";
import { isMegaPayReady } from "../megapay";
import { env } from "../lib/env";

const EDITABLE_KEYS = [
  "business_name",
  "shop_a_name",
  "shop_b_name",
  "paybill_a",
  "paybill_a_account",
  "paybill_b",
  "paybill_b_account",
  "contact_phone",
] as const;
type EditableKey = (typeof EDITABLE_KEYS)[number];

export const settingsRouter = createRouter({
  // Public: the login pages need the port split before anyone is signed in,
  // so the till port never shows the admin UI and vice versa.
  ports: publicQuery.query(() => ({
    shopPort: env.shopPort,
    adminPort: env.adminPort,
    // Public so the login screens can show what's deployed.
    appVersion: env.appVersion,
  })),

  get: authedQuery.query(() => {
    const db = getDb();
    const rows = db.select().from(settings).all();
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return {
      businessName: map["business_name"] ?? "Comrade Shop",
      shopAName: map["shop_a_name"] ?? "Comrade Shop A",
      shopBName: map["shop_b_name"] ?? "Comrade Shop B",
      // Printed at the bottom of every receipt so walk-in customers can pay
      // by paybill later. Editable from admin Settings.
      paybillA: map["paybill_a"] ?? "400200",
      paybillAAccount: map["paybill_a_account"] ?? "1194190",
      paybillB: map["paybill_b"] ?? "400200",
      paybillBAccount: map["paybill_b_account"] ?? "1194216",
      contactPhone: map["contact_phone"] ?? "0740223452",
      currency: "KES",
      // Per-shop: each shop prompts through its own MegaPay account.
      megapayConfigured: {
        A: isMegaPayReady("A"),
        B: isMegaPayReady("B"),
      },
      // Deployed app version + this server process's boot id. The tills poll
      // bootId — when it changes, a new version was deployed and the till
      // offers a one-tap refresh instead of silently running stale code.
      appVersion: env.appVersion,
      bootId: env.bootId,
    };
  }),

  update: adminQuery
    .input(
      z.object({
        businessName: z.string().min(1).max(80).optional(),
        shopAName: z.string().min(1).max(80).optional(),
        shopBName: z.string().min(1).max(80).optional(),
        paybillA: z.string().min(1).max(20).optional(),
        paybillAAccount: z.string().min(1).max(40).optional(),
        paybillB: z.string().min(1).max(20).optional(),
        paybillBAccount: z.string().min(1).max(40).optional(),
        contactPhone: z.string().min(1).max(20).optional(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDb();
      const pairs: [EditableKey, string | undefined][] = [
        ["business_name", input.businessName],
        ["shop_a_name", input.shopAName],
        ["shop_b_name", input.shopBName],
        ["paybill_a", input.paybillA],
        ["paybill_a_account", input.paybillAAccount],
        ["paybill_b", input.paybillB],
        ["paybill_b_account", input.paybillBAccount],
        ["contact_phone", input.contactPhone],
      ];
      for (const [key, value] of pairs) {
        if (value === undefined) continue;
        db.insert(settings)
          .values({ key, value })
          .onConflictDoUpdate({ target: settings.key, set: { value } })
          .run();
      }
      return { ok: true };
    }),
});
