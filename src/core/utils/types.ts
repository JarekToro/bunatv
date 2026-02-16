import type { PlistValue } from "@/core/encoding/plist.ts";

export type DePlistify<T extends object, KeysToMap extends keyof T> = {
  [K in keyof T]: K extends KeysToMap
    ? PlistValue | Exclude<T[K], Buffer>
    : T[K];
};
