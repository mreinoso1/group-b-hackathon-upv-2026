// Content-addressed cache. The key is a hash of everything that shapes the output (plan text,
// tone, style, model), so a changed plan regenerates by itself and a repeat costs nothing.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function cacheKey(parts: unknown): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
}

export interface Cache {
  getJson<T>(kind: string, key: string): T | undefined;
  putJson(kind: string, key: string, value: unknown): void;
  getBytes(kind: string, key: string, ext: string): Uint8Array | undefined;
  putBytes(kind: string, key: string, ext: string, bytes: Uint8Array): void;
  has(kind: string, key: string, ext: string): boolean;
}

const SAFE = /^[a-z0-9_-]+$/;

export class DiskCache implements Cache {
  constructor(private readonly dir: string) {}

  private path(kind: string, key: string, ext: string) {
    if (!SAFE.test(kind) || !SAFE.test(key) || !SAFE.test(ext)) throw new Error("bad cache key");
    return join(this.dir, kind, `${key}.${ext}`);
  }

  getJson<T>(kind: string, key: string): T | undefined {
    const p = this.path(kind, key, "json");
    if (!existsSync(p)) return undefined;
    try {
      return JSON.parse(readFileSync(p, "utf8")) as T;
    } catch {
      return undefined;
    }
  }

  putJson(kind: string, key: string, value: unknown) {
    mkdirSync(join(this.dir, kind), { recursive: true });
    writeFileSync(this.path(kind, key, "json"), JSON.stringify(value, null, 1), "utf8");
  }

  getBytes(kind: string, key: string, ext: string) {
    const p = this.path(kind, key, ext);
    return existsSync(p) ? new Uint8Array(readFileSync(p)) : undefined;
  }

  putBytes(kind: string, key: string, ext: string, bytes: Uint8Array) {
    mkdirSync(join(this.dir, kind), { recursive: true });
    writeFileSync(this.path(kind, key, ext), bytes);
  }

  has(kind: string, key: string, ext: string) {
    return existsSync(this.path(kind, key, ext));
  }
}

export class MemoryCache implements Cache {
  private map = new Map<string, unknown>();
  getJson<T>(kind: string, key: string) {
    return this.map.get(`${kind}/${key}.json`) as T | undefined;
  }
  putJson(kind: string, key: string, value: unknown) {
    this.map.set(`${kind}/${key}.json`, value);
  }
  getBytes(kind: string, key: string, ext: string) {
    return this.map.get(`${kind}/${key}.${ext}`) as Uint8Array | undefined;
  }
  putBytes(kind: string, key: string, ext: string, bytes: Uint8Array) {
    this.map.set(`${kind}/${key}.${ext}`, bytes);
  }
  has(kind: string, key: string, ext: string) {
    return this.map.has(`${kind}/${key}.${ext}`);
  }
}
