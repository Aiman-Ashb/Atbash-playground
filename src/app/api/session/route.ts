import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readToken, SESSION_COOKIE } from "@/lib/auth";
import { getSession, endSession } from "@/lib/sessions";

export const runtime = "nodejs";

// Sessions are STARTED via POST /api/enter (the unified code gate). This route
// only resumes (GET) and ends (DELETE) the current contestant session.

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
