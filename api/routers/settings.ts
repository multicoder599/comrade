import { z } from "zod";
import { settings } from "@db/schema";
import { getDb } from "../queries/connection";
import { createRouter, publicQuery, authedQuery, adminQuery } from "../middleware";
import { isMegaPayReady } from "../megapay";
import { env } from "../lib/env";

const EDITABLE_KEYS = ["business_name", "shop_a_name", "shop_b_name"] as const;
type EditableKey = (typeof EDITABLE_KEYS)[number];

export const settingsRouter = createRouter({
  // Public: the login pages need the port split before anyone is signed in,
  // so the till port never shows the admin UI and vice versa.
  ports: publicQuery.query(() => ({
    shopPort: env.shopPort,
    adminPort: env.adminPort,
  })),

  get: authedQuery.query(() => {
    const db = getDb();
    const rows = db.select().from(settings).all();
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return {
      businessName: map["business_name"] ?? "Comrade Shop",
      shopAName: map["shop_a_name"] ?? "Comrade Shop A",
      shopBName: map["shop_b_name"] ?? "Comrade Shop B",
      currency: "KES",
      megapayConfigured: isMegaPayReady(),
    };
  }),

  update: adminQuery
    .input(
      z.object({
        businessName: z.string().min(1).max(80).optional(),
        shopAName: z.string().min(1).max(80).optional(),
        shopBName: z.string().min(1).max(80).optional(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDb();
      const pairs: [EditableKey, string | undefined][] = [
        ["business_name", input.businessName],
        ["shop_a_name", input.shopAName],
        ["shop_b_name", input.shopBName],
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
