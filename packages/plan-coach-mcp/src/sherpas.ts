// Case data from the Sherpas MCP (https://mcp-hackathon.sherpaswealth.com/mcp), with cases/ as the
// fallback: the token lasts 72 hours, and the app must keep working when it expires.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { type CaseSource, type RawCase, UnknownCaseError } from "@bite/plan-core";
import { Limiter } from "./ai.ts";

export interface SherpasOptions {
  url: string;
  token: string;
  timeoutMs?: number;
  /** Tests pass an in-memory transport; the app talks Streamable HTTP. */
  transport?: () => Transport;
}

/** Reads the families through the Sherpas MCP tools `list_cases` and `get_case`. Each part is fetched once per process. */
export class SherpasCaseSource implements CaseSource {
  readonly name = "sherpas" as const;
  private client: Promise<Client> | null = null;
  private ids: Promise<string[]> | null = null;
  private cases = new Map<string, Promise<RawCase>>();
  // Same politeness as with the AI proxy: 4 calls at once, 60 a minute.
  private limiter = new Limiter(4, 60);

  constructor(private readonly opts: SherpasOptions) {}

  listIds(): Promise<string[]> {
    this.ids ??= this.text("list_cases", {}).then((t) => {
      const list: unknown = JSON.parse(t);
      if (!Array.isArray(list)) throw new Error("list_cases did not return a list");
      return list
        .map((c) => (typeof c === "object" && c !== null ? (c as { id?: unknown }).id : undefined))
        .filter((id): id is string => typeof id === "string")
        .sort();
    });
    const ids = this.ids;
    ids.catch(() => (this.ids = null)); // a failure is retried next time, not cached
    return ids;
  }

  async getCase(id: string): Promise<RawCase> {
    if (!(await this.listIds()).includes(id)) throw new UnknownCaseError(id);
    let hit = this.cases.get(id);
    if (!hit) {
      hit = this.fetchCase(id);
      this.cases.set(id, hit);
      hit.catch(() => this.cases.delete(id));
    }
    return hit;
  }

  private async fetchCase(id: string): Promise<RawCase> {
    const part = (p: string) => this.text("get_case", { caseId: id, part: p });
    const optional = (p: string) => part(p).catch(() => null);
    const [fh, ia, persona] = await Promise.all([part("financial-health"), optional("investment-analysis"), optional("persona")]);
    return { id, financialHealth: JSON.parse(fh), investmentAnalysis: ia ? JSON.parse(ia) : null, persona };
  }

  /** Calls one tool and returns its text; a tool error becomes an exception. */
  private text(name: string, args: Record<string, unknown>): Promise<string> {
    return this.limiter.run(async () => {
      const timeout = this.opts.timeoutMs ?? 10_000;
      let res;
      try {
        const client = await this.connect(timeout);
        res = await client.callTool({ name, arguments: args }, undefined, { timeout });
      } catch (err) {
        this.client = null; // reconnect next time (new token, network back)
        throw err;
      }
      const content = Array.isArray(res.content) ? res.content : [];
      const text = content.map((c) => (c.type === "text" ? c.text : "")).join("");
      if (res.isError) throw new Error(`${name}: ${text.slice(0, 200)}`);
      return text;
    });
  }

  private connect(timeout: number): Promise<Client> {
    this.client ??= (async () => {
      const client = new Client({ name: "plan-coach", version: "0.1.0" });
      const transport =
        this.opts.transport?.() ??
        new StreamableHTTPClientTransport(new URL(this.opts.url), {
          requestInit: { headers: { Authorization: `Bearer ${this.opts.token}` } },
        });
      await client.connect(transport, { timeout });
      return client;
    })();
    return this.client;
  }
}

/**
 * Tries the Sherpas MCP first; if it fails (expired token, no network), serves cases/ and
 * tries the MCP again after `retryMs`. `name` says which one served the last answer.
 */
export class FallbackCaseSource implements CaseSource {
  private served: CaseSource["name"];
  private downUntil = 0;

  constructor(
    private readonly primary: CaseSource,
    private readonly fallback: CaseSource,
    private readonly log: (msg: string) => void = () => undefined,
    private readonly retryMs = 60_000,
  ) {
    this.served = primary.name;
  }

  get name(): CaseSource["name"] {
    return this.served;
  }

  listIds(): Promise<string[]> {
    return this.run((s) => s.listIds());
  }

  getCase(id: string): Promise<RawCase> {
    return this.run((s) => s.getCase(id));
  }

  private async run<T>(f: (s: CaseSource) => Promise<T>): Promise<T> {
    if (Date.now() >= this.downUntil) {
      try {
        const value = await f(this.primary);
        this.served = this.primary.name;
        return value;
      } catch (err) {
        if (err instanceof UnknownCaseError) throw err;
        this.downUntil = Date.now() + this.retryMs;
        const why = err instanceof Error ? err.message : String(err);
        this.log(`${this.primary.name} case source failed (${why.slice(0, 160)}); using ${this.fallback.name} for ${Math.round(this.retryMs / 1000)} s`);
      }
    }
    const value = await f(this.fallback);
    this.served = this.fallback.name;
    return value;
  }
}
