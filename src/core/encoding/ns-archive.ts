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
    if (!topKey) {
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
      // Mirror the Python implementation: if a binary blob is itself a valid
      // NSKeyedArchiver, recursively decode it; otherwise return it as-is.
      try {
        return NSArchive.decode(value);
      } catch {
        return value;
      }
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

    // Read the class entry directly from $objects to get the full $classes
    // hierarchy.  Matching against $classes (not just $classname) mirrors the
    // Python implementation and correctly handles private Apple subclasses such
    // as __NSSingleObjectArrayI (whose $classes list contains "NSArray").
    const classIndex = uidToIndex(classRef as unknown as PlistUID);
    const classes = getClasses(this.objects[classIndex]);

    if (classes.includes("NSArray") || classes.includes("NSSet")) {
      const items = obj["NS.objects"];
      if (!Array.isArray(items)) {
        return this.resolveRawDict(obj);
      }
      return items.map((item) => this.resolveValue(item));
    }

    if (
      classes.includes("NSDictionary") ||
      classes.includes("NSMutableDictionary")
    ) {
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

    if (classes.includes("NSString") || classes.includes("NSMutableString")) {
      const str = obj["NS.string"];
      if (str != null) return this.resolveValue(str);
      return this.resolveRawDict(obj);
    }

    if (classes.includes("NSData") || classes.includes("NSMutableData")) {
      const data = obj["NS.data"];
      if (data instanceof ArrayBuffer) return this.resolveValue(data);
      return this.resolveValue(data ?? null);
    }

    if (
      classes.includes("NSNumber") ||
      classes.includes("NSDecimalNumber")
    ) {
      const intVal = obj["NS.intval"];
      if (intVal != null) return this.resolveValue(intVal);
      const dblVal = obj["NS.dblval"];
      if (dblVal != null) return this.resolveValue(dblVal);
      return this.resolveRawDict(obj);
    }

    if (classes.includes("NSDate")) {
      const time = obj["NS.time"];
      if (typeof time === "number") {
        // NSDate stores seconds since Cocoa epoch (2001-01-01)
        return new Date((time + 978307200) * 1000);
      }
      return this.resolveRawDict(obj);
    }

    // Unknown class — resolve UID values and preserve the leaf class name
    // for introspection by callers.
    const result = this.resolveRawDict(obj);
    if (
      result !== null &&
      typeof result === "object" &&
      !Array.isArray(result) &&
      !(result instanceof Date) &&
      !(result instanceof ArrayBuffer)
    ) {
      const leafName = getLeafClassName(this.objects[classIndex]);
      (result as Record<string, PlistValue>)["$class"] = leafName ?? null;
    }
    return result;
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

/**
 * Return the `$classes` array from a class-descriptor object in $objects.
 * This is the full class hierarchy (e.g. ["NSMutableArray", "NSArray", "NSObject"])
 * and is used for class detection so that private Apple subclasses (e.g.
 * __NSSingleObjectArrayI) are still recognised as NSArray.
 */
function getClasses(classObj: PlistValue): string[] {
  if (
    classObj === null ||
    typeof classObj !== "object" ||
    Array.isArray(classObj) ||
    classObj instanceof Date ||
    classObj instanceof ArrayBuffer
  ) {
    return [];
  }
  const classes = (classObj as Record<string, PlistValue>)["$classes"];
  if (!Array.isArray(classes)) return [];
  return classes.filter((c): c is string => typeof c === "string");
}

/** Return `$classname` from a class-descriptor object (the leaf / concrete class name). */
function getLeafClassName(classObj: PlistValue): string | null {
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
