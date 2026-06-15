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
  const [agent, setAgent] = useState("");
  const [input, setInput] = useState("");
  const [editing, setEditing] = useState(false);
  const [savingErr, setSavingErr] = useState("");

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    async function poll() {
      try {
        const d = await (await fetch("/api/feed")).json();
        if (cancelled) return;
        setConfigured(d.configured !== false);
        setAgent(d.agent || "");
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

  async function saveAgent(e: React.FormEvent) {
    e.preventDefault();
    setSavingErr("");
    const res = await fetch("/api/session/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pubkey: input.trim() }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSavingErr(d.error || "Could not set agent.");
      return;
    }
    setAgent(d.agent || "");
    setEditing(false);
    setLoaded(false); // trigger a fresh "loading" until the next poll lands
  }

  const showForm = editing || !agent;

  return (
    <aside className="feed">
      <div className="feed-head">
        <span><span className="dot" /> Verdict feed</span>
        {agent && !editing && (
          <button className="link-btn" onClick={() => { setInput(agent); setEditing(true); }}>change agent</button>
        )}
      </div>

      {showForm && (
        <form className="feed-form" onSubmit={saveAgent}>
          <label>Your agent pubkey</label>
          <input
            className="input"
            style={{ fontSize: 11, padding: "7px 8px" }}
            placeholder="paste agent pubkey (hex)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoFocus
          />
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <button className="mini" type="submit" disabled={!input.trim()}>Show verdicts</button>
            {agent && <button className="mini danger" type="button" onClick={() => setEditing(false)}>Cancel</button>}
          </div>
          {savingErr && <div className="error" style={{ fontSize: 11 }}>{savingErr}</div>}
        </form>
      )}

      {!showForm && agent && <div className="feed-agent">agent: {agent.slice(0, 12)}…</div>}
      {!showForm && !configured && <div className="feed-empty">Verdict feed unavailable.</div>}
      {!showForm && configured && loaded && items.length === 0 && <div className="feed-empty">No verdicts yet for this agent.</div>}
      {!showForm && configured && !loaded && <div className="feed-empty">Loading…</div>}
      {!showForm && items.map((it) => (
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
