/**
 * Read-only Chromia chain access for the verdict feed.
 *
 * Chromia queries are PUBLIC and unsigned — no key/auth needed. We pass the
 * agent's PUBLIC key as a query argument to scope the feed; the agent's private
 * key is never required (and must never live here — it's write/signing-only).
 */

const NODE = (process.env.CHROMIA_NODE_URL || "https://node0.testnet.chromia.com:7740")
  .split(",")[0]!.trim().replace(/\/+$/, "");
const BRID = (process.env.CHROMIA_BLOCKCHAIN_RID || "").trim();
const AGENT_PUBKEY = (process.env.FEED_AGENT_PUBKEY || "").trim().replace(/^0x/, "");

export type FeedItem = {
  id: string;
  at: number;
  verdict: "GREEN" | "YELLOW" | "RED" | "";
  action: string;
  reason: string;
  tool: string;
};

export function feedConfigured(): boolean {
  return Boolean(BRID && AGENT_PUBKEY);
}

/** POST a read query to the Chromia node REST endpoint. */
async function queryChain<T>(type: string, args: Record<string, unknown>): Promise<T | null> {
  if (!BRID) return null;
  try {
    const res = await fetch(`${NODE}/query/${BRID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, ...args }),
      // The feed polls often; let the platform cache briefly to ease load.
      next: { revalidate: 2 },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

type ActionRow = { created_at: number; judgment_id: string; verdict: string };
type FullRow = {
  command_text?: string;
  verdict_color?: string;
  verdict_reason?: string;
  tool_name?: string;
};

/** Recent judged actions for the configured agent, enriched with action + reason. */
export async function getAgentFeed(limit = 15): Promise<FeedItem[]> {
  if (!feedConfigured()) return [];
  const actions = await queryChain<ActionRow[]>("get_agent_actions", {
    agent_pubkey: AGENT_PUBKEY,
    max_count: limit,
  });
  if (!Array.isArray(actions)) return [];

  // Enrich each row with its full record (action text + reason) in parallel.
  const items = await Promise.all(
    actions.map(async (a): Promise<FeedItem> => {
      const full = await queryChain<FullRow>("get_tool_call_full", { tool_call_id: a.judgment_id });
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
