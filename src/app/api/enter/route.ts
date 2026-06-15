import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminCodes, isValidAccessCode, makeToken, SESSION_COOKIE, ADMIN_COOKIE } from "@/lib/auth";
import { createSession, getActiveSessionByCode, type Session } from "@/lib/sessions";
import { getCode, markCodeUsed } from "@/lib/codes";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";

function setContestantCookie(jar: Awaited<ReturnType<typeof cookies>>, session: Session) {
  jar.set(SESSION_COOKIE, makeToken(session.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 4,
  });
}

/**
 * POST /api/enter — single entry point. Body is either { code } (admin or
 * contestant code) or { telegram: <signed login payload> }. The server decides
 * the role; the observer surface is never advertised. Telegram is an IDENTITY
 * only — a verified Telegram user gets a normal Hermes-backed contestant session.
 */
export async function POST(req: Request) {
  // One brute-force guard for the whole gate: 10 attempts / 5 min per IP.
  const rl = rateLimit(`enter:${clientIp(req)}`, 10, 5 * 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    code?: string;
    telegramHandle?: string;
    agentId?: string;
  };
  const jar = await cookies();
  const secure = process.env.NODE_ENV === "production";

  // ── Telegram by typed username/ID: UNVERIFIED self-claim ──
  // Admin approval is the gate — the admin vets the handle before letting them
  // in. Prefix "tgc:" marks the code as a claimed (unverified) Telegram handle.
  if (typeof body.telegramHandle === "string") {
    const handle = body.telegramHandle.trim().replace(/^@/, "");
    if (!handle || handle.length > 64 || !/^[A-Za-z0-9_]+$/.test(handle)) {
      return NextResponse.json({ error: "Enter a valid Telegram username or numeric ID." }, { status: 400 });
    }
    const label = /^\d+$/.test(handle) ? `tg:${handle}` : `@${handle}`;
    const code = `tgc:${handle}`;
    let session = getActiveSessionByCode(code);
    if (!session) {
      session = createSession(code, label, "telegram", "pending", body.agentId);
    } else if (body.agentId) {
      session.agentId = body.agentId;
    }
    setContestantCookie(jar, session);
    return NextResponse.json({ role: "contestant", status: session.status, label: session.label });
  }

  const code = body.code?.trim();
  if (!code) return NextResponse.json({ error: "Invalid code." }, { status: 401 });

  const generated = getCode(code);

  // Admin first, so an admin code is never treated as a contestant code.
  // Admin = static env code OR an admin-role generated code.
  if (adminCodes().has(code) || generated?.role === "admin") {
    jar.set(ADMIN_COOKIE, makeToken("admin"), {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: 60 * 60 * 12,
    });
    return NextResponse.json({ role: "admin" });
  }

  // Contestant: static env code OR a contestant-role generated code.
  if (!isValidAccessCode(code) && generated?.role !== "contestant") {
    return NextResponse.json({ error: "Invalid code." }, { status: 401 });
  }

  // Reuse an active session for this code if one exists, else create it.
  // agentId = the OpenClaw agent to run; agentPubkey (bound to the code) = the
  // agent whose verdict feed this contestant sees.
  let session = getActiveSessionByCode(code);
  if (!session) {
    session = createSession(code, generated?.label, "code", "active", body.agentId, generated?.agentPubkey);
    markCodeUsed(code, session.id);
  } else if (body.agentId) {
    session.agentId = body.agentId;
  }
  setContestantCookie(jar, session);
  return NextResponse.json({ role: "contestant", label: session.label });
}
