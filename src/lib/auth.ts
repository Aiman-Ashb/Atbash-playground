/**
 * Minimal stateless auth: HMAC-signed cookie values. No DB, no external IdP —
 * enough to gate contestants by access code and admins by password for an
 * event. For public-internet hardening later, put this behind real auth.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const SECRET = process.env.AUTH_SECRET || "dev-only-insecure-secret";

export const SESSION_COOKIE = "atbash_session";
export const ADMIN_COOKIE = "atbash_admin";

function sign(value: string): string {
  return createHmac("sha256", SECRET).update(value).digest("hex");
}

/** Make a `value.signature` token. */
export function makeToken(value: string): string {
  return `${value}.${sign(value)}`;
}

/** Verify a `value.signature` token; returns the value or null. */
export function readToken(token: string | undefined): string | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const value = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(value);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return value;
}

/** Valid contestant access codes from env (comma-separated). */
export function validAccessCodes(): Set<string> {
  return new Set(
    (process.env.ACCESS_CODES || "")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean),
  );
}

export function isValidAccessCode(code: string): boolean {
  return validAccessCodes().has(code.trim());
}

export function isValidAdminPassword(password: string): boolean {
  const expected = process.env.ADMIN_PASSWORD || "";
  if (!expected) return false;
  const a = Buffer.from(password);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
