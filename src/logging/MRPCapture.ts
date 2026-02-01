// src/protocols/mrp/capture.ts

import { mkdir, writeFile } from "node:fs/promises";
import { createWriteStream, type WriteStream } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createLogger } from "@/logging/logging.ts";
import { ProtocolMessageExtensionDisplayNameMap } from "@/protocols/mrp/generated/ProtocolMessageResolver.ts";

const logger = createLogger("bunatv:mrp:capture");

export type CaptureMode = "ALL" | "UNKNOWN" | "NONE";

interface CaptureEntry {
  ts: number;
  dir: "in" | "out";
  type: number;
  typeName: string;
  binFile: string; // filename of the raw binary
  hasUnknown: boolean;
  unknownPaths: string[];
  decoded: unknown;
}

function getCaptureMode(): CaptureMode {
  const env = process.env.BUNATV_MRP_CAPTURE?.toUpperCase();
  if (env === "ALL" || env === "UNKNOWN") return env;
  return "ALL";
}

function hasUnknownFields(
  obj: unknown,
  path = "",
  seen = new WeakSet()
): string[] {
  const paths: string[] = [];

  if (!obj || typeof obj !== "object") return paths;
  if (seen.has(obj)) return paths;
  seen.add(obj);

  if ("_unknownFields" in obj) {
    const unknown = (obj as Record<string, unknown>)._unknownFields;
    if (
      unknown &&
      typeof unknown === "object" &&
      Object.keys(unknown).length > 0
    ) {
      for (const fieldNum of Object.keys(unknown)) {
        paths.push(
          path
            ? `${path}._unknownFields.${fieldNum}`
            : `_unknownFields.${fieldNum}`
        );
      }
    }
  }

  for (const [key, value] of Object.entries(obj)) {
    if (key === "_unknownFields") continue;
    const nested = hasUnknownFields(value, path ? `${path}.${key}` : key, seen);
    paths.push(...nested);
  }

  return paths;
}

export class MRPCapture {
  private readonly sessionId: string;
  private readonly mode: CaptureMode;
  private readonly sessionDir: string;
  private readonly binsDir: string;
  private stream: WriteStream | null = null;
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.sessionId = Bun.randomUUIDv7();
    this.mode = getCaptureMode();
    this.sessionDir = join(homedir(), ".bunatv", "captures", this.sessionId);
    this.binsDir = join(this.sessionDir, "bins");

    if (this.mode !== "NONE") {
      logger.info(
        { mode: this.mode, sessionId: this.sessionId },
        "MRP capture enabled"
      );
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.mode === "NONE") return;

    if (!this.initPromise) {
      this.initPromise = (async () => {
        await mkdir(this.binsDir, { recursive: true });
        const filePath = join(this.sessionDir, "messages.jsonl");
        this.stream = createWriteStream(filePath, { flags: "a" });
        logger.debug(
          { sessionDir: this.sessionDir },
          "Capture session created"
        );
      })();
    }

    return this.initPromise;
  }

  private async writeEntry(
    raw: Buffer | Uint8Array,
    dir: "in" | "out",
    type: number,
    decoded: unknown
  ): Promise<void> {
    await this.ensureInitialized();
    if (!this.stream) return;

    const unknownPaths = hasUnknownFields(decoded);
    const hasUnknown = unknownPaths.length > 0;

    if (!this.shouldCapture(hasUnknown)) return;

    const messageId = Bun.randomUUIDv7();
    const binFileName = `${messageId}.bin`;

    await writeFile(join(this.binsDir, binFileName), raw);

    const typeName =
      type !== -1
        ? ((ProtocolMessageExtensionDisplayNameMap as Record<number, string>)[
            type
          ] ?? "Unknown")
        : "Unknown";

    const entry: CaptureEntry = {
      ts: Date.now(),
      dir,
      type,
      typeName,
      binFile: binFileName,
      hasUnknown,
      unknownPaths,
      decoded,
    };

    this.stream.write(JSON.stringify(entry) + "\n");
  }

  private shouldCapture(hasUnknown: boolean): boolean {
    if (this.mode === "NONE") return false;
    if (this.mode === "ALL") return true;
    return hasUnknown; // UNKNOWN mode
  }

  async captureSent(
    raw: Buffer | Uint8Array,
    type: number,
    decoded: unknown
  ): Promise<void> {
    await this.writeEntry(raw, "out", type, decoded);
  }

  async captureReceived(
    raw: Buffer,
    type: number | undefined,
    decoded: unknown
  ): Promise<void> {
    await this.writeEntry(raw, "in", type ?? -1, decoded);
  }

  async close(): Promise<void> {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
  }
}
