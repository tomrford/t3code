import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  type GitCommandError,
  type GitManagerServiceError,
  type VcsCreateRefInput,
  type VcsCreateRefResult,
  type VcsCreateWorktreeInput,
  type VcsCreateWorktreeResult,
  type VcsError,
  type VcsListRefsInput,
  type VcsListRefsResult,
  type VcsPullResult,
  type VcsRemoteStatusOptions,
  type VcsRemoveWorktreeInput,
  type VcsStatusInput,
  type VcsStatusLocalResult,
  type VcsStatusRemoteResult,
  type VcsStatusResult,
  type VcsSwitchRefInput,
  type VcsSwitchRefResult,
  VcsUnsupportedOperationError,
} from "@t3tools/contracts";
import { mergeGitStatusParts } from "@t3tools/shared/git";

import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import type * as VcsDriver from "./VcsDriver.ts";
import * as VcsDriverRegistry from "./VcsDriverRegistry.ts";

export type VcsWorkflowError = GitManagerServiceError | GitCommandError | VcsError;

export class VcsWorkflowService extends Context.Service<
  VcsWorkflowService,
  {
    readonly status: (input: VcsStatusInput) => Effect.Effect<VcsStatusResult, VcsWorkflowError>;
    readonly localStatus: (
      input: VcsStatusInput,
    ) => Effect.Effect<VcsStatusLocalResult, VcsWorkflowError>;
    readonly remoteStatus: (
      input: VcsStatusInput,
      options?: VcsRemoteStatusOptions,
    ) => Effect.Effect<VcsStatusRemoteResult | null, VcsWorkflowError>;
    readonly invalidateLocalStatus: (cwd: string) => Effect.Effect<void, never>;
    readonly invalidateRemoteStatus: (cwd: string) => Effect.Effect<void, never>;
    readonly invalidateStatus: (cwd: string) => Effect.Effect<void, never>;
    readonly pullCurrentBranch: (cwd: string) => Effect.Effect<VcsPullResult, VcsWorkflowError>;
    readonly listRefs: (
      input: VcsListRefsInput,
    ) => Effect.Effect<VcsListRefsResult, VcsWorkflowError>;
    readonly createWorktree: (
      input: VcsCreateWorktreeInput,
    ) => Effect.Effect<VcsCreateWorktreeResult, VcsWorkflowError>;
    readonly removeWorktree: (
      input: VcsRemoveWorktreeInput,
    ) => Effect.Effect<void, VcsWorkflowError>;
    readonly createRef: (
      input: VcsCreateRefInput,
    ) => Effect.Effect<VcsCreateRefResult, VcsWorkflowError>;
    readonly switchRef: (
      input: VcsSwitchRefInput,
    ) => Effect.Effect<VcsSwitchRefResult, VcsWorkflowError>;
  }
>()("t3/vcs/VcsWorkflowService") {}

function nonRepositoryLocalStatus(): VcsStatusLocalResult {
  return {
    isRepo: false,
    hasPrimaryRemote: false,
    isDefaultRef: false,
    refName: null,
    hasWorkingTreeChanges: false,
    workingTree: {
      files: [],
      insertions: 0,
      deletions: 0,
    },
  };
}

function nonRepositoryListRefs(): VcsListRefsResult {
  return {
    refs: [],
    isRepo: false,
    hasPrimaryRemote: false,
    nextCursor: null,
    totalCount: 0,
  };
}

function unsupportedDriverOperation(
  driver: VcsDriver.VcsDriver["Service"],
  operation: string,
  detail: string,
): Effect.Effect<never, VcsError> {
  return Effect.fail(
    new VcsUnsupportedOperationError({
      operation,
      kind: driver.capabilities.kind,
      detail,
    }),
  );
}

