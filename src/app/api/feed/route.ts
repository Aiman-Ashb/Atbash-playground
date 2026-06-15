import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAgentFeed, feedConfigured } from "@/lib/chromia";
import { readToken, ADMIN_COOKIE, SESSION_COOKIE } from "@/lib/auth";
import { getSession } from "@/lib/sessions";

export const runtime = "nodejs";

/**
 * GET /api/feed — recent on-chain verdicts (public, read-only Chromia query).
 *
 * The agent is resolved PER CONTESTANT: each session carries the agent its code
 * was bound to, so a contestant sees their OWN agent's feed. An admin can pass
 * ?sessionId=<id> to watch a specific contestant's feed. Falls back to the
 * FEED_AGENT_PUBKEY env default (for codes with no bound agent, e.g. test codes).
 */
export async function GET(req: Request) {
  const jar = await cookies();
  const envDefault = (process.env.FEED_AGENT_PUBKEY || "").trim().replace(/^0x/, "");

  let pubkey = "";
  const sessionId = new URL(req.url).searchParams.get("sessionId");
  if (sessionId && readToken(jar.get(ADMIN_COOKIE)?.value) === "admin") {
    // Admin observing a specific contestant's session.
    pubkey = getSession(sessionId)?.agentPubkey || envDefault;
  } else {
    // Contestant viewing their own session's agent.
    const sid = readToken(jar.get(SESSION_COOKIE)?.value);
    pubkey = (sid ? getSession(sid)?.agentPubkey : "") || envDefault;
  }

  if (!feedConfigured(pubkey)) {
    // No agent yet — tell the client so it can prompt the contestant to set one.
    return NextResponse.json({ configured: false, agent: "", items: [] });
  }
  const items = await getAgentFeed(pubkey, 15);
  return NextResponse.json({ configured: true, agent: pubkey, items });
}
