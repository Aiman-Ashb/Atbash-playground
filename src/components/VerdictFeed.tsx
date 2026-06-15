"use client";

import { useEffect, useState } from "react";

type Item = {
  id: string;
  at: number;
  verdict: "GREEN" | "YELLOW" | "RED" | "";
  action: string;
  reason: string;
  tool: string;
};

function fmtTime(ms: number): string {
  if (!ms) return "";
  try {
    return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "";
  }
}

const LABEL: Record<string, string> = { GREEN: "PASS", YELLOW: "HOLD", RED: "BLOCK", "": "—" };

/** Right-side live feed of on-chain Atbash verdicts for the playground's agent. */
export function VerdictFeed() {
  const [items, setItems] = useState<Item[]>([]);
  const [configured, setConfigured] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    async function poll() {
      try {
        const d = await (await fetch("/api/feed")).json();
        if (cancelled) return;
        setConfigured(d.configured !== false);
        setItems(Array.isArray(d.items) ? d.items : []);
        setLoaded(true);
      } catch {
        /* keep last data on transient errors */
      }
      timer = setTimeout(poll, 5000);
    }
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return (
    <aside className="feed">
      <div className="feed-head">
        <span className="dot" /> Verdict feed
      </div>
      {!configured && <div className="feed-empty">Verdict feed not configured (set FEED_AGENT_PUBKEY).</div>}
      {configured && loaded && items.length === 0 && <div className="feed-empty">No verdicts yet for this agent.</div>}
      {configured && !loaded && <div className="feed-empty">Loading…</div>}
      {items.map((it) => (
        <div key={it.id} className={`vcard v-${(it.verdict || "none").toLowerCase()}`}>
          <div className="vtop">
            <span className="vbadge">{LABEL[it.verdict] ?? it.verdict}</span>
            <span className="vtime">{fmtTime(it.at)}</span>
          </div>
          {it.action && <div className="vaction">{it.action}</div>}
          {it.reason && <div className="vreason">{it.reason}</div>}
        </div>
      ))}
    </aside>
  );
}
