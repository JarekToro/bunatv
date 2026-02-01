import { serialize } from "@plist/binary.serialize";
import { parse } from "@plist/binary.parse";
import type { Value } from "@plist/common";
import { BunOptimizedUtils } from "@/core/encoding/buffer-utils.ts";

export type PlistValue = Value;
export class Plist {
  static encode(obj: PlistValue): ArrayBuffer {
    return serialize(obj) as ArrayBuffer;
  }

  static decode(buffer: ArrayBufferLike | ArrayBufferView): PlistValue {
    return parse(BunOptimizedUtils.ensureArrayBuffer(buffer));
  }
}

export function plistObjectGuard(
  value: PlistValue
): value is Record<string, PlistValue> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}
