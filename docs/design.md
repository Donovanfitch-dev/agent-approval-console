# Design notes

An independent demonstration application, written from scratch; not extracted from any production system; all data synthetic.

This document explains how the pieces fit together and where the guarantees come from. For the pitch and the guided tour, see the [README](../README.md).

## 1. Scope and non-goals

The system is a control point between "an agent decided to do something" and "the something happened". It owns: validating proposals, deciding how much human oversight each needs, collecting decisions, gating and performing execution exactly once, and recording a verifiable trail.

It deliberately does not own: authenticating people or agents, storing data durably, or talking to real payment, mail or order systems. Those are represented by ports (repository, executor) and demo stand-ins, and are listed as not implemented in the README status table.

## 2. Layering

```text
src/domain   pure TypeScript, depends only on node:crypto
  types.ts          plain data types (JSON-serialisable)
  errors.ts         DomainError family with stable codes and a bundle-safe guard
  validation.ts     tiny custom Reader: collects issues with dotted paths
  payloads.ts       per-action payload validators, field metadata, immutable-field table
  submission.ts     validation + canonical hash of an agent submission
  policy.ts         rules-as-data evaluation (pure)
  policy-config.ts  the demo rules
  state-machine.ts  legal transitions
  diff.ts           field-level payload diff
  audit.ts          canonical JSON, hash chain, verifyChain
  repository.ts     persistence port
  memory-repository.ts  in-memory adapter
  executor.ts       execution port + simulated adapter
  service.ts        ApprovalService: orchestrates everything above
  seed.ts, simulate.ts, demo-roles.ts, labels.ts, format.ts, app.ts
src/server   Next-specific glue (globalThis store, demo role, HTTP helpers)
src/app      pages and route handlers
```

Time, id generation, persistence, execution and policy are all injected into `ApprovalService`. Tests use a manually advanced clock, so expiry is tested by moving time rather than sleeping.

## 3. Domain model

A `Proposal` carries: the action `type`; the current `payload` and the `originalPayload`; a `payloadRevision` (0 until a reviewer edits); the agent's `rationale`, `ticketId` and `agentId`; the `idempotencyKey` and a `submissionHash`; `status`; the current `PolicyResult`; `approvals` (each bound to a payload revision); `edits` (each with its diff and the policy outcome before and after); an optional `rejection`; `execution` state (attempts, last error, receipt); `expiresAt`; and a `version` used for optimistic concurrency.

Money is integer cents. Timestamps are ISO-8601 strings. Everything is plain data, so a proposal round-trips through JSON (and through a `jsonb` column) unchanged.

### Validation

Validators are built around a small `Reader` that records every problem rather than stopping at the first, and reports dotted paths such as `payload.newAddress.country`. Unknown fields are rejected. Strings are trimmed. The payload validators return a fresh object, so nothing the caller still holds can alias stored state.

## 4. Risk policy

`evaluatePolicy(type, payload, config)` is a pure function. A `PolicyRule` is data: an action type, a condition, an outcome, a machine-readable `reasonCode` and a human `message`. Conditions are a closed set: `always`, numeric comparisons (`gt`, `gte`, `lt`, `lte`), `in` for string membership, and `matches_any` for case-insensitive regular-expression sources.

- All rules for the action type whose condition holds are "matched".
- The outcome is the **strictest** matched outcome: `deny` > `needs_two_approvals` > `needs_approval` > `auto_approve`.
- **No matching rule fails closed** to `needs_approval` (`NO_MATCHING_RULE`).
- Reasons are the matched elevated rules, strictest first. If only the baseline matched, the baseline explains the auto-approval.
- `validatePolicyConfig` checks structure (duplicate ids, unknown actions or outcomes, invalid regular expressions) so a config loaded from storage can be rejected before use.
- `policyVersion` is stamped on every result and audit entry, so a historical decision can be tied to the rules that produced it.

Why data? Policy is the part of this system that changes most often and is reviewed by people who are not the engine's authors. Keeping it declarative makes changes diffable and auditable, and the closed condition set bounds what a rule can do. A config that grew into a general expression language would have recreated code with worse tooling; the engine intentionally stays small.

## 5. State machine

```text
proposed -> pending_approval | approved | rejected
pending_approval -> approved | rejected | expired
approved -> executing
executing -> executed | failed
failed -> executing        (retry)
executed, rejected, expired: terminal
```

`transition(from, to)` returns `to` or throws `IllegalTransitionError`. A test walks the full status-by-status matrix and asserts that every pair outside the table throws. `proposed` is transient: `submit` evaluates policy and moves the proposal to its first resting state in one atomic commit.

