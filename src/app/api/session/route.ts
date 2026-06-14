import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isValidAccessCode, makeToken, readToken, SESSION_COOKIE } from "@/lib/auth";
import { createSession, getSession, endSession } from "@/lib/sessions";

export const runtime = "nodejs";

/** POST /api/session — validate access code, start a session, set cookie. */
export async function POST(req: Request) {
  const { code, label } = (await req.json().catch(() => ({}))) as { code?: string; label?: string };
  if (!code || !isValidAccessCode(code)) {
    return NextResponse.json({ error: "Invalid access code." }, { status: 401 });
  }
  const session = createSession(code, label);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, makeToken(session.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 4, // 4h
  });
  return NextResponse.json({ sessionId: session.id, label: session.label });
}

/** GET /api/session — current session info (for resuming after refresh). */
export async function GET() {
  const jar = await cookies();
  const sid = readToken(jar.get(SESSION_COOKIE)?.value);
  const session = sid ? getSession(sid) : undefined;
  if (!session || session.status !== "active") {
    return NextResponse.json({ session: null }, { status: 200 });
  }
  return NextResponse.json({
    session: { id: session.id, label: session.label, status: session.status, messages: session.messages },
  });
}

/** DELETE /api/session — end the current session and clear the cookie. */
export async function DELETE() {
  const jar = await cookies();
  const sid = readToken(jar.get(SESSION_COOKIE)?.value);
  if (sid) endSession(sid);
  jar.delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
