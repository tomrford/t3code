import * as NodeServices from "@effect/platform-node/NodeServices";
import { it as effectIt } from "@effect/vitest";
import {
  EventId,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { describe, expect, it, vi } from "vite-plus/test";

import * as ServerConfig from "../../config.ts";
import * as DevspaceCli from "../../devspace/DevspaceCli.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import * as TerminalManager from "../../terminal/Manager.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { ThreadDeletionReactor } from "../Services/ThreadDeletionReactor.ts";
import { logCleanupCauseUnlessInterrupted } from "./ThreadDeletionReactor.ts";
import { ThreadDeletionReactorLive } from "./ThreadDeletionReactor.ts";

const TEST_EPOCH = "2026-01-01T00:00:00.000Z";

const modelSelection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4");

const makeServerConfig = (devspacesDir: string): ServerConfig.ServerConfig["Service"] => ({
  logLevel: "Info",
  traceMinLevel: "Info",
  traceTimingEnabled: true,
  traceBatchWindowMs: 200,
  traceMaxBytes: 10 * 1024 * 1024,
  traceMaxFiles: 10,
  otlpTracesUrl: undefined,
  otlpMetricsUrl: undefined,
  otlpExportIntervalMs: 10_000,
  otlpServiceName: "t3-server",
  mode: "desktop",
  port: 0,
  host: "127.0.0.1",
  cwd: "/tmp",
  baseDir: "/tmp/t3-thread-deletion-reactor",
  stateDir: "/tmp/t3-thread-deletion-reactor/state",
  dbPath: "/tmp/t3-thread-deletion-reactor/state/t3.sqlite",
  keybindingsConfigPath: "/tmp/t3-thread-deletion-reactor/keybindings.json",
  settingsPath: "/tmp/t3-thread-deletion-reactor/settings.json",
  providerStatusCacheDir: "/tmp/t3-thread-deletion-reactor/provider-status",
  worktreesDir: "/tmp/t3-thread-deletion-reactor/worktrees",
  devspacesDir,
  attachmentsDir: "/tmp/t3-thread-deletion-reactor/attachments",
  logsDir: "/tmp/t3-thread-deletion-reactor/logs",
  serverLogPath: "/tmp/t3-thread-deletion-reactor/logs/server.log",
  serverTracePath: "/tmp/t3-thread-deletion-reactor/logs/server-trace.ndjson",
  providerLogsDir: "/tmp/t3-thread-deletion-reactor/logs/providers",
  providerEventLogPath: "/tmp/t3-thread-deletion-reactor/logs/provider-events.ndjson",
  terminalLogsDir: "/tmp/t3-thread-deletion-reactor/logs/terminals",
  anonymousIdPath: "/tmp/t3-thread-deletion-reactor/anonymous-id",
  environmentIdPath: "/tmp/t3-thread-deletion-reactor/environment-id",
  serverRuntimeStatePath: "/tmp/t3-thread-deletion-reactor/runtime-state.json",
  secretsDir: "/tmp/t3-thread-deletion-reactor/secrets",
  staticDir: undefined,
  devUrl: undefined,
  noBrowser: true,
  noAuth: false,
  startupPresentation: "browser",
  desktopBootstrapToken: undefined,
  autoBootstrapProjectFromCwd: false,
  logWebSocketEvents: false,
  tailscaleServeEnabled: false,
  tailscaleServePort: 443,
});

const makeDeletedEvent = (threadId: ThreadId): OrchestrationEvent => ({
  sequence: 1,
  eventId: EventId.make("event-thread-deleted"),
  aggregateKind: "thread",
  aggregateId: threadId,
  occurredAt: TEST_EPOCH,
  commandId: null,
  causationEventId: null,
  correlationId: null,
  metadata: {},
  type: "thread.deleted",
  payload: {
    threadId,
    deletedAt: TEST_EPOCH,
  },
});

const makeArchivedEvent = (threadId: ThreadId): OrchestrationEvent => ({
  sequence: 1,
  eventId: EventId.make("event-thread-archived"),
  aggregateKind: "thread",
  aggregateId: threadId,
  occurredAt: TEST_EPOCH,
  commandId: null,
  causationEventId: null,
  correlationId: null,
  metadata: {},
  type: "thread.archived",
  payload: {
    threadId,
    archivedAt: TEST_EPOCH,
    updatedAt: TEST_EPOCH,
  },
});

const makeReadModel = (input: {
  readonly devspacesDir: string;
  readonly deletedThreadId: ThreadId;
  readonly worktreePath: string;
  readonly archived?: boolean;
  readonly sharedByLiveThread?: boolean;
}): OrchestrationReadModel => {
  const projectId = ProjectId.make("project-devspace");
  const sharedThreadId = ThreadId.make("thread-shared");
  return {
    snapshotSequence: 1,
    updatedAt: TEST_EPOCH,
    projects: [
      {
        id: projectId,
        title: "owner/repo",
        workspaceRoot: `${input.devspacesDir}/owner/repo`,
        devspaceRepo: "owner/repo",
        repositoryIdentity: null,
        defaultModelSelection: null,
        scripts: [],
        createdAt: TEST_EPOCH,
        updatedAt: TEST_EPOCH,
        deletedAt: null,
      },
    ],
    threads: [
      {
        id: input.deletedThreadId,
        projectId,
        title: "Deleted Thread",
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: input.worktreePath,
        latestTurn: null,
        createdAt: TEST_EPOCH,
        updatedAt: TEST_EPOCH,
        archivedAt: input.archived === true ? TEST_EPOCH : null,
        deletedAt: input.archived === true ? null : TEST_EPOCH,
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
      },
      ...(input.sharedByLiveThread
        ? [
            {
              id: sharedThreadId,
              projectId,
              title: "Shared Thread",
              modelSelection,
              runtimeMode: "full-access" as const,
              interactionMode: "default" as const,
              branch: null,
              worktreePath: input.worktreePath,
              latestTurn: null,
              createdAt: TEST_EPOCH,
              updatedAt: TEST_EPOCH,
              archivedAt: null,
              deletedAt: null,
              messages: [],
              proposedPlans: [],
              activities: [],
              checkpoints: [],
              session: null,
            },
          ]
        : []),
    ],
  };
};

const runReactor = (input: {
  readonly readModel: OrchestrationReadModel;
  readonly deletedThreadId: ThreadId;
  readonly event?: OrchestrationEvent;
  readonly devspacesDir: string;
  readonly stopSession?: ProviderService["Service"]["stopSession"];
  readonly closeTerminals?: TerminalManager.TerminalManager["Service"]["close"];
  readonly removeCheckout: DevspaceCli.DevspaceCli["Service"]["removeCheckout"];
}) =>
  Effect.gen(function* () {
    const eventEnqueued = yield* Deferred.make<void>();
    const cleanupEvent = input.event ?? makeDeletedEvent(input.deletedThreadId);
    const dependencies = Layer.mergeAll(
      Layer.mock(OrchestrationEngineService)({
        dispatch: () => Effect.die("dispatch not used by ThreadDeletionReactor test"),
        readEvents: () => Stream.empty,
        streamDomainEvents: Stream.make(cleanupEvent).pipe(
          Stream.concat(
            Stream.fromEffect(Deferred.succeed(eventEnqueued, undefined)).pipe(Stream.drain),
          ),
        ),
      }),
      Layer.mock(ProviderService)({
        stopSession: input.stopSession ?? (() => Effect.void),
        streamEvents: Stream.empty,
      }),
      Layer.mock(TerminalManager.TerminalManager)({
        close: input.closeTerminals ?? (() => Effect.void),
      }),
      Layer.mock(ProjectionSnapshotQuery)({
        getCommandReadModel: () => Effect.succeed(input.readModel),
      }),
      Layer.mock(DevspaceCli.DevspaceCli)({
        removeCheckout: input.removeCheckout,
      }),
      Layer.succeed(ServerConfig.ServerConfig, makeServerConfig(input.devspacesDir)),
      NodeServices.layer,
    );

    return yield* Effect.scoped(
      Effect.gen(function* () {
        const reactor = yield* ThreadDeletionReactor;
        yield* reactor.start();
        yield* Deferred.await(eventEnqueued);
        yield* reactor.drain;
      }),
    ).pipe(Effect.provide(ThreadDeletionReactorLive.pipe(Layer.provide(dependencies))));
  });

describe("logCleanupCauseUnlessInterrupted", () => {
  const threadId = ThreadId.make("thread-deletion-reactor-test");

  it("swallows ordinary cleanup failures", async () => {
    const exit = await Effect.runPromiseExit(
      logCleanupCauseUnlessInterrupted({
        effect: Effect.fail("cleanup failed"),
        message: "thread deletion cleanup skipped provider session stop",
        threadId,
      }),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("preserves interrupt causes", async () => {
    const exit = await Effect.runPromiseExit(
      logCleanupCauseUnlessInterrupted({
        effect: Effect.interrupt,
        message: "thread deletion cleanup skipped provider session stop",
        threadId,
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    }
  });
});

describe("ThreadDeletionReactor", () => {
  effectIt.effect("removes an unshared deleted devspace thread checkout", () =>
    Effect.gen(function* () {
      const devspacesDir = "/tmp/t3-thread-deletion-reactor-devspaces";
      const deletedThreadId = ThreadId.make("thread-deleted");
      const worktreePath = `${devspacesDir}/owner/repo/thread-deleted`;
      const removeCheckout = vi.fn<DevspaceCli.DevspaceCli["Service"]["removeCheckout"]>(
        () => Effect.void,
      );

      yield* runReactor({
        readModel: makeReadModel({
          devspacesDir,
          deletedThreadId,
          worktreePath,
        }),
        deletedThreadId,
        devspacesDir,
        removeCheckout,
      });

      expect(removeCheckout).toHaveBeenCalledWith({ path: worktreePath });
    }),
  );

  effectIt.effect("removes an unshared archived devspace thread checkout", () =>
    Effect.gen(function* () {
      const devspacesDir = "/tmp/t3-thread-deletion-reactor-devspaces";
      const archivedThreadId = ThreadId.make("thread-archived");
      const worktreePath = `${devspacesDir}/owner/repo/thread-archived`;
      const stopSession = vi.fn<ProviderService["Service"]["stopSession"]>(() => Effect.void);
      const closeTerminals = vi.fn<TerminalManager.TerminalManager["Service"]["close"]>(
        () => Effect.void,
      );
      const removeCheckout = vi.fn<DevspaceCli.DevspaceCli["Service"]["removeCheckout"]>(
        () => Effect.void,
      );

      yield* runReactor({
        readModel: makeReadModel({
          devspacesDir,
          deletedThreadId: archivedThreadId,
          worktreePath,
          archived: true,
        }),
        deletedThreadId: archivedThreadId,
        event: makeArchivedEvent(archivedThreadId),
        devspacesDir,
        stopSession,
        closeTerminals,
        removeCheckout,
      });

      expect(removeCheckout).toHaveBeenCalledWith({ path: worktreePath });
      expect(stopSession).toHaveBeenCalledWith({ threadId: archivedThreadId });
      expect(closeTerminals).toHaveBeenCalledWith({
        threadId: archivedThreadId,
        deleteHistory: true,
      });
    }),
  );

  effectIt.effect("does not remove a devspace checkout still used by a live thread", () =>
    Effect.gen(function* () {
      const devspacesDir = "/tmp/t3-thread-deletion-reactor-devspaces";
      const deletedThreadId = ThreadId.make("thread-deleted");
      const worktreePath = `${devspacesDir}/owner/repo/shared`;
      const removeCheckout = vi.fn<DevspaceCli.DevspaceCli["Service"]["removeCheckout"]>(
        () => Effect.void,
      );

      yield* runReactor({
        readModel: makeReadModel({
          devspacesDir,
          deletedThreadId,
          worktreePath,
          sharedByLiveThread: true,
        }),
        deletedThreadId,
        devspacesDir,
        removeCheckout,
      });

      expect(removeCheckout).not.toHaveBeenCalled();
    }),
  );
});
