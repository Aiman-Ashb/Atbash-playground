import { cookies } from "next/headers";
import { ADMIN_COOKIE, verifyAdminSessionToken } from "@/lib/auth";
import { subscribe, listSessions, type BusEvent } from "@/lib/sessions";

export const runtime = "nodejs";

/**
 * GET /api/admin/stream — SSE feed of live session activity for the observer.
 * Emits an initial `snapshot` of all sessions, then every BusEvent as it fires.
 */
export async function GET() {
  const jar = await cookies();
  if (!verifyAdminSessionToken(jar.get(ADMIN_COOKIE)?.value)) {
    return new Response("Admin login required.", { status: 401 });
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // controller closed — ignore
        }
      };

      send("snapshot", { sessions: listSessions() });

      const onEvent = (e: BusEvent) => send(e.type, e);
      unsubscribe = subscribe(onEvent);

      // Keep the connection alive through proxies.
      heartbeat = setInterval(() => send("ping", { t: Date.now() }), 20000);
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
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
