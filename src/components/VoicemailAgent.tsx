import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Loader2, Mic, Square, Upload, CheckCircle2, Sparkles, Play, Shuffle } from "lucide-react";
import { toast } from "sonner";
import {
  getVoicemailProfile,
  saveVoicemailSettings,
  cloneVoice,
  synthesizeVoicemail,
  type VoicemailSettings,
} from "@/lib/voicemail.functions";

const TEST_SCRIPTS: ((rep: string) => string)[] = [
  (rep) => `Hey Sarah, this is ${rep}. Saw your team just expanded into the Midwest — congrats on that. The reason I'm calling is we help sales orgs your size cut their outbound prep time by about 80 percent. Figured it might be worth a quick chat. Shoot me a text back or call me when you get a sec.`,
  (rep) => `Hey it's ${rep}, real quick — I noticed you guys just hired a few more SDRs, so figured the timing might actually be right for this. We're helping teams like yours make their reps productive in week one instead of month three. If that's interesting at all, give me a call back when you get a chance.`,
  (rep) => `Hi Marcus, ${rep} here. I'll keep this short. Most VPs of sales I talk to are losing 15 to 20 hours a week to manual prospecting work that honestly shouldn't be a human job anymore. If that sounds familiar, I'd love to show you what we built. Grab a slot on my calendar or just call me back.`,
  (rep) => `Hey, this is ${rep}. I won't waste your time with a pitch — I just had a quick idea I think could save your team a real chunk of time on outbound. If it's worth 10 minutes to hear it out, just text me back and we'll find a time. Talk soon.`,
  (rep) => `Hey Jen, ${rep} calling. Quick one — we just rolled out something I genuinely think your team would get a lot out of, and I'd rather walk you through it than leave a long voicemail about it. Call me back when you have a sec or shoot me a text. Appreciate it.`,
];

const SAMPLE_SCRIPT = `Hey this is [name], I was just reaching out because I work with a platform that helps sales teams automate their outbound completely. Everything from personalized emails written for each prospect, to cold calling scripts, to real time coaching on live calls. I know your time is valuable so I will keep this short. If this is something that could be useful for your team I would love to connect. Feel free to call me back or shoot me a text and we can find a time to chat. Looking forward to talking.`;

const INSTRUCTIONS = `Record yourself speaking naturally for 60 seconds using the script below. Do not just read it word for word. Talk the way you actually talk when you are leaving a voicemail for a real prospect. Use your sales voice, be relaxed, be human, and speak like you are genuinely reaching out to someone. The AI will clone whatever it hears so make it sound like you.`;

