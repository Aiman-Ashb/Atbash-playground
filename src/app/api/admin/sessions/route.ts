import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readToken, ADMIN_COOKIE } from "@/lib/auth";
import { listSessions, getSession } from "@/lib/sessions";

export const runtime = "nodejs";

/**
 * GET /api/admin/sessions          → list of session summaries
 * GET /api/admin/sessions?id=<id>  → full message history for one session
 */
export async function GET(req: Request) {
  const jar = await cookies();
  if (readToken(jar.get(ADMIN_COOKIE)?.value) !== "admin") {
    return NextResponse.json({ error: "Admin login required." }, { status: 401 });
  }
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const s = getSession(id);
    if (!s) return NextResponse.json({ error: "Session not found." }, { status: 404 });
    return NextResponse.json({ session: s });
  }
  return NextResponse.json({ sessions: listSessions() });
}
