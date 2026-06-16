import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { Agent } from "undici";

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

function cfg() {
  // Resolve via PATH by default — works on every dev machine without an env var.
  // Override OPENCLAW_PATH if openclaw isn't on PATH.
  const openclawPath = process.env.OPENCLAW_PATH || "openclaw";
  const mock = (process.env.HERMES_MOCK ?? "0") === "1";
  return { openclawPath, mock };
}

/** True when we're NOT talking to a real agent (mock flag set). */
export function isMock(): boolean {
  return cfg().mock;
}

/**
 * Runs the agent's turn by executing the OpenClaw CLI and streams the response.
 */
export async function* streamHermesReply(
  messages: ChatMessage[],
  opts: { sessionKey?: string; agentId?: string } = {},
): AsyncGenerator<string> {
  if (isMock()) {
    yield* mockReply(messages);
    return;
  }

  const agentId = opts.agentId || process.env.OPENCLAW_AGENT || "main";
  const sessionKey = opts.sessionKey || "default-session";
  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

  const apiUrl = process.env.OPENCLAW_API_URL;
  if (apiUrl) {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "bypass-tunnel-reminder": "true"
      };
      if (process.env.OPENCLAW_API_KEY) {
        headers["Authorization"] = `Bearer ${process.env.OPENCLAW_API_KEY}`;
      }
      const response = await fetch(`${apiUrl}/agent`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          agentId,
          sessionId: sessionKey,
          message: lastUserMessage
        }),
        // Avoid UND_ERR_BODY_TIMEOUT on long agent runs
        dispatcher: new Agent({
          bodyTimeout: 0,
          headersTimeout: 0
        })
      } as any);
      if (!response.ok) {
        throw new Error(`Remote OpenClaw API returned status ${response.status}`);
      }
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Response body is not readable.");
      }
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        
        while (true) {
          const markerStart = buffer.indexOf("[__HERMES_APPROVAL_REQUIRED__:");
          if (markerStart !== -1) {
            const markerEnd = buffer.indexOf("}]", markerStart);
            if (markerEnd !== -1) {
              if (markerStart > 0) {
                yield buffer.slice(0, markerStart);
              }
              yield buffer.slice(markerStart, markerEnd + 2);
              buffer = buffer.slice(markerEnd + 2);
              continue;
            }
          }
          
          const progressStart = buffer.indexOf("[__HERMES_PROGRESS__:");
          if (progressStart !== -1) {
            const progressEnd = buffer.indexOf("}]", progressStart);
            if (progressEnd !== -1) {
              if (progressStart > 0) {
                yield buffer.slice(0, progressStart);
              }
              yield buffer.slice(progressStart, progressEnd + 2);
              buffer = buffer.slice(progressEnd + 2);
              continue;
            }
          }
          
          const partialIndex = buffer.indexOf("[__HERMES_APPROVAL_REQUIRED__");
          const partialProgressIndex = buffer.indexOf("[__HERMES_PROGRESS__");
          
          let firstPartial = -1;
          if (partialIndex !== -1 && partialProgressIndex !== -1) {
            firstPartial = Math.min(partialIndex, partialProgressIndex);
          } else if (partialIndex !== -1) {
            firstPartial = partialIndex;
          } else if (partialProgressIndex !== -1) {
            firstPartial = partialProgressIndex;
          }

          if (firstPartial !== -1) {
            if (firstPartial > 0) {
              yield buffer.slice(0, firstPartial);
              buffer = buffer.slice(firstPartial);
            }
            break;
          } else {
            yield buffer;
            buffer = "";
            break;
          }
        }
      }
      return;
    } catch (err) {
      console.error("Remote OpenClaw API execution failed:", err);
      const msg = err instanceof Error ? err.message : "Remote OpenClaw failed to respond.";
      yield `[error: ${msg}]`;
      return;
    }
  }

  const { openclawPath } = cfg();

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

    const chunks = textResponse.split(/(\s+)/);
    for (const chunk of chunks) {
      yield chunk;
      await new Promise((r) => setTimeout(r, 20));
    }
  } catch (err) {
    console.error("OpenClaw agent execution failed:", err);
    const msg = err instanceof Error ? err.message : "OpenClaw failed to execute turn.";
    yield `[error: ${msg}]`;
  }
}

/** Canned streaming reply for mock mode. */
async function* mockReply(messages: ChatMessage[]): AsyncGenerator<string> {
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const text =
    `[mock] I'm a stand-in for your OpenClaw agent. ` +
    `You said: "${lastUser.slice(0, 200)}". ` +
    `Set HERMES_MOCK=0 in your .env.local to target your real local OpenClaw gateway.`;
  for (const word of text.split(" ")) {
    yield word + " ";
    await new Promise((r) => setTimeout(r, 35));
  }
}
