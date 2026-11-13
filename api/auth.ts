import crypto from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { env } from "./lib/env";
import type { User } from "@db/schema";

// Password hashing with Node's built-in scrypt — no native deps.

const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .scryptSync(password, salt, SCRYPT_KEYLEN)
    .toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algo, salt, hash] = stored.split(":");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, "hex");
  return (
    candidate.length === expected.length &&
    crypto.timingSafeEqual(candidate, expected)
  );
}

// JWT session tokens (HS256).

const encoder = new TextEncoder();

export type TokenPayload = {
  sub: number; // user id
  role: "admin" | "cashier";
  shop: "A" | "B" | null;
  name: string;
};

export async function signToken(user: User): Promise<string> {
  return new SignJWT({
    role: user.role,
    shop: user.shop,
    name: user.displayName,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(encoder.encode(env.jwtSecret));
}

export async function verifyToken(
  token: string,
): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, encoder.encode(env.jwtSecret));
    return {
      sub: Number(payload.sub),
      role: payload.role as "admin" | "cashier",
      shop: (payload.shop as "A" | "B" | null) ?? null,
      name: String(payload.name ?? ""),
    };
  } catch {
    return null;
  }
}