**Expiry.** A proposal entering `pending_approval` gets `expiresAt = now + ttl` (24 hours by default, injectable). `expireStale()` moves every overdue pending proposal to `expired` and writes an `expired` audit entry. It runs lazily at the start of every read and decision, so there is no timer to keep alive; a production system would also run it on a schedule so stale items disappear without a reader.

## 6. Decisions and separation of duties

`decide(id, actor, decision)`:

1. **Role check first**: an `agent`-kind actor is refused before anything else happens: no expiry sweep, no existence check, no state read. The refusal is written to the audit log as `decision_refused` (with the caller-supplied id, truncated) and surfaced as HTTP 403. The answer is identical for existing and unknown ids, and the refusal entry is the only side effect (a unit test asserts exactly that, with an overdue proposal that a sweep would have expired).
2. Expire stale proposals, then load the proposal (a reviewer or admin gets 404 for an unknown id).
3. **Proposer check**: an actor whose id equals the proposal's `agentId` is refused (also audited). This needs the proposal, so it necessarily follows the load.
4. Require `pending_approval`.
5. Apply the decision.

**Approve** records an approval bound to the current `payloadRevision`. A reviewer who has already approved this revision cannot approve again. The proposal moves to `approved` only when the number of **distinct** reviewers with approvals on the current revision reaches the policy's `requiredApprovals`.

**Reject** requires a non-empty reason (at most 500 characters).

**Edit-then-approve** validates the new payload with the same validators, refuses changes to locked fields (`IMMUTABLE_FIELDS`: order, customer, currency, shipment status), refuses a no-op, and then:

- computes a diff and re-evaluates policy on the edited payload;
- bumps `payloadRevision`, which is what invalidates earlier approvals (approvals are history, filtered by revision, never deleted);
- if the edited payload is now `deny`, ends the proposal as `rejected` by policy;
- otherwise records the editor's approval on the new revision and approves if the new requirement is met. An edit that raises the amount can escalate a one-approver proposal to two approvers; an edit that lowers it can drop the requirement.

Audit entries for an edit: `payload_edited` (with the diff, policy before and after, and how many approvals were invalidated), `policy_evaluated`, `approval_recorded`, and `approved` or `rejected` if applicable.

## 7. Execution and idempotency

Approval never runs a side effect. Only `reviewer` and `admin` actors may trigger execution: `execute(id, actor)` first refuses an `agent` actor (403, audited as `decision_refused` with `attempted: "execute"`, no state read), so an agent cannot cause the effect it proposed. There is no separate system path: auto-approved proposals also wait for a reviewer or admin to execute them, and a reviewer may execute a proposal they approved. Then `execute(id, actor)`:

1. Read the proposal. `executed` returns `already_executed`; `executing` returns `in_progress`; any state other than `approved` or `failed` throws `IllegalTransitionError` (HTTP 409).
2. **Claim**: commit `status = executing`, `attempts + 1` and an `execution_started` entry with `expectedVersion` set to the version just read. If another caller got there first, the repository raises `ConflictError`; this caller re-reads and reports the winner's state. Of N simultaneous callers exactly one claims.
3. Call the executor with the proposal's idempotency key. This runs outside any storage transaction, because it is the one step that cannot be rolled back.
4. Commit `executed` with the receipt, or `failed` with the error text, each with its audit entry.

Layers of protection against duplicates:

| Layer | Mechanism | Covers |
|---|---|---|
| Submission | idempotency key unique per proposal; same content returns the original, different content is a 409 | agent or network retries of "propose" |
| Claim | compare-and-set on `version` | double clicks, concurrent workers |
| Downstream | executor receives the key and deduplicates | a call that succeeded but whose result was lost |

`SimulatedExecutor` honours layer three the way a good payments API would: the second call with a key returns the first receipt without repeating the effect. It also supports failure injection: an order id containing `FLAKY` fails its first attempt (a transient downstream timeout) and succeeds on retry. A `failed` proposal can move back to `executing`; the retry reuses the same key.

Known gap: if the process dies after the claim but before the outcome is committed, the proposal is stuck in `executing`. The remedy is a reconciliation job that asks the downstream system, by idempotency key, whether the effect happened, then completes or reverts the claim. It is not built.

## 8. Audit log

Each entry: `seq` (gap-free, 1-based), `proposalId`, `type`, `actor`, `at`, `data`, `prevHash`, `hash`, where

```text
hash = SHA-256( prevHash + "\n" + canonicalJSON({ seq, proposalId, type, actor, at, data }) )
```

`canonicalJSON` sorts object keys recursively, so equal data always hashes equally regardless of key order. The first entry's `prevHash` is 64 zeros.

