import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

function cfg() {
  const openclawPath = process.env.OPENCLAW_PATH || "/Users/aimanmengesha/.local/bin/openclaw";
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

  const { openclawPath } = cfg();
  const agentId = opts.agentId || process.env.OPENCLAW_AGENT || "main";
  const sessionKey = opts.sessionKey || "default-session";
  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

  try {
    // Sanitize message for CLI execution: escape backslashes and double quotes
    const sanitizedMsg = lastUserMessage
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"');

    const cmd = `"${openclawPath}" agent --agent "${agentId}" --session-id "${sessionKey}" --message "${sanitizedMsg}" --json`;
    console.log(`[OpenClaw] Executing: ${cmd}`);

    const { stdout } = await execAsync(cmd);
    const parsed = JSON.parse(stdout);
    
    // Extract the text payload from the JSON result
    const textResponse = parsed?.result?.payloads?.[0]?.text || "";

    if (!textResponse) {
      yield "No response received from agent.";
      return;
    }

    // Stream it back chunk-by-chunk to simulate real-time text delivery in the UI
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
