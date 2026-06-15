import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readToken, SESSION_COOKIE } from "@/lib/auth";
import { getSession, setSessionAgent } from "@/lib/sessions";

export const runtime = "nodejs";

/**
 * POST /api/session/agent { pubkey } — the contestant sets which agent's verdict
 * feed they want to see (read-only public chain data, so self-set is safe). The
 * pubkey is stored on their session; /api/feed reads it back.
 */
export async function POST(req: Request) {
  const jar = await cookies();
  const sid = readToken(jar.get(SESSION_COOKIE)?.value);
  const session = sid ? getSession(sid) : undefined;
  if (!session || session.status === "ended") {
    return NextResponse.json({ error: "No active session." }, { status: 401 });
  }

  const { pubkey } = (await req.json().catch(() => ({}))) as { pubkey?: string };
  const hex = (pubkey ?? "").trim().replace(/^0x/, "").toLowerCase();
  if (hex !== "" && (!/^[0-9a-f]+$/.test(hex) || hex.length % 2 !== 0 || hex.length < 2 || hex.length > 130)) {
    return NextResponse.json({ error: "Pubkey must be even-length hex." }, { status: 400 });
  }
  setSessionAgent(session.id, hex);
  return NextResponse.json({ ok: true, agent: hex });
}
