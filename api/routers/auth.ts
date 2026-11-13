import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { users } from "@db/schema";
import { getDb } from "../queries/connection";
import { hashPassword, signToken, verifyPassword } from "../auth";
import { createRouter, publicQuery, authedQuery, adminQuery } from "../middleware";

function publicUser(u: typeof users.$inferSelect) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    shop: u.shop,
    active: u.active,
  };
}

export const authRouter = createRouter({
  login: publicQuery
    .input(
      z.object({
        username: z.string().min(1),
        password: z.string().min(1),
        shop: z.enum(["A", "B"]).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const user = db
        .select()
        .from(users)
        .where(eq(users.username, input.username.trim().toLowerCase()))
        .get();
      if (!user || !user.active || !verifyPassword(input.password, user.passwordHash)) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Wrong username or password",
        });
      }
      if (user.role === "cashier") {
        if (!input.shop) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Select a shop to log into",
          });
        }
        if (user.shop !== input.shop) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `This account belongs to Shop ${user.shop}`,
          });
        }
      }
      const token = await signToken(user);
      return { token, user: publicUser(user) };
    }),

  me: authedQuery.query(({ ctx }) => publicUser(ctx.user)),

  changePassword: authedQuery
    .input(
      z.object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(6, "At least 6 characters"),
      }),
    )
    .mutation(({ ctx, input }) => {
      if (!verifyPassword(input.currentPassword, ctx.user.passwordHash)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Current password is wrong",
        });
      }
      getDb()
        .update(users)
        .set({ passwordHash: hashPassword(input.newPassword) })
        .where(eq(users.id, ctx.user.id))
        .run();
      return { ok: true };
    }),

  // --- user management (admin) ---

  listUsers: adminQuery.query(() => {
    return getDb().select().from(users).all().map(publicUser);
  }),

  createUser: adminQuery
    .input(
      z.object({
        username: z.string().min(3).regex(/^[a-z0-9_]+$/i, "Letters, numbers, _ only"),
        password: z.string().min(6, "At least 6 characters"),
        displayName: z.string().min(1),
        role: z.enum(["admin", "cashier"]),
        shop: z.enum(["A", "B"]).optional(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDb();
      const username = input.username.trim().toLowerCase();
      const existing = db.select().from(users).where(eq(users.username, username)).get();
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "Username already taken" });
      }
      if (input.role === "cashier" && !input.shop) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cashier needs a shop" });
      }
      const info = db
        .insert(users)
        .values({
          username,
          passwordHash: hashPassword(input.password),
          displayName: input.displayName.trim(),
          role: input.role,
          shop: input.role === "cashier" ? (input.shop ?? null) : null,
        })
        .run();
      return { id: Number(info.lastInsertRowid) };
    }),

  updateUser: adminQuery
    .input(
      z.object({
        id: z.number().int(),
        displayName: z.string().min(1).optional(),
        password: z.string().min(6).optional(),
        active: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const db = getDb();
      const target = db.select().from(users).where(eq(users.id, input.id)).get();
      if (!target) throw new TRPCError({ code: "NOT_FOUND" });
      if (target.id === ctx.user.id && input.active === false) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot deactivate your own account",
        });
      }
      db.update(users)
        .set({
          ...(input.displayName ? { displayName: input.displayName.trim() } : {}),
          ...(input.password ? { passwordHash: hashPassword(input.password) } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
        })
        .where(eq(users.id, input.id))
        .run();
      return { ok: true };
    }),
});
