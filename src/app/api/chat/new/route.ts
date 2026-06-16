import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readToken, SESSION_COOKIE } from "@/lib/auth";
import { getSession, appendMessage } from "@/lib/sessions";

export const runtime = "nodejs";

export async function POST() {
  const jar = await cookies();
  const sid = readToken(jar.get(SESSION_COOKIE)?.value);
  const session = sid ? getSession(sid) : undefined;
  
  if (!session) {
    return NextResponse.json({ error: "No active session." }, { status: 401 });
  }
  
  // Increment version to start a fresh Hermes session
  session.version = (session.version || 0) + 1;
  
  // Append a special reset system message to the session so the UI shows a visual indicator
  appendMessage(session.id, "system", "--- Session Reset ---");
  
  return NextResponse.json({ ok: true });
}
