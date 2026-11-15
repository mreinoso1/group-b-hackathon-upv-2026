// Read a text aloud with a realtime voice model through the hackathon proxy. Used when the
// ElevenLabs route is unavailable. The model also returns a transcript of what it said, which
// must match the text (words and numbers) or the audio is thrown away.
import { allowedNumbers, checkNumbers } from "@bite/plan-core";
import WebSocket from "ws";

export interface VoiceResult {
  /** 16-bit mono PCM at 24 kHz. */
  pcm: Uint8Array;
  transcript: string;
  usd: number;
}

export interface VoiceConfig {
  baseUrl: string;
  key: string;
  model?: string;
  voice?: string;
}

const RATE = 24_000;

// gpt-realtime-2.1-mini usage prices from the README (USD per token).
const PRICE = { audioOut: 20 / 1e6, textIn: 0.6 / 1e6, textOut: 2.4 / 1e6 };

const INSTRUCTIONS =
  "You are a text-to-speech voice. Read the user's message aloud exactly as written, word for word, " +
  "in warm, calm American English at an easy pace. Do not add, drop or change any word, and do not reply to it.";

/** The longest a faithful reading of the text can be (slow pace + margin), in PCM bytes. */
export function maxSpeechBytes(text: string, rate = RATE): number {
  return Math.ceil((words(text).length / 1.8 + 2) * rate * 2);
}

/**
 * Voice models stream at about real time: allow the reading time plus a margin. `onChunk` gets
 * the audio as it arrives; past `maxSpeechBytes` the reading is cut, since it can't be the text.
 */
export function realtimeSpeech(
  text: string,
  cfg: VoiceConfig,
  onChunk?: (pcm: Uint8Array) => void,
  timeoutMs = 20_000 + words(text).length * 800,
): Promise<VoiceResult> {
  const model = cfg.model ?? "gpt-realtime-2.1-mini";
  const url = `${cfg.baseUrl.replace(/\/$/, "").replace(/^http/, "ws")}/v1/realtime?model=${model}`;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${cfg.key}` } });
    const chunks: Buffer[] = [];
    let transcript = "";
    const timer = setTimeout(() => finish(new Error("voice model timed out")), timeoutMs);
    let done = false;

    function finish(err: Error | null, usd = 0) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      ws.close();
      if (err) reject(err);
      else resolve({ pcm: new Uint8Array(Buffer.concat(chunks)), transcript: transcript.trim(), usd });
    }

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "session.update",
          session: {
            type: "realtime",
            instructions: INSTRUCTIONS,
            audio: {
              input: { format: { type: "audio/pcm", rate: RATE }, turn_detection: null },
              // Gemini picks its own voice; OpenAI models take a voice name.
              output: { format: { type: "audio/pcm", rate: RATE }, ...(model.startsWith("gpt") ? { voice: cfg.voice ?? "marin" } : {}) },
            },
          },
        }),
      );
      ws.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } }));
      ws.send(JSON.stringify({ type: "response.create" }));
    });

    ws.on("message", (data) => {
      let ev: { type?: string; delta?: string; error?: { message?: string }; response?: { usage?: Usage } };
      try {
        ev = JSON.parse(data.toString());
      } catch {
        return;
      }
      if ((ev.type === "response.output_audio.delta" || ev.type === "response.audio.delta") && ev.delta) {
        const chunk = Buffer.from(ev.delta, "base64");
        chunks.push(chunk);
        if (chunks.reduce((n, c) => n + c.length, 0) > maxSpeechBytes(text)) return finish(new Error("voice ran far longer than the text"));
        onChunk?.(new Uint8Array(chunk));
      }
      if ((ev.type === "response.output_audio_transcript.delta" || ev.type === "response.audio_transcript.delta") && ev.delta) transcript += ev.delta;
      if (ev.type === "error") finish(new Error(`voice model error: ${ev.error?.message ?? "unknown"}`));
      if (ev.type === "response.done") finish(null, costOf(ev.response?.usage));
    });

    ws.on("unexpected-response", (_req, res) => finish(new Error(`voice model refused: HTTP ${res.statusCode}`)));
    ws.on("error", (e) => finish(e));
    ws.on("close", () => finish(new Error("voice model closed the connection")));
  });
}

interface Usage {
  input_token_details?: { text_tokens?: number };
  output_token_details?: { audio_tokens?: number; text_tokens?: number };
}

function costOf(u?: Usage): number {
  if (!u) return 0;
  return (
    (u.output_token_details?.audio_tokens ?? 0) * PRICE.audioOut +
    (u.output_token_details?.text_tokens ?? 0) * PRICE.textOut +
    (u.input_token_details?.text_tokens ?? 0) * PRICE.textIn
  );
}

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9'$%.,\s]/g, " ")
    .replace(/[.,](?!\d)/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/**
 * Did the voice say the text? Every number must match the text's numbers, and nearly all of
 * the text's words must be spoken (a little slack for how a transcript spells things).
 */
export function saidTheText(text: string, transcript: string): boolean {
  if (!transcript) return false;
  if (!checkNumbers(transcript, allowedNumbers([text])).ok) return false;
  const said = new Set(words(transcript));
  const expected = words(text);
  const heard = expected.filter((w) => said.has(w)).length;
  return heard / Math.max(1, expected.length) >= 0.85 && words(transcript).length <= expected.length * 1.2 + 3;
}

/**
 * For voice models that return no transcript (Gemini Live through the proxy): the length must
 * fit the text at a normal reading pace, which catches added commentary or dropped sentences.
 */
export function plausibleLength(text: string, pcmBytes: number, rate = RATE): boolean {
  const seconds = pcmBytes / (rate * 2);
  const perSecond = words(text).length / Math.max(0.1, seconds);
  return perSecond >= 1.8 && perSecond <= 3.8;
}

/** A playable WAV file around 16-bit mono PCM. */
export function wav(pcm: Uint8Array, rate = RATE): Uint8Array {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return new Uint8Array(Buffer.concat([header, Buffer.from(pcm)]));
}
