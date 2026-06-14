/**
 * In-memory session store + event bus.
 *
 * Holds every contestant↔agent conversation so the admin observer can see full
 * history mid-session and live updates. Single-process only (fine for a
 * livestream event on one `next start`); swap for Redis/DB if you ever run
 * multiple instances.
 */

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

export type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  at: number;
  /** true while an assistant message is still streaming in */
  streaming?: boolean;
};

// "pending" = authenticated (e.g. Telegram-verified) but awaiting admin
// approval before it can chat. Code/generated-code sessions skip straight to
// "active" because the code itself is the authorization.
export type SessionStatus = "pending" | "active" | "ended";
export type SessionSource = "code" | "telegram";

export type Session = {
  id: string;
  /** the access code (or Telegram identity) that opened it */
  code: string;
  label: string;
  /** how the contestant entered — a plain code or a verified Telegram login */
  source: SessionSource;
  status: SessionStatus;
  createdAt: number;
  lastActivity: number;
  messages: Msg[];
};

// Survive Next.js hot-reload in dev by stashing on globalThis.
const g = globalThis as unknown as {
  __atbashSessions?: Map<string, Session>;
  __atbashBus?: EventEmitter;
};
const store: Map<string, Session> = (g.__atbashSessions ??= new Map());
const bus: EventEmitter = (g.__atbashBus ??= new EventEmitter());
bus.setMaxListeners(0); // many admin SSE subscribers

/** Emitted to admin observers on any change. */
export type BusEvent =
  | { type: "session"; session: SessionSummary }
  | { type: "message"; sessionId: string; message: Msg }
  | { type: "message-delta"; sessionId: string; messageId: string; content: string }
  | { type: "ended"; sessionId: string };

export type SessionSummary = Omit<Session, "messages"> & { messageCount: number };

function summarize(s: Session): SessionSummary {
  const { messages, ...rest } = s;
  return { ...rest, messageCount: messages.length };
}

export function createSession(
  code: string,
  label?: string,
  source: SessionSource = "code",
  status: SessionStatus = "active",
): Session {
  const id = randomUUID();
  const now = Date.now();
  const s: Session = {
    id,
    code,
    label: label || `Contestant ${store.size + 1}`,
    source,
    status,
    createdAt: now,
    lastActivity: now,
    messages: [],
  };
  store.set(id, s);
  bus.emit("event", { type: "session", session: summarize(s) } satisfies BusEvent);
  return s;
}

export function getSession(id: string): Session | undefined {
  return store.get(id);
}

export function listSessions(): SessionSummary[] {
  return [...store.values()]
    .sort((a, b) => b.lastActivity - a.lastActivity)
    .map(summarize);
}

export function appendMessage(sessionId: string, role: Msg["role"], content: string, streaming = false): Msg | undefined {
  const s = store.get(sessionId);
  if (!s) return undefined;
  const msg: Msg = { id: randomUUID(), role, content, at: Date.now(), streaming };
  s.messages.push(msg);
  s.lastActivity = msg.at;
  bus.emit("event", { type: "message", sessionId, message: msg } satisfies BusEvent);
  return msg;
}

/** Append a streaming token to an in-flight assistant message and notify observers. */
export function appendDelta(sessionId: string, messageId: string, delta: string): void {
  const s = store.get(sessionId);
  const msg = s?.messages.find((m) => m.id === messageId);
  if (!s || !msg) return;
  msg.content += delta;
  s.lastActivity = Date.now();
  bus.emit("event", { type: "message-delta", sessionId, messageId, content: delta } satisfies BusEvent);
}

export function finalizeMessage(sessionId: string, messageId: string): void {
  const msg = store.get(sessionId)?.messages.find((m) => m.id === messageId);
  if (msg) msg.streaming = false;
}

export function endSession(sessionId: string): void {
  const s = store.get(sessionId);
  if (!s) return;
  s.status = "ended";
  s.lastActivity = Date.now();
  bus.emit("event", { type: "ended", sessionId } satisfies BusEvent);
}

/** Admin approves a pending (e.g. Telegram) session so it can start chatting. */
export function approveSession(sessionId: string): boolean {
  const s = store.get(sessionId);
  if (!s || s.status !== "pending") return false;
  s.status = "active";
  s.lastActivity = Date.now();
  // Re-emit the summary so admin lists update; the contestant polls /api/session.
  bus.emit("event", { type: "session", session: summarize(s) } satisfies BusEvent);
  return true;
}

/** Subscribe to live events (admin observer). Returns an unsubscribe fn. */
export function subscribe(handler: (e: BusEvent) => void): () => void {
  bus.on("event", handler);
  return () => bus.off("event", handler);
}
