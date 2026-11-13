import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// The app bootstraps its own SQLite tables on startup (api/queries/connection.ts),
// so drizzle-kit is only needed if you want to inspect or diff the schema.
export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DATABASE_PATH || "./data/comrade-shop.db",
  },
});
