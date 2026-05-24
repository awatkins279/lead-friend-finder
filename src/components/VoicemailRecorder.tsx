import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Mic, Square, Play, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

/**
 * Record / upload / preview / clear a prerecorded voicemail for a campaign.
 * The recording is stored in the `voicemail-drops` private bucket at
 * `{user_id}/{listId}.webm`, and the path is saved on lists.voicemail_audio_url.
 */
export function VoicemailRecorder({
  listId,
  userId,
  currentPath,
  onChange,
}: {
  listId: string;
  userId: string;
  currentPath: string | null;
  onChange: (path: string | null) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);

  // Load preview URL when path is set
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!currentPath) { setPreviewUrl(null); return; }
      const { data } = await supabase.storage
        .from("voicemail-drops")
        .createSignedUrl(currentPath, 60 * 10);
      if (!cancelled) setPreviewUrl(data?.signedUrl ?? null);
    })();
    return () => { cancelled = true; };
  }, [currentPath]);

  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        await uploadBlob(blob);
      };
      rec.start();
      mediaRecRef.current = rec;
      setRecording(true);
      setSeconds(0);
      timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch (e: any) {
      toast.error(e?.message ?? "Mic permission denied");
    }
  };

  const stopRec = () => {
    mediaRecRef.current?.stop();
    mediaRecRef.current = null;
    setRecording(false);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  const uploadBlob = async (blob: Blob) => {
    setBusy(true);
    try {
      const path = `${userId}/${listId}.webm`;
      const { error } = await supabase.storage
        .from("voicemail-drops")
        .upload(path, blob, { upsert: true, contentType: "audio/webm" });
      if (error) throw error;
      const { error: upErr } = await supabase
        .from("lists")
        .update({ voicemail_audio_url: path })
        .eq("id", listId);
      if (upErr) throw upErr;
      onChange(path);
      toast.success("Voicemail saved");
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadBlob(file);
    e.target.value = "";
  };

  const clear = async () => {
    setBusy(true);
    try {
      if (currentPath) {
        await supabase.storage.from("voicemail-drops").remove([currentPath]);
      }
      await supabase.from("lists").update({ voicemail_audio_url: null }).eq("id", listId);
      onChange(null);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to clear");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card px-3 py-2 text-xs">
      <span className="font-semibold text-muted-foreground">Prerecorded voicemail:</span>

      {currentPath && previewUrl && (
        <audio src={previewUrl} controls className="h-8" />
      )}
      {currentPath && !previewUrl && <span className="text-muted-foreground">Loading…</span>}
      {!currentPath && !recording && (
        <span className="text-muted-foreground">none — record one to enable drop-and-go</span>
      )}

      {!recording ? (
        <Button size="sm" variant="outline" onClick={startRec} disabled={busy} className="h-8">
          <Mic className="mr-1.5 h-3.5 w-3.5" /> Record
        </Button>
      ) : (
        <Button size="sm" variant="destructive" onClick={stopRec} className="h-8">
          <Square className="mr-1.5 h-3.5 w-3.5" /> Stop ({seconds}s)
        </Button>
      )}

      <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border bg-background px-2.5 font-medium hover:bg-accent">
        <Upload className="h-3.5 w-3.5" />
        Upload file
        <input type="file" accept="audio/*" className="hidden" onChange={onFile} disabled={busy} />
      </label>

      {currentPath && (
        <Button size="sm" variant="ghost" onClick={clear} disabled={busy} className="h-8 text-destructive">
          <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Clear
        </Button>
      )}
    </div>
  );
}
