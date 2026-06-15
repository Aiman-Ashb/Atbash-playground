import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAgentFeed, networkByName, type Network } from "@/lib/chromia";
import { readToken, ADMIN_COOKIE, SESSION_COOKIE } from "@/lib/auth";
import { getSession, type Session } from "@/lib/sessions";

export const runtime = "nodejs";

/**
 * GET /api/feed — recent on-chain verdicts (public, read-only).
 *
 * The agent + its network are resolved PER SESSION (set by the contestant or
 * bound to their code). Admins can pass ?sessionId=<id> to watch a specific
 * contestant's feed. Returns the agent + network so the panel can show context.
 */
export async function GET(req: Request) {
  const jar = await cookies();

  let session: Session | undefined;
  const sessionId = new URL(req.url).searchParams.get("sessionId");
  if (sessionId && readToken(jar.get(ADMIN_COOKIE)?.value) === "admin") {
    session = getSession(sessionId);
  } else {
    const sid = readToken(jar.get(SESSION_COOKIE)?.value);
    session = sid ? getSession(sid) : undefined;
  }

  const pubkey = session?.agentPubkey || "";
  // Use the detected network; fall back to public if the session predates it.
  const net: Network | null = networkByName(session?.agentNetwork) || networkByName("public");

  if (!pubkey || !net) {
    return NextResponse.json({ configured: false, agent: "", network: null, items: [] });
  }
  const items = await getAgentFeed(pubkey, net, 15);
  return NextResponse.json({ configured: true, agent: pubkey, network: net.name, items });
}
