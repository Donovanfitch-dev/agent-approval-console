import type { App } from "@/domain/app";
import { createSeededApp } from "@/domain/seed";

/**
 * Process-wide singleton for the in-memory store.
 *
 * It lives on `globalThis` (under a Symbol.for key) rather than in a module
 * variable because Next may evaluate this module more than once: the dev
 * server re-evaluates modules on hot reload, and route handlers and pages can
 * be bundled into separate module graphs. A module-level variable would give
 * each graph its own empty store; `globalThis` is shared by all of them.
 *
 * State resets whenever the Node process restarts. There is no persistence.
 */
const KEY = Symbol.for("agent-approval-console.app");
type Holder = typeof globalThis & { [KEY]?: Promise<App> };

function create(): Promise<App> {
  const pending = createSeededApp();
  pending.catch(() => {
    // Do not cache a failed initialisation forever.
    if ((globalThis as Holder)[KEY] === pending) delete (globalThis as Holder)[KEY];
  });
  return pending;
}

export function getApp(): Promise<App> {
  const holder = globalThis as Holder;
  return (holder[KEY] ??= create());
}

/** Discard all state and re-seed. Used by the demo "reset" control. */
export function resetApp(): Promise<App> {
  const holder = globalThis as Holder;
  holder[KEY] = create();
  return holder[KEY];
}
