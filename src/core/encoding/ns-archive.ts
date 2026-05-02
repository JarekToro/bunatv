import { Plist } from "@/core/encoding/plist.ts";
import type { PlistValue } from "@/core/encoding/plist.ts";

/** The magic value that identifies an NSKeyedArchiver plist */
const NSKEYEDARCHIVER = "NSKeyedArchiver";

/**
 * A parsed UID reference from a binary plist.
 * The @plist/binary.parse library represents UIDs as `{ "CF$UID": number | bigint }`.
 */
interface PlistUID {
  "CF$UID": number | bigint;
}

function isPlistUID(value: unknown): value is PlistUID {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "CF$UID" in value
  );
}

function uidToIndex(uid: PlistUID): number {
  const raw = uid["CF$UID"];
  return typeof raw === "bigint" ? Number(raw) : raw;
}

/**
 * NSArchive decodes NSKeyedArchiver binary plists produced by Apple's
 * `NSKeyedArchiver` / `[NSKeyedArchiver archivedDataWithRootObject:]` APIs.
 *
 * The format wraps the real payload inside a binary plist with the following
 * top-level structure:
 *
 * ```
 * {
 *   "$archiver": "NSKeyedArchiver",
 *   "$version": 100000,
 *   "$top":     { "root": UID(1) },   // or other key names
 *   "$objects":  [ "$null", <obj1>, <obj2>, … ]
 * }
 * ```
 *
 * All real objects live in the `$objects` array. References between them use
 * UID values (`{ "CF$UID": <index> }`). Class information is stored in special
 * entries and resolved transparently.
 *
 * Supported class mappings:
 *  - NSDictionary / NSMutableDictionary  → plain JS object
 *  - NSArray / NSMutableArray            → JS array
 *  - NSSet / NSMutableSet                → JS array
 *  - NSData / NSMutableData              → ArrayBuffer
 *  - NSString / NSMutableString          → string (via NS.string key)
 *  - NSNumber / NSDecimalNumber          → number / bigint / boolean
 *  - NSDate                              → Date
 *  - Everything else                     → plain JS object with $class field
 */
export class NSArchive {
  /**
   * Decode a buffer that may be either a plain binary plist or an
   * NSKeyedArchiver archive.  If it is an archive the dearchived object
   * is returned; otherwise the raw plist value is returned as-is.
   */
  static decode(buffer: ArrayBufferLike | ArrayBufferView): PlistValue {
    const plist = Plist.decode(buffer);
    return NSArchive.dearchive(plist);
  }

  /**
   * Dearchive an already-parsed plist value.  Returns the value unchanged
   * if it is not an NSKeyedArchiver archive.
   */
  static dearchive(plist: PlistValue): PlistValue {
    if (!isNSKeyedArchiverRoot(plist)) {
      return plist;
    }

    const objects = plist["$objects"] as PlistValue[];
    const top = plist["$top"] as Record<string, PlistValue>;

    // Resolve the top-level object. The "root" key is canonical but Apple
    // sometimes uses other keys; fall back to the first key in $top.
    const topKey = "root" in top ? "root" : Object.keys(top)[0];
    if (topKey == null) {
      return plist;
    }

    const topUID = top[topKey];
    if (!isPlistUID(topUID)) {
      return plist;
    }

    const resolver = new UIDResolver(objects);
    return resolver.resolveUID(topUID);
  }
}

/** Type guard: is `plist` the root object of an NSKeyedArchiver archive? */
function isNSKeyedArchiverRoot(
  plist: PlistValue
): plist is Record<string, PlistValue> {
  return (
    typeof plist === "object" &&
    plist !== null &&
    !Array.isArray(plist) &&
    !(plist instanceof Date) &&
    !(plist instanceof ArrayBuffer) &&
    plist["$archiver"] === NSKEYEDARCHIVER &&
    Array.isArray(plist["$objects"]) &&
    typeof plist["$top"] === "object"
  );
}

class UIDResolver {
  private readonly cache = new Map<number, PlistValue>();

  constructor(private readonly objects: PlistValue[]) {}

  resolveUID(uid: PlistUID): PlistValue {
    const index = uidToIndex(uid);
    if (this.cache.has(index)) {
      return this.cache.get(index)!;
    }
    const raw = this.objects[index];
    // Guard against infinite loops in malformed archives
    this.cache.set(index, null);
    const resolved = this.resolveValue(raw);
    this.cache.set(index, resolved);
    return resolved;
  }

