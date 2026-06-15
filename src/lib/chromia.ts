/**
 * Read-only Chromia access for the verdict feed, across multiple networks.
 *
 * Agents can live on the public testnet OR a private subnode, and an agent's
 * verdicts live on whatever chain it's registered on. So when a contestant sets
 * a pubkey we DETECT which network the agent is on (is_agent_registered probe),
 * remember it, and query the feed on that chain.
 *
 * All queries are PUBLIC and unsigned — only the agent's public key is used.
 */

export type Network = { name: string; nodeUrl: string; brid: string };

export type FeedItem = {
  id: string;
  at: number;
  verdict: "GREEN" | "YELLOW" | "RED" | "";
  action: string;
  reason: string;
  tool: string;
};

function clean(url: string): string {
  return (url || "").split(",")[0]!.trim().replace(/\/+$/, "");
}

/** Candidate networks to probe, from env. Public first, then private. */
export function networks(): Network[] {
  const list: Network[] = [];
  const pubBrid = (process.env.CHROMIA_BLOCKCHAIN_RID || "").trim();
  const pubUrl = clean(process.env.CHROMIA_NODE_URL || "https://node0.testnet.chromia.com:7740");
  if (pubBrid) list.push({ name: "public", nodeUrl: pubUrl, brid: pubBrid });

  const privBrid = (process.env.PRIVATE_BLOCKCHAIN_RID || "").trim();
  const privUrl = clean(process.env.PRIVATE_CHROMIA_NODE_URL || "");
  if (privBrid && privUrl) list.push({ name: "private", nodeUrl: privUrl, brid: privBrid });

  return list;
}

export function networkByName(name: string | undefined): Network | null {
  return networks().find((n) => n.name === name) ?? null;
}

/** POST a read query to a specific network's node. */
async function queryOn<T>(net: Network, type: string, args: Record<string, unknown>): Promise<T | null> {
  try {
    const res = await fetch(`${net.nodeUrl}/query/${net.brid}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, ...args }),
      next: { revalidate: 2 },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Find which configured network an agent is registered on (or null). */
export async function detectAgentNetwork(pubkey: string): Promise<Network | null> {
  const hex = pubkey.trim().replace(/^0x/, "");
  if (!hex) return null;
  for (const net of networks()) {
    const reg = await queryOn<boolean | number>(net, "is_agent_registered", { pubkey: hex });
    if (reg === true || reg === 1) return net;
  }
  return null;
}

type ActionRow = { created_at: number; judgment_id: string; verdict: string };
type FullRow = { command_text?: string; verdict_color?: string; verdict_reason?: string; tool_name?: string };

/** Recent judged actions for an agent on a given network, enriched with reason. */
export async function getAgentFeed(pubkey: string, net: Network, limit = 15): Promise<FeedItem[]> {
  const hex = pubkey.trim().replace(/^0x/, "");
  if (!hex || !net) return [];
  const actions = await queryOn<ActionRow[]>(net, "get_agent_actions", { agent_pubkey: hex, max_count: limit });
  if (!Array.isArray(actions)) return [];

  const items = await Promise.all(
    actions.map(async (a): Promise<FeedItem> => {
      const full = await queryOn<FullRow>(net, "get_tool_call_full", { tool_call_id: a.judgment_id });
      const verdict = (full?.verdict_color || a.verdict || "").toUpperCase();
      return {
        id: a.judgment_id,
        at: Number(a.created_at) || 0,
        verdict: (verdict === "GREEN" || verdict === "YELLOW" || verdict === "RED" ? verdict : "") as FeedItem["verdict"],
        action: full?.command_text || "",
        reason: full?.verdict_reason || "",
        tool: full?.tool_name && full.tool_name !== "unknown" ? full.tool_name : "",
      };
    }),
  );
  return items;
}
