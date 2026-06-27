/**
 * Jarvis Hub - Hermes Agent Voice Bridge
 * Every message goes through the SAME Hermes session via --resume
 * Full memory, tools, skills, context preserved
 */

import { serve } from "bun";
import { spawn } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const PORT = process.env.PORT || 3456;
const HERMES_CMD = process.env.HERMES_CMD || "hermes";
const DIST_DIR = import.meta.dir;
const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY || "";

// ========== State ==========
const wsClients = new Map();
const sessions = new Map(); // wsId -> { sessionId, messages, thinking }

// ========== ElevenLabs TTS ==========
async function ttsElevenLabs(text) {
  if (!ELEVENLABS_KEY || !text) return null;
  try {
    const clean = text
      .replace(/[*_`#~>\[\]]/g, "")
      .replace(/\n/g, ". ")
      .substring(0, 200);
    const resp = await fetch("https://api.elevenlabs.io/v1/text-to-speech/pNInz6obpgDQGcFmaJgB", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": ELEVENLABS_KEY,
      },
      body: JSON.stringify({
        text: clean,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });
    if (!resp.ok) return null;
    const buf = await resp.arrayBuffer();
    return Buffer.from(buf).toString("base64");
  } catch {
    return null;
  }
}

// ========== Core: Hermes with session persistence ==========
async function talkToHermes(ws, wsId, text) {
  const s = sessions.get(wsId);
  if (!s) return;

  s.thinking = true;
  ws.send(JSON.stringify({ type: "thinking", sessionId: s.sessionId }));

  // First message: create session. Subsequent: resume.
  const args = ["chat", "-q", text, "-Q", "--source", "jarvis", "--yolo"];
  if (s.sessionId) {
    args.push("--resume", s.sessionId);
  }

  return new Promise((resolve) => {
    const child = spawn(HERMES_CMD, args, {
      cwd: process.env.HOME || process.env.USERPROFILE,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 300000,
    });

    let output = "";
    let errorOutput = "";
    let newSessionId = s.sessionId;

    child.stdout.on("data", (data) => {
      const text = data.toString();
      output += text;

      // Parse session_id from first line
      const sidMatch = text.match(/session_id:\s*(\S+)/);
      if (sidMatch && !newSessionId) {
        newSessionId = sidMatch[1];
        s.sessionId = newSessionId;
        ws.send(JSON.stringify({ type: "session", sessionId: newSessionId }));
      }

      // Strip session_id line for chunks
      let display = text.replace(/^session_id:.*\n?/m, "").trim();
      if (display) {
        ws.send(JSON.stringify({ type: "chunk", sessionId: newSessionId, text: display }));
      }
    });

    child.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

    child.on("close", async (code) => {
      s.thinking = false;
      const rawResponse = output.replace(/^session_id:.*\n?/m, "").trim();
      const fullResponse = rawResponse || "I'm here. What do you need?";

      ws.send(
        JSON.stringify({
          type: "done",
          sessionId: newSessionId,
          text: fullResponse,
          code,
        }),
      );

      // Try ElevenLabs TTS
      const audioB64 = await ttsElevenLabs(fullResponse);
      if (audioB64) {
        ws.send(
          JSON.stringify({
            type: "audio",
            sessionId: newSessionId,
            audio: audioB64,
            format: "mp3",
          }),
        );
      }

      // Alert
      ws.send(
        JSON.stringify({
          type: "alert",
          text: fullResponse.substring(0, 100) + (fullResponse.length > 100 ? "..." : ""),
          source: "Jarvis",
          dotColor: "#9a6bff",
        }),
      );

      resolve({ text: fullResponse, code });
    });

    child.on("error", (err) => {
      s.thinking = false;
      ws.send(JSON.stringify({ type: "error", sessionId: newSessionId, text: err.message }));
      resolve({ text: err.message, code: -1 });
    });
  });
}

// ========== HTTP + WebSocket Server ==========
const server = serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });

    // WebSocket upgrade
    if (req.headers.get("upgrade") === "websocket") {
      const upgraded = server.upgrade(req);
      if (upgraded) return;
    }

    if (url.pathname === "/api/health") {
      return new Response(
        JSON.stringify({
          status: "online",
          agent: "HERMES-T",
          sessions: sessions.size,
          elevenlabs: !!ELEVENLABS_KEY,
        }),
        { headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // Static files
    let fp = url.pathname === "/" ? "/index.html" : url.pathname;
    const full = join(DIST_DIR, fp);
    if (existsSync(full)) {
      const mime = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".svg": "image/svg+xml",
      };
      return new Response(readFileSync(full), {
        headers: { ...cors, "Content-Type": mime[fp.slice(fp.lastIndexOf("."))] || "text/plain" },
      });
    }
    return new Response("404", { status: 404, headers: cors });
  },

  websocket: {
    open(ws) {
      const wsId = `ws-${Date.now()}`;
      ws.data = { wsId };
      wsClients.set(ws, wsId);
      sessions.set(wsId, { sessionId: null, thinking: false });

      ws.send(
        JSON.stringify({
          type: "welcome",
          text: "J.A.R.V.I.S online. Same brain, same memory. How can I help, sir?",
        }),
      );
    },

    async message(ws, raw) {
      try {
        const msg = JSON.parse(raw.toString());
        const wsId = ws.data?.wsId;
        if (!wsId) return;

        if (msg.type === "chat" || msg.type === "voice") {
          await talkToHermes(ws, wsId, msg.text);
        } else if (msg.type === "task") {
          ws.send(JSON.stringify({ type: "thinking" }));
          await talkToHermes(ws, wsId, `Execute this task: ${msg.text}`);
        }
      } catch (e) {
        ws.send(JSON.stringify({ type: "error", text: e.message }));
      }
    },

    close(ws) {
      const wsId = wsClients.get(ws);
      wsClients.delete(ws);
      if (wsId) sessions.delete(wsId);
    },
  },
});

console.log(`\n  JARVIS HUB  |  http://localhost:${PORT}`);
console.log(`  Agent: hermes (session-persistent)`);
console.log(
  `  ElevenLabs: ${ELEVENLABS_KEY ? "enabled" : "disabled (set ELEVENLABS_API_KEY in .env)"}\n`,
);
