import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { eq } from "drizzle-orm";
import { users, type User } from "@db/schema";
import { getDb } from "./queries/connection";
import { verifyToken } from "./auth";

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  user?: User;
};

export async function createContext(
  opts: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  const ctx: TrpcContext = { req: opts.req, resHeaders: opts.resHeaders };

  const header = opts.req.headers.get("authorization");
  if (header?.startsWith("Bearer ")) {
    const payload = await verifyToken(header.slice(7));
    if (payload) {
      // Load the user fresh each request so deactivated accounts
      // and password resets take effect immediately.
      const user = getDb()
        .select()
        .from(users)
        .where(eq(users.id, payload.sub))
        .get();
      if (user && user.active) {
        ctx.user = user;
      }
    }
  }
  return ctx;
}
