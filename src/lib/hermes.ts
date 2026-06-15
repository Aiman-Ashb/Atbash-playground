import { execFile } from "node:child_process";
import { promisify } from "node:util";

// execFile (not exec) — no /bin/sh involved, so the user's chat message and the
// agent id are passed as argv slots and CAN'T be parsed as shell. No quoting,
// no escaping, no injection class.
const execFileAsync = promisify(execFile);

// Limits for the OpenClaw subprocess.
//   timeout: cap a single turn so a stuck agent doesn't tie up the request.
//   maxBuffer: agent replies can be long; default 1 MiB truncates and breaks JSON.parse.
const OPENCLAW_TIMEOUT_MS = 60_000;
const OPENCLAW_MAX_BUFFER = 10 * 1024 * 1024;

export type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

/**
 * Agent connection. Two backends, selected by AGENT_BACKEND:
 *   - "openclaw" (default): run the local OpenClaw CLI (its native interface).
 *   - "hermes": call the Hermes API server's OpenAI-compatible /v1/chat/completions
 *     (its native interface) over HTTP+SSE. Set HERMES_API_URL/HERMES_API_KEY.
 * HERMES_MOCK=1 forces a canned reply for either backend.
 */
function cfg() {
  const backend = (process.env.AGENT_BACKEND || "openclaw").toLowerCase();
  const mock = (process.env.HERMES_MOCK ?? "0") === "1";
  // openclaw
  const openclawPath = process.env.OPENCLAW_PATH || "openclaw";
  // hermes HTTP API
  const hermesUrl = (process.env.HERMES_API_URL || "").replace(/\/+$/, "");
  const hermesKey = process.env.HERMES_API_KEY || "";
  const hermesModel = process.env.HERMES_MODEL || "hermes-agent";
  return { backend, mock, openclawPath, hermesUrl, hermesKey, hermesModel };
}

/** True when we're NOT talking to a real agent (mock flag, or hermes with no host). */
export function isMock(): boolean {
  const c = cfg();
  if (c.mock) return true;
  if (c.backend === "hermes") return !c.hermesUrl || !c.hermesKey; // no host wired yet
  return false; // openclaw: assume the CLI is on the host
}

/** Streams the agent's reply token-by-token, dispatching to the chosen backend. */
export async function* streamHermesReply(
  messages: ChatMessage[],
  opts: { sessionKey?: string; agentId?: string } = {},
): AsyncGenerator<string> {
  if (isMock()) {
    yield* mockReply(messages);
    return;
  }
  if (cfg().backend === "hermes") {
    yield* streamViaHermesApi(messages, opts);
    return;
  }
  yield* streamViaOpenClaw(messages, opts);
}

// ─── Backend: OpenClaw CLI (Aiman) ──────────────────────────────────
async function* streamViaOpenClaw(
  messages: ChatMessage[],
  opts: { sessionKey?: string; agentId?: string },
): AsyncGenerator<string> {
  const { openclawPath } = cfg();
  const agentId = opts.agentId || process.env.OPENCLAW_AGENT || "main";
  const sessionKey = opts.sessionKey || "default-session";
  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

  try {
    const { stdout } = await execFileAsync(
      openclawPath,
      ["agent", "--agent", agentId, "--session-id", sessionKey, "--message", lastUserMessage, "--json"],
      { timeout: OPENCLAW_TIMEOUT_MS, maxBuffer: OPENCLAW_MAX_BUFFER },
    );
    const parsed = JSON.parse(stdout);
    const textResponse = parsed?.result?.payloads?.[0]?.text || "";

    if (!textResponse) {
      yield "No response received from agent.";
      return;
    }
    for (const chunk of textResponse.split(/(\s+)/)) {
      yield chunk;
      await new Promise((r) => setTimeout(r, 20));
    }
  } catch (err) {
    console.error("OpenClaw agent execution failed:", err);
    const msg = err instanceof Error ? err.message : "OpenClaw failed to execute turn.";
    yield `[error: ${msg}]`;
  }
}

// ─── Backend: Hermes API server (OpenAI-compatible /v1/chat/completions) ───
async function* streamViaHermesApi(
  messages: ChatMessage[],
  opts: { sessionKey?: string; agentId?: string },
): AsyncGenerator<string> {
  const { hermesUrl, hermesKey, hermesModel } = cfg();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${hermesKey}`,
  };
  // Scope long-term memory for this conversation (e.g. per Telegram/agent id).
  if (opts.sessionKey) headers["X-Hermes-Session-Key"] = opts.sessionKey;

  const res = await fetch(`${hermesUrl}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: hermesModel, messages, stream: true }),
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    yield `[error: Hermes API ${res.status}: ${detail.slice(0, 200)}]`;
    return;
  }

  // Parse the SSE stream: `data: {json}\n\n`, terminated by `data: [DONE]`.
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
      const line = evt.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const json = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // ignore keep-alives / non-JSON progress events
      }
    }
  }
}

// ─── Mock (no real agent) ───────────────────────────────────────────
async function* mockReply(messages: ChatMessage[]): AsyncGenerator<string> {
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const backend = cfg().backend;
  const text =
    `[mock:${backend}] I'm a stand-in for your agent. ` +
    `You said: "${lastUser.slice(0, 200)}". ` +
    `Set HERMES_MOCK=0 (and AGENT_BACKEND=${backend}${backend === "hermes" ? " + HERMES_API_URL/KEY" : " with openclaw on PATH"}) to go live.`;
  for (const word of text.split(" ")) {
    yield word + " ";
    await new Promise((r) => setTimeout(r, 35));
  }
}
