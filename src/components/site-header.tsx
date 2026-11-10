import { DEMO_ACTORS, type DemoRole } from "@/domain/demo-roles";
import { NavLinks } from "./nav-links";
import { RoleSwitcher } from "./role-switcher";

export function SiteHeader({ role }: { role: DemoRole }) {
  return (
    <header style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
      <div
        role="note"
        className="px-4 py-2 text-center text-sm font-semibold"
        style={{ background: "var(--warn-bg)", color: "var(--warn-fg)" }}
      >
        Demo only: the role picker below is a stand-in for real authentication. It is just a label stored in a
        cookie; nothing is verified.
      </div>
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3">
        <div>
          <p className="text-lg font-bold leading-tight">Agent Approval Console</p>
          <p className="muted text-xs">Larkspur Trail Supply (fictional) · support operations</p>
        </div>
        <NavLinks />
        <div className="flex flex-col gap-1">
          <RoleSwitcher role={role} />
          <p className="muted text-xs" aria-live="polite">
            Identity: <span className="mono">{DEMO_ACTORS[role].id}</span>
          </p>
        </div>
      </div>
    </header>
  );
}