export const make = Effect.gen(function* () {
  const registry = yield* VcsDriverRegistry.VcsDriverRegistry;
  const gitWorkflow = yield* GitWorkflowService.GitWorkflowService;

  const resolve = (cwd: string) => registry.resolve({ cwd });
  const detect = (cwd: string) => registry.detect({ cwd });

  const localStatus = Effect.fn("VcsWorkflowService.localStatus")(function* (
    input: VcsStatusInput,
  ) {
    const handle = yield* detect(input.cwd);
    if (!handle) {
      return nonRepositoryLocalStatus();
    }
    if (handle.kind === "git") {
      return yield* gitWorkflow.localStatus(input);
    }
    if (handle.driver.localStatus) {
      return yield* handle.driver.localStatus(input);
    }
    return yield* unsupportedDriverOperation(
      handle.driver,
      "VcsWorkflowService.localStatus",
      "This VCS driver does not expose local status.",
    );
  });

  const remoteStatus = Effect.fn("VcsWorkflowService.remoteStatus")(function* (
    input: VcsStatusInput,
    options?: VcsRemoteStatusOptions,
  ) {
    const handle = yield* detect(input.cwd);
    if (!handle) {
      return null;
    }
    if (handle.kind === "git") {
      return yield* gitWorkflow.remoteStatus(input, options);
    }
    if (handle.driver.remoteStatus) {
      return yield* handle.driver.remoteStatus(input, options);
    }
    return null;
  });

  const listRefs = Effect.fn("VcsWorkflowService.listRefs")(function* (input: VcsListRefsInput) {
    const handle = yield* detect(input.cwd);
    if (!handle) {
      return nonRepositoryListRefs();
    }
    if (handle.kind === "git") {
      return yield* gitWorkflow.listRefs(input);
    }
    if (handle.driver.listRefs) {
      return yield* handle.driver.listRefs(input);
    }
    return {
      ...nonRepositoryListRefs(),
      isRepo: true,
    };
  });

  return VcsWorkflowService.of({
    status: (input) =>
      Effect.all([localStatus(input), remoteStatus(input)], { concurrency: "unbounded" }).pipe(
        Effect.map(([local, remote]) => mergeGitStatusParts(local, remote)),
      ),
    localStatus,
    remoteStatus,
    invalidateLocalStatus: (cwd) =>
      detect(cwd).pipe(
        Effect.flatMap((handle) =>
          handle?.kind === "git" ? gitWorkflow.invalidateLocalStatus(cwd) : Effect.void,
        ),
        Effect.orElseSucceed(() => undefined),
      ),
    invalidateRemoteStatus: (cwd) =>
      detect(cwd).pipe(
        Effect.flatMap((handle) =>
          handle?.kind === "git" ? gitWorkflow.invalidateRemoteStatus(cwd) : Effect.void,
        ),
        Effect.orElseSucceed(() => undefined),
      ),
    invalidateStatus: (cwd) =>
      Effect.all(
        [
          detect(cwd).pipe(
            Effect.flatMap((handle) =>
              handle?.kind === "git" ? gitWorkflow.invalidateLocalStatus(cwd) : Effect.void,
            ),
          ),
          detect(cwd).pipe(
            Effect.flatMap((handle) =>
              handle?.kind === "git" ? gitWorkflow.invalidateRemoteStatus(cwd) : Effect.void,
            ),
          ),
        ],
        { concurrency: "unbounded", discard: true },
      ).pipe(Effect.orElseSucceed(() => undefined)),
    pullCurrentBranch: Effect.fn("VcsWorkflowService.pullCurrentBranch")(function* (cwd) {
      const handle = yield* resolve(cwd);
      if (handle.kind === "git") {
        return yield* gitWorkflow.pullCurrentBranch(cwd);
      }
      if (handle.driver.pullCurrentBranch) {
        return yield* handle.driver.pullCurrentBranch(cwd);
      }
      return yield* unsupportedDriverOperation(
        handle.driver,
        "VcsWorkflowService.pullCurrentBranch",
        "Pull is not supported by this VCS driver.",
      );
    }),
    listRefs,
    createWorktree: Effect.fn("VcsWorkflowService.createWorktree")(function* (input) {
      const handle = yield* resolve(input.cwd);
      if (handle.kind === "git") {
        return yield* gitWorkflow.createWorktree(input);
      }
      if (handle.driver.capabilities.supportsWorktrees && handle.driver.createWorktree) {
        return yield* handle.driver.createWorktree(input);
      }
      return yield* unsupportedDriverOperation(
        handle.driver,
        "VcsWorkflowService.createWorktree",
        "Worktrees are not supported by this VCS driver.",
      );
    }),
    removeWorktree: Effect.fn("VcsWorkflowService.removeWorktree")(function* (input) {
      const handle = yield* resolve(input.cwd);
      if (handle.kind === "git") {
        return yield* gitWorkflow.removeWorktree(input);
      }
      if (handle.driver.capabilities.supportsWorktrees && handle.driver.removeWorktree) {
        return yield* handle.driver.removeWorktree(input);
      }
      return yield* unsupportedDriverOperation(
        handle.driver,
        "VcsWorkflowService.removeWorktree",
        "Worktrees are not supported by this VCS driver.",
      );
    }),
    createRef: Effect.fn("VcsWorkflowService.createRef")(function* (input) {
      const handle = yield* resolve(input.cwd);
      if (handle.kind === "git") {
        return yield* gitWorkflow.createRef(input);
      }
      if (handle.driver.createRef) {
        return yield* handle.driver.createRef(input);
      }
      return yield* unsupportedDriverOperation(
        handle.driver,
        "VcsWorkflowService.createRef",
        "Ref creation is not supported by this VCS driver.",
      );
    }),
    switchRef: Effect.fn("VcsWorkflowService.switchRef")(function* (input) {
      const handle = yield* resolve(input.cwd);
      if (handle.kind === "git") {
        return yield* gitWorkflow.switchRef(input);
      }
      if (handle.driver.switchRef) {
        return yield* handle.driver.switchRef(input);
      }
      return yield* unsupportedDriverOperation(
        handle.driver,
        "VcsWorkflowService.switchRef",
        "Ref switching is not supported by this VCS driver.",
      );
    }),
  });
});

export const layer = Layer.effect(VcsWorkflowService, make);
