/**
 * The ONE place the playground talks to Hermes.
 *
 * Everything else (API routes, UI) goes through `streamHermesReply`. When the
 * real host arrives, only HERMES_API_URL / HERMES_API_KEY change — no other
 * file touches the endpoint. Until then, HERMES_MOCK=1 streams a canned reply
 * so the whole app runs end-to-end.
 *
 * Uses the Hermes API server's OpenAI-compatible endpoint:
 *   POST {HERMES_API_URL}/v1/chat/completions   (stream: true → SSE)
 *   Authorization: Bearer {HERMES_API_KEY}
 */

export type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

function cfg() {
  const baseUrl = (process.env.HERMES_API_URL || "").replace(/\/+$/, "");
  const apiKey = process.env.HERMES_API_KEY || "";
  const model = process.env.HERMES_MODEL || "hermes-agent";
  const mock = (process.env.HERMES_MOCK ?? "0") === "1";
  return { baseUrl, apiKey, model, mock };
}

/** True when we're NOT talking to a real agent (no host yet / mock flag set). */
export function isMock(): boolean {
  const { mock, baseUrl, apiKey } = cfg();
  return mock || !baseUrl || !apiKey;
}

/**
 * Streams the agent's reply token-by-token as an async iterable of text deltas.
 * Caller is responsible for accumulating the full text if it needs it.
 */
export async function* streamHermesReply(
  messages: ChatMessage[],
  opts: { sessionKey?: string } = {},
): AsyncGenerator<string> {
  if (isMock()) {
    yield* mockReply(messages);
    return;
  }

  const { baseUrl, apiKey, model } = cfg();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  // Scopes long-term memory for this conversation. For a Telegram-login user we
  // pass their Telegram-derived key so the agent shares memory with that user's
  // Telegram bot history. NOTE: the exact key format for matching the Telegram
  // CHANNEL's scope should be confirmed with the agent operator (Honore/Tsion).
  if (opts.sessionKey) headers["X-Hermes-Session-Key"] = opts.sessionKey;

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, messages, stream: true }),
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Hermes API error ${res.status}: ${detail.slice(0, 300)}`);
  }

  // Parse the SSE stream: lines of `data: {json}\n\n`, terminated by `data: [DONE]`.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split("\n\n");
    buffer = events.pop() ?? ""; // keep the trailing partial event

    for (const evt of events) {
      const line = evt.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const json = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // Ignore keep-alives / non-JSON progress events (e.g. hermes.tool.progress).
      }
    }
  }
}

/** Canned streaming reply for mock mode — lets the UI/relay work with no host. */
async function* mockReply(messages: ChatMessage[]): AsyncGenerator<string> {
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const text =
    `[mock] I'm a stand-in for the Hermes agent (no host wired up yet). ` +
    `You said: "${lastUser.slice(0, 200)}". ` +
    `Once HERMES_API_URL and HERMES_API_KEY point at a live agent and HERMES_MOCK=0, ` +
    `this exact stream will carry the real agent's reply.`;
  for (const word of text.split(" ")) {
    yield word + " ";
    await new Promise((r) => setTimeout(r, 35));
  }
}
