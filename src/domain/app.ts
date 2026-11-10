import { InMemoryRepository } from "./memory-repository";
import { SimulatedExecutor, type FailureRule, flakyOrderFailure } from "./executor";
import { DEFAULT_POLICY } from "./policy-config";
import type { PolicyConfig } from "./policy";
import { ApprovalService, sequentialIds } from "./service";

export interface AppOptions {
  clock?: () => Date;
  policy?: PolicyConfig;
  pendingTtlMs?: number;
  failureRule?: FailureRule;
}

/** The composed domain: service plus the concrete in-memory adapters. */
export interface App {
  service: ApprovalService;
  repo: InMemoryRepository;
  executor: SimulatedExecutor;
  clock: () => Date;
}

export function createApp(options: AppOptions = {}): App {
  const clock = options.clock ?? (() => new Date());
  const repo = new InMemoryRepository();
  const executor = new SimulatedExecutor(clock, options.failureRule ?? flakyOrderFailure);
  const service = new ApprovalService({
    repo,
    executor,
    policy: options.policy ?? DEFAULT_POLICY,
    clock,
    nextId: sequentialIds("PR"),
    pendingTtlMs: options.pendingTtlMs,
  });
  return { service, repo, executor, clock };
}
