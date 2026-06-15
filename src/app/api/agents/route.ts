import { NextResponse } from "next/server";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export const runtime = "nodejs";

export async function GET() {
  try {
    const openclawPath = process.env.OPENCLAW_PATH || "/Users/aimanmengesha/.local/bin/openclaw";
    const { stdout } = await execAsync(`"${openclawPath}" agents list --json`);
    const agents = JSON.parse(stdout);
    return NextResponse.json({ agents });
  } catch (err) {
    console.error("Failed to load openclaw agents:", err);
    // Fallback if openclaw isn't found or errors
    return NextResponse.json({
      agents: [
        { id: "main", name: "main (default)", isDefault: true },
        { id: "tejo", name: "tejo", isDefault: false }
      ]
    });
  }
}
