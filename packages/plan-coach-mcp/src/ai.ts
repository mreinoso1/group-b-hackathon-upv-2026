// Client for the hackathon AI proxy (OpenAI-compatible). Lives only in plan-coach, the one
// process that reads TEAM_KEY. Shared limiter keeps us inside the team quota.
import type { ChatMessage } from "@bite/plan-core";

export interface ChatResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
}

export interface AiClient {
  chat(messages: ChatMessage[]): Promise<ChatResult>;
  speech(input: string): Promise<Uint8Array>;
}

export interface AiConfig {
  baseUrl: string;
  key: string;
  textModel?: string;
  /** gpt-5 reasoning effort: minimal | low | medium. */
  reasoning?: string;
  ttsModel?: string;
  voice?: string;
}

/** At most `concurrency` calls at once and `perMinute` starts per rolling minute. */
export class Limiter {
  private active = 0;
  private queue: (() => void)[] = [];
  private starts: number[] = [];

  constructor(
    private readonly concurrency: number,
    private readonly perMinute: number,
  ) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }

  private async acquire(): Promise<void> {
    while (this.active >= this.concurrency) await new Promise<void>((r) => this.queue.push(r));
    for (;;) {
      const now = Date.now();
      this.starts = this.starts.filter((t) => now - t < 60_000);
      if (this.starts.length < this.perMinute) break;
      await new Promise((r) => setTimeout(r, 60_000 - (now - this.starts[0]!) + 10));
    }
    this.active++;
    this.starts.push(Date.now());
  }
}

// Team limits are 4 concurrent / 60 per minute; one slot stays free for a voice session.
const limiter = new Limiter(3, 50);

export function createAiClient(cfg: AiConfig): AiClient {
  const base = cfg.baseUrl.replace(/\/$/, "");
  const headers = { Authorization: `Bearer ${cfg.key}`, "content-type": "application/json" };

  const post = (path: string, body: unknown, timeoutMs: number) =>
    limiter.run(async () => {
      const res = await fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) {
        const detail = (await res.text().catch(() => "")).slice(0, 200);
        throw new Error(`AI proxy ${path} answered ${res.status}: ${detail}`);
      }
      return res;
    });

  return {
    async chat(messages) {
      // No max_tokens: gpt-5-mini spends part of the budget on reasoning (see README).
      // "low" reasoning follows the brevity rules and answers in a few seconds (default effort took 10+ s).
      const res = await post("/v1/chat/completions", { model: cfg.textModel ?? "gpt-5-mini", reasoning_effort: cfg.reasoning ?? "low", messages }, 45_000);
      const body = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      return {
        text: body.choices?.[0]?.message?.content ?? "",
        promptTokens: body.usage?.prompt_tokens ?? 0,
        completionTokens: body.usage?.completion_tokens ?? 0,
      };
    },
    async speech(input) {
      const res = await post("/v1/audio/speech", { model: cfg.ttsModel ?? "eleven-flash-v2.5", voice: cfg.voice ?? "alloy", input, response_format: "mp3" }, 45_000);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}

/** Usage prices from the hackathon README (USD). */
export const PRICES = {
  "gpt-5-mini": { input: 0.25 / 1e6, output: 2 / 1e6 },
  "eleven-flash-v2.5": { perChar: 0.04 / 1000 },
} as const;
