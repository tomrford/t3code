import type { OrchestrationReadModel, OrchestrationThread } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { resolvesInsideDirectory } from "./checkoutPath.ts";

export const shouldRemoveThreadDevspaceCheckout = (input: {
  readonly readModel: OrchestrationReadModel;
  readonly thread: OrchestrationThread;
  readonly devspacesDir: string;
}) =>
  Effect.gen(function* () {
    const { readModel, thread } = input;
    if (!thread.worktreePath) {
      return false;
    }

    const project = readModel.projects.find((candidate) => candidate.id === thread.projectId);
    if (project?.devspaceRepo === undefined) {
      return false;
    }

    const isInsideDevspacesDir = yield* resolvesInsideDirectory({
      directory: input.devspacesDir,
      path: thread.worktreePath,
    });
    if (!isInsideDevspacesDir) {
      return false;
    }

    const sharedByLiveThread = readModel.threads.some(
      (candidate) =>
        candidate.id !== thread.id &&
        candidate.deletedAt === null &&
        candidate.worktreePath === thread.worktreePath,
    );
    return !sharedByLiveThread;
  });