  private resolveValue(value: PlistValue): PlistValue {
    if (value === null || value === "$null") {
      return null;
    }

    if (isPlistUID(value as unknown)) {
      return this.resolveUID(value as unknown as PlistUID);
    }

    if (typeof value !== "object" || value instanceof Date) {
      // Primitives (string, number, bigint, boolean, Date) are already decoded.
      return value;
    }

    if (value instanceof ArrayBuffer) {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.resolveValue(item));
    }

    // Plain object — may be a class-encoded NS object or a raw dict
    return this.resolveObject(value as Record<string, PlistValue>);
  }

  private resolveObject(obj: Record<string, PlistValue>): PlistValue {
    const classRef = obj["$class"];

    if (classRef == null || !isPlistUID(classRef as unknown)) {
      // No class reference — resolve any UID values inside and return
      return this.resolveRawDict(obj);
    }

    // Read the class entry directly from $objects to avoid stripping
    // $-prefixed keys before we can extract the class name.
    const classIndex = uidToIndex(classRef as unknown as PlistUID);
    const classObj = this.objects[classIndex];
    const className = getClassName(classObj);

    switch (className) {
      case "NSDictionary":
      case "NSMutableDictionary": {
        const keys = obj["NS.keys"];
        const values = obj["NS.objects"];
        if (!Array.isArray(keys) || !Array.isArray(values)) {
          return this.resolveRawDict(obj);
        }
        const dict: Record<string, PlistValue> = {};
        for (let i = 0; i < keys.length; i++) {
          const resolvedKey = this.resolveValue(keys[i]!);
          const resolvedVal = this.resolveValue(values[i] ?? null);
          if (typeof resolvedKey === "string") {
            dict[resolvedKey] = resolvedVal;
          }
        }
        return dict;
      }

      case "NSArray":
      case "NSMutableArray":
      case "NSSet":
      case "NSMutableSet": {
        const items = obj["NS.objects"];
        if (!Array.isArray(items)) {
          return this.resolveRawDict(obj);
        }
        return items.map((item) => this.resolveValue(item));
      }

      case "NSData":
      case "NSMutableData": {
        const data = obj["NS.data"];
        if (data instanceof ArrayBuffer) return data;
        return this.resolveValue(data ?? null);
      }

      case "NSString":
      case "NSMutableString": {
        const str = obj["NS.string"];
        if (str != null) return this.resolveValue(str);
        return this.resolveRawDict(obj);
      }

      case "NSNumber":
      case "NSDecimalNumber": {
        // NSNumber stores its value directly — look for NS.intval / NS.dblval
        const intVal = obj["NS.intval"];
        if (intVal != null) return this.resolveValue(intVal);
        const dblVal = obj["NS.dblval"];
        if (dblVal != null) return this.resolveValue(dblVal);
        return this.resolveRawDict(obj);
      }

      case "NSDate": {
        const time = obj["NS.time"];
        if (typeof time === "number") {
          // NSDate stores seconds since Cocoa epoch (2001-01-01)
          return new Date((time + 978307200) * 1000);
        }
        return this.resolveRawDict(obj);
      }

      default: {
        // Unknown class — resolve any UID values, keep $class name for
        // introspection by callers.
        const result = this.resolveRawDict(obj);
        if (
          result !== null &&
          typeof result === "object" &&
          !Array.isArray(result) &&
          !(result instanceof Date) &&
          !(result instanceof ArrayBuffer)
        ) {
          (result as Record<string, PlistValue>)["$class"] = className ?? null;
        }
        return result;
      }
    }
  }

  /** Resolve all values in a plain dict, skipping `$`-prefixed meta-keys. */
  private resolveRawDict(obj: Record<string, PlistValue>): PlistValue {
    const result: Record<string, PlistValue> = {};
    for (const [key, val] of Object.entries(obj)) {
      if (key.startsWith("$")) continue;
      result[key] = this.resolveValue(val);
    }
    return result;
  }
}

/** Extract the class name from a resolved `$class` object. */
function getClassName(classObj: PlistValue): string | null {
  if (
    classObj === null ||
    typeof classObj !== "object" ||
    Array.isArray(classObj) ||
    classObj instanceof Date ||
    classObj instanceof ArrayBuffer
  ) {
    return null;
  }
  const name = (classObj as Record<string, PlistValue>)["$classname"];
  return typeof name === "string" ? name : null;
}

/**
 * Decode a buffer as an NSKeyedArchiver archive, falling back to raw plist
 * parsing. Convenience wrapper around {@link NSArchive.decode}.
 */
export function decodeNSArchive(
  buffer: ArrayBufferLike | ArrayBufferView
): PlistValue {
  return NSArchive.decode(buffer);
}
