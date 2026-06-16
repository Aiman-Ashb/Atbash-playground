import { cookies } from "next/headers";
import { readToken, SESSION_COOKIE } from "@/lib/auth";
import { getSession, resolvePendingApproval } from "@/lib/sessions";

export const runtime = "nodejs";

/**
 * POST /api/chat/approve - Contestant submits an Approve or Deny decision
 * for a pending dangerous tool execution command.
 */
export async function POST(req: Request) {
  const jar = await cookies();
  const sid = readToken(jar.get(SESSION_COOKIE)?.value);
  const session = sid ? getSession(sid) : undefined;
  if (!session || session.status !== "active") {
    return new Response(JSON.stringify({ error: "No active session." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { choice } = (await req.json().catch(() => ({}))) as { choice?: string };
  if (!choice || !["once", "session", "always", "deny"].includes(choice)) {
    return new Response(JSON.stringify({ error: "Invalid approval choice." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  console.log(`[Next.js] Resolving pending approval for session ${session.id} with choice: ${choice}`);
  
  // 1. Resolve Next.js local suspended stream
  const resolvedLocally = resolvePendingApproval(session.id, choice);

  // 2. Forward the decision to the Express bridge
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
      
      const response = await fetch(`${apiUrl}/agent/approve`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          sessionId: session.source === "telegram" && session.code.startsWith("tg:")
            ? `agent:main:telegram:${session.code.slice(3)}`
            : `agent:main:api:${session.id}`,
          choice
        })
      });

      if (!response.ok) {
        throw new Error(`Remote bridge returned status ${response.status}`);
      }
    } catch (err) {
      console.error("[Next.js] Failed to forward approval to bridge:", err);
      // Even if forwarding to the remote bridge fails, return success if we resolved it locally
    }
  }

  return new Response(JSON.stringify({ success: true, resolvedLocally }), {
    headers: { "Content-Type": "application/json" },
  });
}
