"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DEMO_ROLES, DEMO_ROLE_LABELS, isDemoRole, type DemoRole } from "@/domain/demo-roles";
import { api, describeError } from "@/lib/api-client";

/**
 * DEMO STAND-IN for authentication: stores a role label in a cookie.
 * There is no login and nothing is verified.
 */
export function RoleSwitcher({ role }: { role: DemoRole }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function change(value: string) {
    if (!isDemoRole(value)) return;
    setError(null);
    try {
      await api("/api/role", { body: { role: value } });
      router.refresh();
    } catch (e) {
      setError(describeError(e));
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="demo-role" className="text-sm font-semibold">
        Acting as
      </label>
      <select
        id="demo-role"
        className="field !w-auto"
        value={role}
        onChange={(e) => change(e.target.value)}
        aria-describedby="demo-role-note"
      >
        {DEMO_ROLES.map((r) => (
          <option key={r} value={r}>
            {DEMO_ROLE_LABELS[r]}
          </option>
        ))}
      </select>
      <span id="demo-role-note" className="sr-only">
        Demo stand-in for authentication. Choosing a role is only a label; nothing is verified.
      </span>
      {error ? (
        <span role="alert" className="text-sm" style={{ color: "var(--bad-fg)" }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
