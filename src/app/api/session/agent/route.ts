import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readToken, SESSION_COOKIE } from "@/lib/auth";
import { getSession, setSessionAgent } from "@/lib/sessions";
import { detectAgentNetwork } from "@/lib/chromia";

export const runtime = "nodejs";

/**
 * POST /api/session/agent { pubkey } — the contestant sets which agent's verdict
 * feed they want to see. We DETECT which network the agent lives on (public vs
 * private) and store both on the session; /api/feed then queries that network.
 * Returns the detected network. Rejects a pubkey not found on any known network.
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

  // Clearing the agent.
  if (hex === "") {
    setSessionAgent(session.id, "");
    return NextResponse.json({ ok: true, agent: "", network: null });
  }

  if (!/^[0-9a-f]+$/.test(hex) || hex.length % 2 !== 0 || hex.length < 2 || hex.length > 130) {
    return NextResponse.json({ error: "Pubkey must be even-length hex." }, { status: 400 });
  }

  // Detect which network the agent is registered on (public/private).
  const net = await detectAgentNetwork(hex);
  if (!net) {
    return NextResponse.json(
      { error: "Agent not found on the public or private network. Check the pubkey." },
      { status: 404 },
    );
  }

  setSessionAgent(session.id, hex, net.name);
  return NextResponse.json({ ok: true, agent: hex, network: net.name });
}
