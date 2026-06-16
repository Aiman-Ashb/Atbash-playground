/**
 * Hermes / OpenClaw API Bridge (Express Server)
 * 
 * Exposes local Hermes profiles to the deployed website and supports interactive tool approvals.
 */

const express = require("express");
const { exec, spawn } = require("child_process");
const { promisify } = require("util");
const fs = require("fs");
const path = require("path");
const execAsync = promisify(exec);

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 4000;
const HERMES_PATH = process.env.HERMES_PATH || "/Users/aimanmengesha/.local/bin/hermes";
const API_KEY = process.env.OPENCLAW_API_KEY || "change-me-in-production";

// Map to track active sessions for interactive control
const activeSessions = new Map();

// Session mapping database to map client sessionIds to real Hermes sessionIds
const mapPath = path.join(__dirname, "session-map.json");
let sessionMap = {};
if (fs.existsSync(mapPath)) {
  try {
    sessionMap = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  } catch (e) {
    console.error("Failed to read session map:", e);
  }
}

// Authentication Middleware
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!API_KEY) return next();
  if (authHeader === `Bearer ${API_KEY}`) return next();
  return res.status(401).json({ error: "Unauthorized" });
}

function getHermesProfiles() {
  const profiles = [{ id: "default", name: "default", isDefault: true }];
  const profilesDir = "/Users/aimanmengesha/.hermes/profiles";
  try {
    if (fs.existsSync(profilesDir)) {
      const dirs = fs.readdirSync(profilesDir).filter(file => {
        return fs.statSync(path.join(profilesDir, file)).isDirectory();
      });
      dirs.forEach(dir => {
        if (dir !== "default") {
          profiles.push({ id: dir, name: dir, isDefault: false });
        }
      });
    }
  } catch (err) {
    console.error("Failed to read hermes profiles directory:", err);
  }
  return profiles;
}

// 1. GET /agents - List configured Hermes profiles
app.get("/agents", authenticate, async (req, res) => {
  try {
    const profiles = getHermesProfiles();
    res.json(profiles);
  } catch (err) {
    console.error("Failed to list profiles:", err);
    res.json([
      { id: "default", name: "default", isDefault: true },
      { id: "tejo3", name: "tejo3", isDefault: false }
    ]);
  }
});