`verifyChain(entries)` recomputes everything and returns `{ valid, checked, headHash, firstInvalidSeq?, reason? }`. It detects a changed field, changed nested data, a deleted entry, reordered entries, and a forged entry whose own hash was recomputed (the next entry's `prevHash` then disagrees). All of these are covered by tests.

What it cannot detect: **truncation of the tail**, and a wholesale rewrite of the chain by someone who can recompute every hash. Both require an external anchor: periodically publish `headHash` (the verification result exposes it) to a store the log's writer cannot modify, or sign it with a key held elsewhere. The chain is evidence that the stored history is internally consistent; a WORM store or an external transparency log is what makes the history unrewritable.

The audit events: `proposal_submitted`, `policy_evaluated`, `approval_recorded`, `payload_edited`, `approved`, `rejected`, `expired`, `decision_refused`, `execution_started`, `execution_succeeded`, `execution_failed`.

The repository, not the service, assigns `seq` and hashes, so the chain tail is serialised in one place.

## 9. Repository port and a Postgres implementation

`ProposalRepository` has six methods: `commit`, `appendAudit`, `getProposal`, `findByIdempotencyKey`, `listProposals` and `listAudit`. The contract:

- `commit({ proposal, expectedVersion, audit })` is **atomic**: the proposal write and its audit entries succeed or fail together. `expectedVersion: null` means insert.
- Writes are **optimistic**: a stale `expectedVersion` raises `ConflictError`.
- The idempotency key is **unique** across proposals.
- The repository assigns audit `seq`, `prevHash` and `hash` using `buildEntry` from `audit.ts`.

A Postgres implementation would slot in behind the same interface. This is a sketch only; none of it is built and the SQL below is not in the repo as a migration.

```sql
CREATE TABLE proposals (
  id               text PRIMARY KEY,
  idempotency_key  text NOT NULL UNIQUE,          -- layer 1 of idempotency
  status           text NOT NULL,
  version          integer NOT NULL,
  expires_at       timestamptz,
  body             jsonb NOT NULL                 -- the Proposal as JSON
);
CREATE INDEX ON proposals (status);

CREATE TABLE audit_entries (
  seq         bigint PRIMARY KEY,                 -- gap-free, assigned under lock
  proposal_id text,
  type        text NOT NULL,
  actor       text NOT NULL,
  at          timestamptz NOT NULL,
  data        jsonb NOT NULL,
  prev_hash   char(64) NOT NULL,
  hash        char(64) NOT NULL UNIQUE
);
-- Append-only at the database level: the application role gets INSERT and SELECT only,
-- and a trigger rejects UPDATE and DELETE even for privileged roles.
```

`commit` becomes one transaction: `UPDATE proposals SET ..., version = version + 1 WHERE id = $1 AND version = $2` (zero rows updated means `ConflictError`); `SELECT seq, hash FROM audit_entries ORDER BY seq DESC LIMIT 1 FOR UPDATE` (or an advisory lock) to serialise the chain tail; then `INSERT` the new entries. The unique constraint on `idempotency_key` maps to `IdempotencyConflictError`. `listAudit()` for verification streams rows in `seq` order. Expiry becomes a scheduled job over `WHERE status = 'pending_approval' AND expires_at <= now()`.

## 10. Next.js integration

- **Dynamic rendering.** The scaffold enables Cache Components by default; this project turns it off in `next.config.ts`, because every page shows live, mutable, per-request data (a store and a cookie), and Activity-based route retention would keep stale queue views alive. Pages export `dynamic = "force-dynamic"`; route handlers do the same and respond with `Cache-Control: no-store`.
- **Store singleton.** `src/server/store.ts` keeps the app on `globalThis` under `Symbol.for(...)`. A plain module variable is not enough: the dev server re-evaluates modules on hot reload, and pages and route handlers can be bundled into separate module graphs, each of which would otherwise get its own empty store. The store is created (and seeded) lazily as a promise, and a failed initialisation is not cached.
- **Bundle-safe error checks.** The same duplication means a `DomainError` thrown by a service created in one bundle is not `instanceof DomainError` in another. This showed up in a curl check during the build as a validation error returned as HTTP 500. Boundary code therefore uses `isDomainError` / `hasErrorCode`, which test a `Symbol.for` brand and the error code instead of class identity. Domain-internal `instanceof` checks stay safe because a service and the repository it uses always come from the same bundle.
- **Async request APIs.** `params`, `searchParams` and `cookies()` are awaited; page and handler props use the generated `PageProps`, `LayoutProps` and `RouteContext` helpers (produced by `next typegen`, which `npm run typecheck` runs first).
- **HTTP boundary.** Every mutating route checks the content type before doing anything else (`requireJson` in `src/server/http.ts`, directly or through `readJson`): anything but `Content-Type: application/json` is a 415, which keeps cross-site HTML form posts (urlencoded, multipart, text/plain) out; it is not a full CSRF defence (no tokens or origin checks). Bodies are read as a stream and cut off at 64 KiB counted in bytes (413), not buffered first. `parseDecision` allows each decision kind only its own fields, so `payload` on an `approve` is a 422 rather than being silently ignored. The two destructive demo endpoints (`/api/demo/reset`, `/api/demo/tamper`) return 403 unless the process was started with `ENABLE_DEMO_CONTROLS=1`, read per request.
- **Turbopack root.** `next.config.ts` pins `turbopack.root` to the project directory so a lockfile in a parent directory is never mistaken for this project's.
- **UI.** Server components render data directly from the service. Client components exist only where interaction is needed (role switcher, simulate, review actions, audit demo controls) and talk to the same route handlers an external caller would use, then call `router.refresh()`.
- **Accessibility and presentation.** Semantic landmarks and headings, a skip link, labelled controls, visible focus rings, status communicated by text and not colour alone, `aria-live` regions for action results, comfortably sized targets, layouts that reflow to phone width (the audit table scrolls inside its own labelled region), and light and dark themes from CSS custom properties following the OS preference. No component library, fonts are the system stack, and nothing is fetched from third parties.

## 11. Testing and accessibility checks

| Layer | Tool | What it covers |
|---|---|---|
| Domain | Vitest (112 tests in `src/domain/__tests__`) | The rules in sections 3 to 8: validation, policy, transition matrix, decisions, expiry, idempotent and concurrent execution, retry, hash chain, repository, seed and generator. Coverage of the loaded `src/domain` files was measured once with `@vitest/coverage-v8` (installed with `--no-save`, not a project dependency): about 94% of lines and 89% of branches; the UI-label helper `labels.ts` is exercised only by the browser tests |
| API handlers | Vitest (18 tests in `src/server/__tests__`) | The real route handlers called with `NextRequest` objects, without an HTTP server: 401/400/403 identity and authorization, execution restricted to reviewer and admin, 415, 413 (bytes), decision field rules, the demo flag gate |
| UI | Playwright (56 tests), Chromium only, against the production build | User flows listed in the README, plus layout, titles, landmarks, keyboard behaviour and axe |

The e2e suite starts the server with `ENABLE_DEMO_CONTROLS=1`, uses the demo reset endpoint before every test, and runs with one worker because the store is per process. The port is `E2E_PORT` (default 4317); `E2E_SKIP_BUILD=1` reuses an existing build, which CI does. It asserts behaviour through the DOM (roles, labels, visible text) and a handful of direct API calls.

Defects that the browser tests exposed and that were fixed:

- The audit page overflowed horizontally on phones: a grid child with an unshrinkable table stretched the whole page. Grid and flex children now have `min-width: 0`, so the table scrolls inside its own labelled region.
- Filter chips and several inline links were under 40px tall. They now have 40px minimum heights.
- Every page had the same title. Pages now set their own (the root-segment pages use absolute titles because a layout title template does not apply to pages in its own segment).
- Result and error messages in the review panel were a `role="alert"` element nested inside an `aria-live` region, which can announce the message twice; they are now sibling regions.
- After a successful decision the review panel was remounted (it was keyed on the proposal version), which discarded the confirmation message and dropped keyboard focus to `<body>`. The panel is no longer remounted; the result region takes focus after an action; the identity line in the header is `aria-live`.

Not verified: any assistive technology, browsers other than Chromium, real devices.

## 12. Demo stand-ins

| Stand-in | Real thing it replaces | Note |
|---|---|---|
| Role cookie or `x-demo-role` header | Authenticated session or token, mapped to an `Actor` | The domain only sees `Actor { id, kind }`, which is the seam a real auth layer would fill |
| Agent identity supplied in the submit body | Service credential per agent | |
| Templates and a seeded PRNG | An actual agent | Shows policy paths; says nothing about model behaviour |
| `SimulatedExecutor` | Payment, email and order-system clients | |
| Tamper and reset endpoints | Nothing; they exist to demonstrate detection | The service has no API that edits or deletes audit rows |

## 13. Security notes

This is a demonstration, and the demo role is not security. Things a production version would need that this one does not have: verified identity, authorization policy beyond "reviewer or admin", per-agent credentials and quotas, rate limiting, CSRF defence for cookie-authenticated calls, an authoritative source for facts like shipment status instead of agent-reported fields, redaction rules for the rationale and payload in logs, and external anchoring of the audit head.

Mitigations that are present: input validation with unknown-field rejection, a JSON-only content type and a byte-counted body cap on mutating routes, server-side enforcement of separation of duties (not hidden buttons), execution restricted to reviewer and admin roles, refusal of agent-role decisions and executions before any state is read or changed, audited refusals, locked identifying fields during edits, fail-closed policy defaults, and a regular-expression rule set authored as data rather than accepted from callers.
