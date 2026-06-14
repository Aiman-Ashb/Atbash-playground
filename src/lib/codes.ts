/**
 * Admin-generated contestant codes (in-memory, single-process like the rest).
 *
 * Static env codes (ACCESS_CODES) still work for testing; these are the codes
 * an admin mints live during an event. Each is unique → it's the contestant's
 * identity. Revoking one is independent of every other code/session.
 */

import { randomBytes } from "node:crypto";

export type GeneratedCode = {
  code: string;
  label: string;
  createdAt: number;
  /** set to the session id once a contestant opens a chat with this code */
  usedBySession?: string;
};

const g = globalThis as unknown as { __atbashCodes?: Map<string, GeneratedCode> };
const store: Map<string, GeneratedCode> = (g.__atbashCodes ??= new Map());

// Unambiguous alphabet (no 0/O/1/I/L) — easy to read aloud on a livestream.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function randomCode(len = 6): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

/** Mint a fresh unique code. `label` is the name shown to the admin/stream. */
export function generateCode(label?: string): GeneratedCode {
  let code = randomCode();
  while (store.has(code)) code = randomCode(); // collision-safe
  const entry: GeneratedCode = {
    code,
    label: label?.trim() || `Contestant ${store.size + 1}`,
    createdAt: Date.now(),
  };
  store.set(code, entry);
  return entry;
}

export function listCodes(): GeneratedCode[] {
  return [...store.values()].sort((a, b) => b.createdAt - a.createdAt);
}

/** True if this is a currently-valid (not revoked) admin-generated code. */
export function isGeneratedCode(code: string): boolean {
  return store.has(code.trim());
}

export function getCode(code: string): GeneratedCode | undefined {
  return store.get(code.trim());
}

/** Revoke (cancel) a code so it can no longer open a session. */
export function revokeCode(code: string): boolean {
  return store.delete(code.trim());
}

/** Link a code to the session it opened (for the admin's at-a-glance status). */
export function markCodeUsed(code: string, sessionId: string): void {
  const entry = store.get(code.trim());
  if (entry) entry.usedBySession = sessionId;
}
