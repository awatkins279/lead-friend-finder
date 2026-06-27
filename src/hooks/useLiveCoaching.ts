import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  getDeepgramToken,
  generateLiveSuggestion,
  logTranscriptChunk,
  type LiveSuggestion,
} from "@/lib/coaching.functions";

export type TranscriptTurn = {
  id: string;
  role: "rep" | "prospect";
  text: string;
  ts: number;
  final: boolean;
};

type Options = {
  listId: string;
  leadId: string;
  callId?: string | null;
  enabled: boolean;
  /** Provide the remote (prospect) audio stream if available — enables true dual-channel. */
  getRemoteStream?: () => MediaStream | null;
};

/**
 * Captures rep mic (+ optional remote/prospect stream) and streams to Deepgram.
 * On every FINAL prospect turn, asks the AI co-pilot what to say next.
 * Returns rolling transcript, current suggestion, and status.
 */
export function useLiveCoaching({ listId, leadId, callId, enabled, getRemoteStream }: Options) {
  const tokenFn = useServerFn(getDeepgramToken);
  const suggestFn = useServerFn(generateLiveSuggestion);
  const logFn = useServerFn(logTranscriptChunk);

  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  const [suggestion, setSuggestion] = useState<LiveSuggestion | null>(null);
  const [suggesting, setSuggesting] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const lastSuggestForRef = useRef<string>("");
  const turnsRef = useRef<TranscriptTurn[]>([]);
  turnsRef.current = turns;

  const stop = useCallback(() => {
    try {
      wsRef.current?.close();
    } catch {}
    wsRef.current = null;
    try {
      procRef.current?.disconnect();
    } catch {}
    procRef.current = null;
    try {
      ctxRef.current?.close();
    } catch {}
    ctxRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    setListening(false);
  }, []);

  const start = useCallback(async () => {
    if (wsRef.current || !enabled) return;
    setError(null);
    try {
      // 1) mint a short-lived deepgram key
      const { key } = await tokenFn();

      // 2) capture rep mic
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
      micStreamRef.current = mic;

      const remote = getRemoteStream?.() ?? null;
      const dual = !!remote;

      // 3) build audio graph @ 16kHz, mix mic→ch0, remote→ch1 (or mono if no remote)
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000,
      });
      ctxRef.current = ctx;
      const merger = ctx.createChannelMerger(dual ? 2 : 1);
      const micSrc = ctx.createMediaStreamSource(mic);
      micSrc.connect(merger, 0, 0);
      if (dual && remote) {
        const remoteSrc = ctx.createMediaStreamSource(remote);
        remoteSrc.connect(merger, 0, 1);
      }
      // scriptProcessor → linear16 frames
      const proc = ctx.createScriptProcessor(4096, dual ? 2 : 1, dual ? 2 : 1);
      procRef.current = proc;
      merger.connect(proc);
      proc.connect(ctx.destination);

      // 4) open deepgram socket
      const params = new URLSearchParams({
        encoding: "linear16",
        sample_rate: "16000",
        channels: dual ? "2" : "1",
        multichannel: dual ? "true" : "false",
        model: "nova-3",
        interim_results: "true",
        smart_format: "true",
        punctuate: "true",
        endpointing: "300",
      });
      const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params.toString()}`, [
        "token",
        key,
      ]);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => setListening(true);
      ws.onerror = () => setError("Deepgram connection error");
      ws.onclose = () => setListening(false);
      ws.onmessage = (ev) => {
        try {
          const m = JSON.parse(ev.data);
          if (m.type !== "Results") return;
          const alt = m.channel?.alternatives?.[0];
          const text: string = alt?.transcript ?? "";
          if (!text.trim()) return;
          const chIdx: number = m.channel_index?.[0] ?? 0;
          const role: "rep" | "prospect" = dual ? (chIdx === 1 ? "prospect" : "rep") : "rep";
          const final = !!m.is_final;
          const id = `${m.start ?? Date.now()}_${chIdx}`;

          setTurns((prev) => {
            // replace any non-final turn with same id, else append
            const next = prev.filter((t) => t.id !== id || t.final);
            next.push({ id, role, text, ts: Date.now(), final });
            // keep last 60 turns
            return next.slice(-60);
          });

          if (final) {
            if (callId) {
              logFn({ data: { call_id: callId, role, text: text.slice(0, 2000) } }).catch(() => {});
            }
            // ask AI on every final prospect utterance
            if (role === "prospect" && text.length > 4 && lastSuggestForRef.current !== id) {
              lastSuggestForRef.current = id;
              requestSuggestion();
            }
          }
        } catch {}
      };

      // 5) pump PCM frames
      proc.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const inBuf = e.inputBuffer;
        const channels = inBuf.numberOfChannels;
        const len = inBuf.length;
        // interleave channels into Int16 PCM
        const out = new Int16Array(len * channels);
        for (let c = 0; c < channels; c++) {
          const data = inBuf.getChannelData(c);
          for (let i = 0; i < len; i++) {
            const s = Math.max(-1, Math.min(1, data[i]));
            out[i * channels + c] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }
        }
        ws.send(out.buffer);
      };
    } catch (e: any) {
      setError(e?.message ?? "Failed to start live coaching");
      stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, tokenFn, logFn, callId, getRemoteStream, stop]);

  const requestSuggestion = useCallback(async () => {
    const window = turnsRef.current.filter((t) => t.final).slice(-12);
    if (window.length === 0) return;
    setSuggesting(true);
    try {
      const r = await suggestFn({
        data: {
          list_id: listId,
          lead_id: leadId,
          call_id: callId ?? undefined,
          transcript: window.map((t) => ({ role: t.role, text: t.text.slice(0, 2000) })),
        },
      });
      setSuggestion(r.suggestion);
    } catch (e: any) {
      // soft fail — keep last suggestion
      setError(e?.message ?? "Co-pilot error");
    } finally {
      setSuggesting(false);
    }
  }, [suggestFn, listId, leadId, callId]);

  // auto-stop on unmount or when disabled
  useEffect(() => {
    if (!enabled) stop();
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return {
    listening,
    error,
    turns,
    suggestion,
    suggesting,
    start,
    stop,
    requestSuggestion,
  };
}
