// Spend guard per service. When a service reaches its cap, callers fall back (plan text,
// browser voice) instead of failing. Caps are env-configurable; ElevenLabs is capped well
// under the team's $1.40 share by default.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type Service = "text" | "tts";

export interface Budget {
  canSpend(service: Service, estimateUsd: number): boolean;
  record(service: Service, usd: number): void;
  report(): Record<Service, { spent: number; cap: number }>;
}

export class FileBudget implements Budget {
  private spent: Record<Service, number> = { text: 0, tts: 0 };

  constructor(
    private readonly file: string | null,
    private readonly caps: Record<Service, number>,
  ) {
    if (file && existsSync(file)) {
      try {
        this.spent = { ...this.spent, ...JSON.parse(readFileSync(file, "utf8")) };
      } catch {
        /* start from zero if the file is unreadable */
      }
    }
  }

  canSpend(service: Service, estimateUsd: number) {
    return this.spent[service] + estimateUsd <= this.caps[service];
  }

  record(service: Service, usd: number) {
    this.spent[service] = Math.round((this.spent[service] + usd) * 1e6) / 1e6;
    if (this.file) {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.spent), "utf8");
    }
  }

  report() {
    return {
      text: { spent: this.spent.text, cap: this.caps.text },
      tts: { spent: this.spent.tts, cap: this.caps.tts },
    };
  }
}
