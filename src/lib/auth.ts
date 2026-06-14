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

function parseCodes(raw: string | undefined): Set<string> {
  return new Set(
    (raw || "")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean),
  );
}

/** Valid contestant access codes (comma-separated env). Give each contestant a
 *  UNIQUE one — the code is their identity, so per-user tracking is automatic. */
export function validAccessCodes(): Set<string> {
  return parseCodes(process.env.ACCESS_CODES);
}

/** Admin codes (comma-separated). Falls back to ADMIN_PASSWORD for back-compat. */
export function adminCodes(): Set<string> {
  const codes = parseCodes(process.env.ADMIN_CODES);
  const legacy = (process.env.ADMIN_PASSWORD || "").trim();
  if (legacy) codes.add(legacy);
  return codes;
}

export type Role = "admin" | "contestant";

/**
 * Classify a submitted code into a role, or null if unknown. Admin is checked
 * first so an admin code is never treated as a contestant code. Matching is
 * constant-time-ish across the known sets (small, fixed lists for an event).
 */
export function classifyCode(code: string): Role | null {
  const c = code.trim();
  if (!c) return null;
  if (adminCodes().has(c)) return "admin";
  if (validAccessCodes().has(c)) return "contestant";
  return null;
}

export function isValidAccessCode(code: string): boolean {
  return validAccessCodes().has(code.trim());
}

export function isValidAdminPassword(password: string): boolean {
  return adminCodes().has(password.trim());
}