// 2. POST /agent - Execute a Hermes turn in interactive query mode (streams stdout in real-time)
app.post("/agent", authenticate, async (req, res) => {
  const { agentId, sessionId, message } = req.body;
  if (!agentId || !sessionId || !message) {
    return res.status(400).json({ error: "agentId, sessionId, and message are required" });
  }

  let targetAgent = agentId;
  const profiles = getHermesProfiles();
  if (!profiles.some(p => p.id === targetAgent)) {
    const defaultProfile = profiles.find(p => p.isDefault) || { id: "default" };
    console.log(`[Hermes Bridge] Profile '${targetAgent}' not found. Falling back to '${defaultProfile.id}'`);
    targetAgent = defaultProfile.id;
  }

  // Set headers for streaming response
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Transfer-Encoding", "chunked");

  const isMock = HERMES_PATH.endsWith("mock-hermes.sh");
  const mappedSessionId = isMock ? sessionId : sessionMap[sessionId];

  if (mappedSessionId) {
    console.log(`[Hermes Bridge] Spawning: "${HERMES_PATH}" -p "${targetAgent}" --resume "${mappedSessionId}" --quiet -q "${message}"`);
  } else {
    console.log(`[Hermes Bridge] Spawning new session: "${HERMES_PATH}" -p "${targetAgent}" --quiet -q "${message}"`);
  }

  // Kill existing session process if it exists to avoid conflicts
  if (activeSessions.has(sessionId)) {
    console.log(`[Hermes Bridge] Terminating stale process for session ${sessionId}`);
    try {
      activeSessions.get(sessionId).child.kill();
    } catch (e) {
      console.error(e);
    }
    activeSessions.delete(sessionId);
  }

  // Determine spawn arguments. If we're using mock-hermes.sh, pass it directly.
  let spawnCmd = HERMES_PATH;
  let spawnArgs = [
    "-p", targetAgent,
    "chat",
    "--quiet",
    "-q", message
  ];
  if (mappedSessionId) {
    spawnArgs.splice(2, 0, "--resume", mappedSessionId);
  }

  if (isMock) {
    spawnCmd = "/bin/bash";
    spawnArgs = [HERMES_PATH, "-q", message];
  }

  const child = spawn(spawnCmd, spawnArgs);

  let accumulatedStdout = "";
  let isBufferingApproval = false;
  let discardConfirmation = false;
  let isFirstLine = !isMock && !mappedSessionId;
  let stdoutBuffer = "";

  const sessionObj = {
    child,
    res,
    sendDecision: (choice) => {
      discardConfirmation = true;
      child.stdin.write(choice + "\n");
    }
  };
  activeSessions.set(sessionId, sessionObj);

  child.stdout.on("data", (chunk) => {
    let text = chunk.toString();

    // 1. Capture and strip the generated session ID line on the first run of a new session
    if (isFirstLine) {
      stdoutBuffer += text;
      const newlineIndex = stdoutBuffer.indexOf("\n");
      if (newlineIndex !== -1) {
        const firstLine = stdoutBuffer.slice(0, newlineIndex).trim();
        const match = firstLine.match(/^session_id:\s*(\S+)/);
        if (match) {
          const newHermesId = match[1];
          console.log(`[Hermes Bridge] Mapped session ${sessionId} -> ${newHermesId}`);
          sessionMap[sessionId] = newHermesId;
          try {
            fs.writeFileSync(mapPath, JSON.stringify(sessionMap, null, 2), "utf8");
          } catch (e) {
            console.error("Failed to write session map:", e);
          }
        } else {
          console.warn(`[Hermes Bridge] Unexpected first line (no session ID): "${firstLine}"`);
        }
        text = stdoutBuffer.slice(newlineIndex + 1);
        stdoutBuffer = "";
        isFirstLine = false;
        if (!text) return;
      } else {
        return;
      }
    }

    // 2. If we are discarding the confirmation result message after user input
    if (discardConfirmation) {
      accumulatedStdout += text;
      if (accumulatedStdout.includes("\n")) {
        const lines = accumulatedStdout.split("\n");
        lines.shift(); // remove "✓ Allowed once" / "✗ Denied"
        accumulatedStdout = lines.join("\n");
        discardConfirmation = false;
        isBufferingApproval = false;
        if (accumulatedStdout) {
          res.write(accumulatedStdout);
          accumulatedStdout = "";
        }
      }
      return;
    }

    // 3. Check if we need to start buffering
    if (!isBufferingApproval) {
      const dangerousIndex = text.indexOf("DANGEROUS COMMAND:");
      if (dangerousIndex !== -1) {
        isBufferingApproval = true;
        let lineStartIndex = text.lastIndexOf("\n", dangerousIndex);
        if (lineStartIndex === -1) {
          lineStartIndex = 0;
        } else {
          lineStartIndex += 1;
        }
        if (lineStartIndex > 0) {
          res.write(text.slice(0, lineStartIndex));
        }
        accumulatedStdout = text.slice(lineStartIndex);
      } else {
        res.write(text);
        return;
      }
    } else {
      accumulatedStdout += text;
    }

    // 4. If we are buffering, check if we have the full prompt
    if (isBufferingApproval) {
      if (accumulatedStdout.includes("Choice [") || accumulatedStdout.includes("Choice (")) {
        const lines = accumulatedStdout.split("\n");
        let description = "Dangerous command approval required";
        let command = "";

        const descLine = lines.find(line => line.includes("DANGEROUS COMMAND:"));
        if (descLine) {
          description = descLine.split("DANGEROUS COMMAND:")[1].trim();
        }
        const descIndex = lines.findIndex(line => line.includes("DANGEROUS COMMAND:"));
        if (descIndex !== -1 && descIndex + 1 < lines.length) {
          command = lines[descIndex + 1].trim();
        }

        const payload = {
          status: "approval_required",
          command: command,
          description: description,
          allow_permanent: accumulatedStdout.includes("[a]lways")
        };

        res.write(`\n[__HERMES_APPROVAL_REQUIRED__:${JSON.stringify(payload)}]\n`);
        accumulatedStdout = "";
      }
      return;
    }

    // Default: write direct stdout to stream
    res.write(text);
  });

  child.stderr.on("data", (data) => {
    console.error(`[Hermes CLI Error] ${data}`);
  });

  child.on("error", (err) => {
    console.error("[Hermes Bridge] Failed to start process:", err);
    activeSessions.delete(sessionId);
    if (!res.headersSent) {
      res.status(500).end(`[error: Failed to start agent process: ${err.message}]`);
    }
  });

  child.on("close", (code) => {
    console.log(`[Hermes Bridge] Process exited with code ${code}`);
    activeSessions.delete(sessionId);
    res.end();
  });
});

// 3. POST /agent/approve - Submit a decision for a pending tool approval
app.post("/agent/approve", authenticate, (req, res) => {
  const { sessionId, choice } = req.body;
  if (!sessionId || !choice) {
    return res.status(400).json({ error: "sessionId and choice are required" });
  }

  const session = activeSessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: `No active agent session found for ID ${sessionId}` });
  }

  console.log(`[Hermes Bridge] Forwarding approval decision '${choice}' for session ${sessionId}`);
  session.sendDecision(choice);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Hermes API Bridge listening on port ${PORT}`);
});
