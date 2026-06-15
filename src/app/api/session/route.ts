import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readToken, SESSION_COOKIE } from "@/lib/auth";
import { getSession } from "@/lib/sessions";

export const runtime = "nodejs";

// Sessions are STARTED via POST /api/enter (the unified code gate). This route
// only resumes (GET) the current contestant session.

/** GET /api/session — current session info. Returns pending sessions too so a
 *  Telegram user awaiting approval can poll until the admin lets them in; only
 *  ended/missing sessions return null. */
export async function GET() {
  const jar = await cookies();
  const sid = readToken(jar.get(SESSION_COOKIE)?.value);
  const session = sid ? getSession(sid) : undefined;
  if (!session || session.status === "ended") {
    return NextResponse.json({ session: null }, { status: 200 });
  }
  return NextResponse.json({
    session: { id: session.id, label: session.label, status: session.status, messages: session.messages },
  });
}

