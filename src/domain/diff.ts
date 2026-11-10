import type { DiffEntry, JsonPrimitive } from "./types";

function flatten(value: unknown, prefix: string, out: Map<string, JsonPrimitive>): void {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, out);
    }
    return;
  }
  if (Array.isArray(value)) {
    out.set(prefix, JSON.stringify(value));
    return;
  }
  if (value === undefined) return;
  out.set(prefix, value as JsonPrimitive);
}

/**
 * Field-level diff between two payloads. Nested objects are flattened to
 * dotted paths. A field present on only one side reports `null` for the other.
 * Result is sorted by path so it is stable and easy to assert on.
 */
export function diffPayload(before: object, after: object): DiffEntry[] {
  const a = new Map<string, JsonPrimitive>();
  const b = new Map<string, JsonPrimitive>();
  flatten(before, "", a);
  flatten(after, "", b);
  const paths = [...new Set([...a.keys(), ...b.keys()])].sort();
  const diff: DiffEntry[] = [];
  for (const path of paths) {
    const x = a.has(path) ? (a.get(path) as JsonPrimitive) : null;
    const y = b.has(path) ? (b.get(path) as JsonPrimitive) : null;
    if (x !== y) diff.push({ path, before: x, after: y });
  }
  return diff;
}
