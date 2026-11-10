import { formatCents } from "@/domain/format";
import { FIELD_SPECS } from "@/domain/payloads";
import type { ActionType, DiffEntry, Payload } from "@/domain/types";

function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function display(kind: string, value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (kind === "money" && typeof value === "number") return formatCents(value);
  return kind === "enum" ? String(value).replace(/_/g, " ") : String(value);
}

export function PayloadView({ type, payload }: { type: ActionType; payload: Payload }) {
  const rows = FIELD_SPECS[type].filter((spec) => getPath(payload, spec.path) !== undefined);
  return (
    <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[minmax(10rem,14rem)_1fr]">
      {rows.map((spec) => (
        <div key={spec.path} className="contents">
          <dt className="muted text-sm font-semibold">{spec.label}</dt>
          <dd className={`text-sm ${spec.kind === "longtext" ? "whitespace-pre-wrap" : ""}`}>
            {display(spec.kind, getPath(payload, spec.path))}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Format a raw diff value using the field's kind (e.g. cents -> dollars). */
export function DiffTable({ type, diff }: { type: ActionType; diff: DiffEntry[] }) {
  const kindOf = (path: string) => FIELD_SPECS[type].find((s) => s.path === path)?.kind ?? "text";
  const labelOf = (path: string) => FIELD_SPECS[type].find((s) => s.path === path)?.label ?? path;
  return (
    <table className="data-table">
      <caption className="sr-only">Fields changed by the reviewer</caption>
      <thead>
        <tr>
          <th scope="col">Field</th>
          <th scope="col">Before</th>
          <th scope="col">After</th>
        </tr>
      </thead>
      <tbody>
        {diff.map((d) => (
          <tr key={d.path}>
            <th scope="row" className="!text-[var(--fg)]">
              {labelOf(d.path)}
            </th>
            <td className="whitespace-pre-wrap">
              <span className="badge badge-bad" aria-label="removed value">
                −
              </span>{" "}
              {display(kindOf(d.path), d.before)}
            </td>
            <td className="whitespace-pre-wrap">
              <span className="badge badge-ok" aria-label="new value">
                +
              </span>{" "}
              {display(kindOf(d.path), d.after)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
