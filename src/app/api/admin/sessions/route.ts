import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readToken, ADMIN_COOKIE } from "@/lib/auth";
import { listSessions, getSession, endSession } from "@/lib/sessions";

export const runtime = "nodejs";

async function isAdmin(): Promise<boolean> {
  const jar = await cookies();
  return readToken(jar.get(ADMIN_COOKIE)?.value) === "admin";
}

/**
 * GET /api/admin/sessions          → list of session summaries
 * GET /api/admin/sessions?id=<id>  → full message history for one session
 */
export async function GET(req: Request) {
  if (!(await isAdmin())) {
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

/** POST { action: "end", id } — admin force-ends an active session. */
export async function POST(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Admin login required." }, { status: 401 });
  }
  const { action, id } = (await req.json().catch(() => ({}))) as { action?: string; id?: string };
  if (action === "end" && id) {
    endSession(id);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
