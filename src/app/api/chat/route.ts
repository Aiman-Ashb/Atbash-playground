import { cookies } from "next/headers";
import { readToken, SESSION_COOKIE } from "@/lib/auth";
import { getSession, appendMessage, appendDelta, finalizeMessage, registerPendingApproval } from "@/lib/sessions";
import { streamHermesReply, type ChatMessage } from "@/lib/hermes";

export const runtime = "nodejs";

/**
 * POST /api/chat — { message }. Appends the user turn, relays the full
 * conversation to Hermes, and streams the assistant reply back as SSE. Each
 * token is also written to the session store, which broadcasts to admins.
 */
export async function POST(req: Request) {
  const jar = await cookies();
  const sid = readToken(jar.get(SESSION_COOKIE)?.value);
  const session = sid ? getSession(sid) : undefined;
  if (!session || session.status !== "active") {
    return new Response(JSON.stringify({ error: "No active session. Enter your access code." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { message } = (await req.json().catch(() => ({}))) as { message?: string };
  if (!message || !message.trim()) {
    return new Response(JSON.stringify({ error: "Empty message." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  appendMessage(session.id, "user", message.trim());

  // Build the conversation for Hermes from stored history. Stored roles are
  // already "user" | "assistant", both valid ChatMessage roles.
  const history: ChatMessage[] = session.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // Scope long-term memory. Only a VERIFIED Telegram login (code prefix "tg:")
  // keys to the real Telegram id for continuity with their bot chats — a typed/
  // unverified handle ("tgc:") or a code stays isolated per session, so nobody
  // can claim another person's Telegram id to reach their agent memory.
  const sessionKey =
    session.source === "telegram" && session.code.startsWith("tg:")
      ? `agent:main:telegram:${session.code.slice(3)}`
      : `agent:main:api:${session.id}`;

  // Create the assistant message up front so deltas have a target.
  const assistant = appendMessage(session.id, "assistant", "", true);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      try {
        send("start", { messageId: assistant?.id });
        for await (const delta of streamHermesReply(history, { sessionKey, agentId: session.agentId })) {
          if (delta.includes("[__HERMES_APPROVAL_REQUIRED__:")) {
            const match = delta.match(/\[__HERMES_APPROVAL_REQUIRED__:({.+?})\]/);
            if (match) {
              const approvalData = JSON.parse(match[1]);
              send("approval_required", approvalData);
              
              // Pause and wait for user's Approve/Deny decision
              const choice = await new Promise<string>((resolve, reject) => {
                registerPendingApproval(session.id, { resolve, reject });
              });
              
              if (choice === "deny") {
                break;
              }
              continue;
            }
          }
          if (assistant) appendDelta(session.id, assistant.id, delta);
          send("delta", { text: delta });
        }
        if (assistant) finalizeMessage(session.id, assistant.id);
        send("done", {});
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Agent unavailable.";
        if (assistant) {
          appendDelta(session.id, assistant.id, `\n\n[error: ${msg}]`);
          finalizeMessage(session.id, assistant.id);
        }
        send("error", { error: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
