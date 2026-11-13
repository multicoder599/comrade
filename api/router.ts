import { createRouter, publicQuery } from "./middleware";
import { authRouter } from "./routers/auth";
import { productsRouter } from "./routers/products";
import { salesRouter } from "./routers/sales";
import { reportsRouter } from "./routers/reports";
import { settingsRouter } from "./routers/settings";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  products: productsRouter,
  sales: salesRouter,
  reports: reportsRouter,
  settings: settingsRouter,
});

export type AppRouter = typeof appRouter;
