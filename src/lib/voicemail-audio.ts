// Browser-side voicemail assembly.
//
// Takes the resolved segments from resolveVoicemailTemplate (recorded chunks +
// per-prospect variable clips spoken in the cloned voice + silence) and stitches
// them into ONE clean audio clip using the Web Audio API. This runs entirely in
// the browser, so the app's Cloudflare runtime (no ffmpeg) is never involved.
//
// We return PLAIN audio data ({ samples, sampleRate }) rather than an AudioBuffer
// so the result isn't bound to (and invalidated by) any AudioContext lifetime.

export type ResolvedSegment =
  | { type: "recorded"; url: string }
  | { type: "variable"; token: string; value: string; url: string }
  | { type: "silence"; ms: number };

export type AssembledAudio = { samples: Float32Array; sampleRate: number };

function getAudioContext(): AudioContext {
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  return new Ctx();
}

// Mix any AudioBuffer down to a single mono Float32Array (a copy).
function toMono(buf: AudioBuffer): Float32Array {
  if (buf.numberOfChannels === 1) return buf.getChannelData(0).slice();
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < buf.length; i++) out[i] += data[i] / buf.numberOfChannels;
  }
  return out;
}

/**
 * Decode + concatenate all segments into one mono clip. Adds a small silence pad
 * around each spoken variable so it doesn't sound spliced (recorded chunks should
 * carry their own lead-in/out). decodeAudioData resamples every clip to the
 * context's rate, so all decoded pieces already share a sample rate.
 */
export async function assembleVoicemail(
  segments: ResolvedSegment[],
  opts: { variablePadMs?: number } = {},
): Promise<AssembledAudio> {
  const ctx = getAudioContext();
  const rate = ctx.sampleRate;
  const padFrames = Math.round((Math.max(0, opts.variablePadMs ?? 80) / 1000) * rate);

  const pieces: Array<{ data?: Float32Array; silence?: number }> = [];
  try {
    for (const seg of segments) {
      if (seg.type === "silence") {
        pieces.push({ silence: Math.round((seg.ms / 1000) * rate) });
        continue;
      }
      const res = await fetch(seg.url);
      if (!res.ok) throw new Error(`Couldn't load audio segment (${res.status})`);
      const arr = await res.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arr);
      if (seg.type === "variable" && padFrames) pieces.push({ silence: padFrames });
      pieces.push({ data: toMono(decoded) }); // toMono copies data OUT of the context buffer
      if (seg.type === "variable" && padFrames) pieces.push({ silence: padFrames });
    }
  } finally {
    // Safe to close — all sample data has been copied into plain Float32Arrays.
    try {
      await ctx.close();
    } catch {
      /* ignore */
    }
  }

  const total = pieces.reduce((n, p) => n + (p.data?.length ?? p.silence ?? 0), 0);
  if (total === 0) throw new Error("Nothing to assemble — the template produced no audio.");

  const samples = new Float32Array(total);
  let offset = 0;
  for (const p of pieces) {
    if (p.data) {
      samples.set(p.data, offset);
      offset += p.data.length;
    } else {
      offset += p.silence ?? 0;
    }
  }
  return { samples, sampleRate: rate };
}

/** Encode assembled audio to a 16-bit PCM WAV Blob (for preview/download/storage). */
export function encodeWavBlob(audio: AssembledAudio): Blob {
  const { samples, sampleRate } = audio;
  const dataSize = samples.length * 2;
  const ab = new ArrayBuffer(44 + dataSize);
  const view = new DataView(ab);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (mono * 16-bit)
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Blob([ab], { type: "audio/wav" });
}

/** Build a MediaStream from assembled audio — used to inject the voicemail into a call. */
export function assembledToMediaStream(audio: AssembledAudio): {
  stream: MediaStream;
  ctx: AudioContext;
  durationMs: number;
  ended: Promise<void>;
} {
  const ctx = getAudioContext();
  const buf = ctx.createBuffer(1, audio.samples.length, audio.sampleRate);
  buf.getChannelData(0).set(audio.samples);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const dest = ctx.createMediaStreamDestination();
  src.connect(dest);
  const ended = new Promise<void>((resolve) => {
    src.onended = () => resolve();
  });
  src.start();
  return {
    stream: dest.stream,
    ctx,
    durationMs: (audio.samples.length / audio.sampleRate) * 1000,
    ended,
  };
}

/** Play assembled audio locally (for preview). Returns a stop() handle that also frees the context. */
export function playAssembled(audio: AssembledAudio): { stop: () => void; ended: Promise<void> } {
  const ctx = getAudioContext();
  const buf = ctx.createBuffer(1, audio.samples.length, audio.sampleRate);
  buf.getChannelData(0).set(audio.samples);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    try {
      ctx.close();
    } catch {
      /* ignore */
    }
  };
  const ended = new Promise<void>((resolve) => {
    src.onended = () => {
      close();
      resolve();
    };
  });
  src.start();
  return {
    stop: () => {
      try {
        src.stop();
      } catch {
        /* ignore */
      }
      close(); // free the context even if onended doesn't fire
    },
    ended,
  };
}