export function VoicemailAgent({ userId }: { userId: string }) {
  const getProfileFn = useServerFn(getVoicemailProfile);
  const saveFn = useServerFn(saveVoicemailSettings);
  const cloneFn = useServerFn(cloneVoice);
  const synthFn = useServerFn(synthesizeVoicemail);

  // Test playback state
  const [testing, setTesting] = useState(false);
  const [testScript, setTestScript] = useState<string | null>(null);
  const testAudioRef = useRef<HTMLAudioElement | null>(null);

  const playTest = async () => {
    if (!voiceId) {
      toast.error("Record or upload a voice sample first");
      return;
    }
    setTesting(true);
    try {
      const rep = settings.rep_name?.trim() || "Alex";
      const script = TEST_SCRIPTS[Math.floor(Math.random() * TEST_SCRIPTS.length)](rep);
      setTestScript(script);
      const res = await synthFn({ data: { script } });
      const audio = new Audio(`data:audio/mpeg;base64,${res.audioBase64}`);
      testAudioRef.current?.pause();
      testAudioRef.current = audio;
      await audio.play();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to play test voicemail");
    } finally {
      setTesting(false);
    }
  };

  const [loading, setLoading] = useState(true);
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [settings, setSettings] = useState<VoicemailSettings>({
    length: "medium",
    tone: "conversational",
    cta_type: "callback",
    personalization: 60,
  });
  const [saving, setSaving] = useState(false);
  const [cloning, setCloning] = useState(false);

  // Recorder state
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);

  // Load profile
  useEffect(() => {
    (async () => {
      try {
        const res = await getProfileFn();
        setVoiceId(res.voiceId);
        setSettings({
          length: "medium",
          tone: "conversational",
          cta_type: "callback",
          personalization: 60,
          ...res.settings,
        });
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosave settings (debounced)
  const settingsKey = useMemo(() => JSON.stringify(settings), [settings]);
  useEffect(() => {
    if (loading) return;
    const t = window.setTimeout(async () => {
      setSaving(true);
      try {
        await saveFn({ data: settings });
      } catch (e: any) {
        toast.error(e?.message ?? "Failed to save settings");
      } finally {
        setSaving(false);
      }
    }, 700);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsKey, loading]);

  const update = (patch: Partial<VoicemailSettings>) =>
    setSettings((s) => ({ ...s, ...patch }));

  // ---------- Voice cloning ----------
  const uploadAndClone = async (blob: Blob, ext: string, name: string) => {
    setCloning(true);
    try {
      const path = `${userId}/sample-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("voice-clone-samples")
        .upload(path, blob, { upsert: true, contentType: blob.type || "audio/webm" });
      if (upErr) throw upErr;
      const res = await cloneFn({ data: { storagePath: path, name } });
      setVoiceId(res.voiceId);
      toast.success("Voice clone created");
    } catch (e: any) {
      toast.error(e?.message ?? "Voice cloning failed");
    } finally {
      setCloning(false);
    }
  };

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
        await uploadAndClone(blob, "webm", `Voice clone ${new Date().toLocaleDateString()}`);
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

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split(".").pop() || "mp3";
    await uploadAndClone(file, ext, file.name);
    e.target.value = "";
  };

  if (loading) {
    return (
      <Card className="p-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="border-b bg-gradient-to-r from-primary/5 to-transparent px-6 py-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="text-base font-semibold">AI Voicemail Agent</h3>
          {saving && <span className="text-xs text-muted-foreground">Saving…</span>}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Personalized AI voicemails in your cloned voice — generated the moment a call starts, dropped with one tap.
        </p>
      </div>

      {/* Voice cloning */}
      <div className="space-y-3 border-b px-6 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold">Your cloned voice</h4>
            {voiceId ? (
              <p className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Voice clone active — ready to drop voicemails
              </p>
            ) : (
              <p className="mt-0.5 text-xs text-muted-foreground">No voice clone yet. Record or upload a sample below.</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!recording ? (
              <Button size="sm" variant="outline" onClick={startRec} disabled={cloning}>
                <Mic className="mr-1.5 h-3.5 w-3.5" /> Record 60s
              </Button>
            ) : (
              <Button size="sm" variant="destructive" onClick={stopRec}>
                <Square className="mr-1.5 h-3.5 w-3.5" /> Stop ({seconds}s)
              </Button>
            )}
            <label className={`inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border bg-background px-3 text-sm font-medium hover:bg-accent ${cloning ? "opacity-50 pointer-events-none" : ""}`}>
              <Upload className="h-3.5 w-3.5" />
              Upload audio
              <input type="file" accept="audio/*" className="hidden" onChange={onFile} disabled={cloning} />
            </label>
            {cloning && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
        </div>

        <div className="rounded-md border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
          {INSTRUCTIONS}
        </div>
        <div className="rounded-md border border-dashed bg-card p-3">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sample script (read loosely)</div>
          <p className="text-sm italic leading-relaxed">{SAMPLE_SCRIPT}</p>
        </div>
      </div>

      {/* Settings */}
      <div className="grid grid-cols-1 gap-4 px-6 py-5 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="vm-rep-name">Rep name</Label>
          <Input
            id="vm-rep-name"
            placeholder="The name the AI uses when introducing you"
            value={settings.rep_name ?? ""}
            onChange={(e) => update({ rep_name: e.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Voicemail length</Label>
          <Select value={settings.length ?? "medium"} onValueChange={(v) => update({ length: v as any })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="short">Short (15–20s)</SelectItem>
              <SelectItem value="medium">Medium (25–30s)</SelectItem>
              <SelectItem value="long">Long (35–45s)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="vm-selling">What we are selling</Label>
          <Textarea
            id="vm-selling"
            rows={3}
            placeholder="Product or service description + key selling points"
            value={settings.what_selling ?? ""}
            onChange={(e) => update({ what_selling: e.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Tone</Label>
          <Select value={settings.tone ?? "conversational"} onValueChange={(v) => update({ tone: v as any })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="conversational">Conversational</SelectItem>
              <SelectItem value="professional">Professional</SelectItem>
              <SelectItem value="direct">Direct</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>CTA type</Label>
          <Select value={settings.cta_type ?? "callback"} onValueChange={(v) => update({ cta_type: v as any })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="callback">Call me back</SelectItem>
              <SelectItem value="text_back">Reply by text</SelectItem>
              <SelectItem value="book_meeting">Book a meeting</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {settings.cta_type === "custom" && (
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="vm-cta-custom">Custom CTA</Label>
            <Input
              id="vm-cta-custom"
              placeholder="e.g. Reply STOP to opt out, or visit example.com/demo"
              value={settings.cta_custom ?? ""}
              onChange={(e) => update({ cta_custom: e.target.value })}
            />
          </div>
        )}

        <div className="space-y-1.5 md:col-span-2">
          <Label>Personalization level: {settings.personalization ?? 60}</Label>
          <Slider
            value={[settings.personalization ?? 60]}
            min={0}
            max={100}
            step={5}
            onValueChange={([v]) => update({ personalization: v })}
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Basic</span>
            <span>Deep</span>
          </div>
        </div>

        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="vm-extra">Extra instructions</Label>
          <Textarea
            id="vm-extra"
            rows={2}
            placeholder="Anything the AI should know or avoid"
            value={settings.extra_instructions ?? ""}
            onChange={(e) => update({ extra_instructions: e.target.value })}
          />
        </div>
      </div>
    </Card>
  );
}
