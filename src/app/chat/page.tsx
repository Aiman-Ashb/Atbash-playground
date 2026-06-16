"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Msg = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  streaming?: boolean;
  approval?: { command: string; description: string; allow_permanent: boolean; choice?: string };
};

const SUGGESTED_COMMANDS = [
  { name: "/help", desc: "Show available commands" },
  { name: "/new", desc: "Start a new session (fresh session ID + history)" },
  { name: "/stop", desc: "Kill all running background processes" },
  { name: "/status", desc: "Show session info" },
  { name: "/resume", desc: "Resume a previously-named session" },
  { name: "/sessions", desc: "Browse and resume previous sessions" },
  { name: "/model", desc: "Switch model for this session" },
  { name: "/debug", desc: "Upload debug report (system info + logs) and get shareable links" }
];

export default function ChatPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<"loading" | "pending" | "active">("loading");
  const [label, setLabel] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [agentStatus, setAgentStatus] = useState<string | null>(null);
  const [pendingNewAction, setPendingNewAction] = useState<{ msgId: string } | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [filteredSuggestions, setFilteredSuggestions] = useState<typeof SUGGESTED_COMMANDS>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  function handleInputChange(val: string) {
    setInput(val);
    if (val.startsWith("/")) {
      const filtered = SUGGESTED_COMMANDS.filter((cmd) =>
        cmd.name.toLowerCase().startsWith(val.toLowerCase())
      );
      if (filtered.length > 0) {
        setFilteredSuggestions(filtered);
        setShowSuggestions(true);
        setSelectedIndex((prev) => (prev >= filtered.length ? 0 : prev));
      } else {
        setShowSuggestions(false);
      }
    } else {
      setShowSuggestions(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showSuggestions || filteredSuggestions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % filteredSuggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredSuggestions.length) % filteredSuggestions.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      selectSuggestion(filteredSuggestions[selectedIndex].name);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setShowSuggestions(false);
    }
  }

  function selectSuggestion(name: string) {
    setInput(name);
    setShowSuggestions(false);
  }

  async function refreshMessages() {
    try {
      const d = await (await fetch("/api/session")).json();
      if (d.session && d.session.messages) {
        setMessages(d.session.messages);
      }
    } catch (err) {
      console.error("Failed to refresh messages:", err);
    }
  }

  async function startNewSession() {
    try {
      setSending(true);
      setError("");
      const res = await fetch("/api/chat/new", { method: "POST" });
      if (!res.ok) {
        throw new Error("Failed to start a new session.");
      }
      await refreshMessages();
      setSending(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset session.");
      setSending(false);
    }
  }

  // Entry happens at "/". A code session is already active; a Telegram session
  // starts "pending" — we poll until an admin approves it (or it's gone).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    async function check() {
      try {
        const d = await (await fetch("/api/session")).json();
        if (cancelled) return;
        if (!d.session) return router.replace("/");
        setLabel(d.session.label);
        if (d.session.status === "active") {
          setMessages(d.session.messages ?? []);
          setPhase("active");
        } else {
          setPhase("pending");
          timer = setTimeout(check, 2500); // keep polling until approved
        }
      } catch {
        if (!cancelled) router.replace("/");
      }
    }

    check();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [router]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    setInput("");

    if (text === "/new") {
      const unansweredMsg = messages.find((m) => m.approval && !m.approval.choice);
      if (unansweredMsg) {
        setPendingNewAction({ msgId: unansweredMsg.id });
      } else {
        startNewSession();
      }
      return;
    }

    if (text === "/help") {
      const helpMsg: Msg = {
        id: `sys-${Date.now()}`,
        role: "system",
        content: `Available Commands:\n• /new - Start a fresh session with clean agent memory.\n• /help - Show this list of available commands.\n• /status - Show current session ID and agent status.\n• /stop - Terminate any running tools or commands.`
      };
      setMessages((m) => [...m, { id: `u-${Date.now()}`, role: "user", content: text }, helpMsg]);
      return;
    }

    if (text === "/status") {
      const statusMsg: Msg = {
        id: `sys-${Date.now()}`,
        role: "system",
        content: `Session ID: ${label || "Not set"}\nAgent Profile: tejo3\nStatus: Active`
      };
      setMessages((m) => [...m, { id: `u-${Date.now()}`, role: "user", content: text }, statusMsg]);
      return;
    }

    if (text === "/stop") {
      setSending(false);
      setAgentStatus(null);
      const stopMsg: Msg = {
        id: `sys-${Date.now()}`,
        role: "system",
        content: `Cancelled active operations.`
      };
      setMessages((m) => [...m, { id: `u-${Date.now()}`, role: "user", content: text }, stopMsg]);
      return;
    }

    if (text === "/model" || text === "/resume" || text === "/sessions" || text === "/debug") {
      const infoMsg: Msg = {
        id: `sys-${Date.now()}`,
        role: "system",
        content: `Command ${text} is specific to the Hermes CLI / TUI and is not available in the web playground.`
      };
      setMessages((m) => [...m, { id: `u-${Date.now()}`, role: "user", content: text }, infoMsg]);
      return;
    }

    setSending(true);
    setError("");
    setAgentStatus("Agent is thinking…");

    const userMsg: Msg = { id: `u-${Date.now()}`, role: "user", content: text };
    const assistantMsg: Msg = { id: `a-${Date.now()}`, role: "assistant", content: "", streaming: true };
    setMessages((m) => [...m, userMsg, assistantMsg]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Agent unavailable.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const evt of events) {
          const evName = evt.match(/^event: (.*)$/m)?.[1];
          const dataLine = evt.match(/^data: (.*)$/m)?.[1];
          if (!dataLine) continue;
          const data = JSON.parse(dataLine);
          if (evName === "delta") {
            setAgentStatus(null);
            setMessages((m) =>
              m.map((x) => (x.id === assistantMsg.id ? { ...x, content: x.content + data.text } : x)),
            );
          } else if (evName === "progress") {
            let friendly = `executing ${data.tool}`;
            if (data.tool === "read_file" || data.tool === "view_file") friendly = "reading files";
            else if (data.tool === "write_to_file" || data.tool === "replace_file_content" || data.tool === "multi_replace_file_content") friendly = "writing files";
            else if (data.tool === "grep_search" || data.tool === "list_dir") friendly = "searching codebase";
            else if (data.tool === "run_command") friendly = "running shell command";
            else if (data.tool === "search_web") friendly = "searching the web";
            setAgentStatus(`Agent is ${friendly}…`);
          } else if (evName === "approval_required") {
            setAgentStatus(null);
            setMessages((m) =>
              m.map((x) => (x.id === assistantMsg.id ? { ...x, approval: { ...data } } : x)),
            );
          } else if (evName === "error") {
            setAgentStatus(null);
            setError(data.error || "Agent error.");
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Agent unavailable.");
    } finally {
      setAgentStatus(null);
      setMessages((m) => m.map((x) => (x.id === assistantMsg.id ? { ...x, streaming: false } : x)));
      setSending(false);
    }
  }

  async function submitApproval(messageId: string, choice: string) {
    try {
      setError("");
      const res = await fetch("/api/chat/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ choice })
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to submit approval.");
      }
      
      setMessages((m) =>
        m.map((x) => (x.id === messageId ? { ...x, approval: x.approval ? { ...x.approval, choice } : undefined } : x))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve.");
    }
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.replace("/");
  }

  if (phase === "loading") return <div className="center"><div className="sub">Loading…</div></div>;

  if (phase === "pending") {
    return (
      <div className="center">
        <div className="card" style={{ textAlign: "center" }}>
          <div className="spinner" />
          <h1 className="title" style={{ marginTop: 12 }}>Waiting for approval</h1>
          <p className="sub">
            Signed in as <strong>{label}</strong>. An organizer needs to approve you before you can chat — hang tight, this updates automatically.
          </p>
          <button
            className="btn ghost"
            onClick={logout}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <div className="topbar">
        <span className="badge"><span className="dot" />{label || "Contestant"}</span>
        <div className="grow" />
        <button className="btn ghost" style={{ width: "auto", margin: 0, padding: "8px 14px" }} onClick={logout}>
          Log out
        </button>
      </div>

      <div className="messages" ref={scrollRef}>
        {messages.length === 0 && <div className="empty">Say hello to the agent to begin.</div>}
        {messages.map((m) => (
          <div key={m.id} className={`row ${m.role}`}>
            <div>
              {m.role !== "system" && <div className="who">{m.role === "user" ? "You" : "Agent"}</div>}
              <div className={`bubble ${m.role}`}>
                {m.content}
                {m.streaming && (
                  <span className="typing-indicator" style={{ marginLeft: 8, display: "inline-flex", verticalAlign: "middle" }}>
                    <span />
                    <span />
                    <span />
                  </span>
                )}
                {m.approval && (
                  <div className="approval-card">
                    <div className="approval-header">
                      <span className="approval-icon">⚠️</span>
                      <span className="approval-title">TOOL APPROVAL REQUIRED</span>
                    </div>
                    <div className="approval-desc">{m.approval.description}</div>
                    <pre className="approval-cmd"><code>{m.approval.command}</code></pre>
                    
                    {!m.approval.choice ? (
                      <div className="approval-actions">
                        <button className="btn mini" style={{ margin: "4px 8px 4px 0", width: "auto" }} onClick={() => submitApproval(m.id, "once")}>
                          Approve Once
                        </button>
                        <button className="btn mini" style={{ margin: "4px 8px 4px 0", width: "auto" }} onClick={() => submitApproval(m.id, "session")}>
                          Approve for Session
                        </button>
                        {m.approval.allow_permanent && (
                          <button className="btn mini" style={{ margin: "4px 8px 4px 0", width: "auto" }} onClick={() => submitApproval(m.id, "always")}>
                            Always Approve
                          </button>
                        )}
                        <button className="btn mini danger" style={{ margin: "4px 0", width: "auto" }} onClick={() => submitApproval(m.id, "deny")}>
                          Deny
                        </button>
                      </div>
                    ) : (
                      <div className={`approval-status ${m.approval.choice}`}>
                        {m.approval.choice === "deny" ? "❌ Request Denied" : "✅ Request Approved"}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {agentStatus && (
        <div className="progress-status" style={{ padding: "8px 24px 0", color: "#8aa39d", display: "flex", alignItems: "center", gap: "8px", fontSize: "0.85em" }}>
          <span className="dot pulse" style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#52c41a", display: "inline-block" }} />
          <span>{agentStatus}</span>
        </div>
      )}

      {pendingNewAction && (
        <div className="modal-overlay">
          <div className="modal-card">
            <h2>Are you sure?</h2>
            <p>You have a pending tool approval request that has not been answered. How would you like to proceed?</p>
            <div className="actions">
              <button className="btn" onClick={async () => {
                const msgId = pendingNewAction.msgId;
                setPendingNewAction(null);
                await submitApproval(msgId, "once");
                await startNewSession();
              }}>
                Approve Once & Reset Memory
              </button>
              <button className="btn" onClick={async () => {
                const msgId = pendingNewAction.msgId;
                setPendingNewAction(null);
                await submitApproval(msgId, "always");
                await startNewSession();
              }}>
                Always Approve & Reset Memory
              </button>
              <button className="btn ghost danger" onClick={() => setPendingNewAction(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <form className="composer" onSubmit={send}>
        <div className="input-wrapper">
          {showSuggestions && filteredSuggestions.length > 0 && (
            <div className="suggestions-list">
              {filteredSuggestions.map((cmd, idx) => (
                <div
                  key={cmd.name}
                  className={`suggestion-item ${idx === selectedIndex ? "active" : ""}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectSuggestion(cmd.name);
                  }}
                >
                  <div className="suggestion-icon">/</div>
                  <div className="suggestion-details">
                    <span className="suggestion-name">{cmd.name}</span>
                    <span className="suggestion-desc">{cmd.desc}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <input
            className="input"
            placeholder="Message the agent…"
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={sending}
            autoFocus
          />
        </div>
        <button className="btn" disabled={sending || !input.trim()}>Send</button>
      </form>
      {error && <div className="error" style={{ padding: "0 20px 12px" }}>{error}</div>}
    </div>
  );
}
