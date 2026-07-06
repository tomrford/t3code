import {
  DevspaceBookmarkList,
  DevspaceCheckoutInfo,
  DevspaceCliDecodeError,
  type DevspaceCliError,
  DevspaceCliUnavailableError,
  DevspaceRepositoryList,
  DevspaceWorkspaceList,
  type VcsError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";

export const resolveDevspaceCommand = () => process.env.DEVSPACE_BIN ?? "ds";

export interface DevspaceAddCheckoutInput {
  readonly repo: string;
  readonly rev: string;
  readonly path: string;
}

export interface DevspaceRemoveCheckoutInput {
  readonly path: string;
}

export interface DevspaceInfoInput {
  readonly cwd: string;
}

export interface DevspaceListWorkspacesInput {
  readonly repo: string;
}

export interface DevspaceListBookmarksInput {
  readonly repo: string;
}

export class DevspaceCli extends Context.Service<
  DevspaceCli,
  {
    readonly listRepos: () => Effect.Effect<DevspaceRepositoryList, DevspaceCliError>;
    readonly addCheckout: (
      input: DevspaceAddCheckoutInput,
    ) => Effect.Effect<DevspaceCheckoutInfo, DevspaceCliError>;
    readonly removeCheckout: (
      input: DevspaceRemoveCheckoutInput,
    ) => Effect.Effect<void, DevspaceCliError>;
    readonly info: (
      input: DevspaceInfoInput,
    ) => Effect.Effect<DevspaceCheckoutInfo, DevspaceCliError>;
    readonly listWorkspaces: (
      input: DevspaceListWorkspacesInput,
    ) => Effect.Effect<DevspaceWorkspaceList, DevspaceCliError>;
    readonly listBookmarks: (
      input: DevspaceListBookmarksInput,
    ) => Effect.Effect<DevspaceBookmarkList, DevspaceCliError>;
    readonly readSkillGuide: () => Effect.Effect<string, DevspaceCliError>;
  }
>()("t3/devspace/DevspaceCli") {}

const decodeDevspaceJson = <S extends Schema.Codec<unknown, unknown, never, never>>(
  raw: string,
  schema: S,
  input: {
    readonly operation: string;
    readonly command: string;
    readonly cwd: string;
  },
): Effect.Effect<S["Type"], DevspaceCliDecodeError, S["DecodingServices"]> =>
  Schema.decodeEffect(Schema.fromJsonString(schema))(raw).pipe(
    Effect.mapError(
      (cause) =>
        new DevspaceCliDecodeError({
          ...input,
          outputLength: raw.length,
          cause,
        }),
    ),
  );

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const vcsProcess = yield* VcsProcess.VcsProcess;
  const command = resolveDevspaceCommand();
  let skillGuideCache: string | undefined;

  const run = Effect.fn("DevspaceCli.run")(function* (input: {
    readonly operation: string;
    readonly args: ReadonlyArray<string>;
    readonly cwd: string;
  }) {
    return yield* vcsProcess
      .run({
        operation: input.operation,
        command,
        args: input.args,
        cwd: input.cwd,
      })
      .pipe(
        Effect.mapError((error: VcsError) =>
          error._tag === "VcsProcessSpawnError"
            ? new DevspaceCliUnavailableError({
                operation: input.operation,
                command,
                cwd: input.cwd,
                cause: error.cause,
              })
            : error,
        ),
      );
  });

  const runJson = <S extends Schema.Codec<unknown, unknown, never, never>>(
    input: {
      readonly operation: string;
      readonly args: ReadonlyArray<string>;
      readonly cwd: string;
    },
    schema: S,
  ) =>
    run(input).pipe(
      Effect.map((result) => result.stdout.trim()),
      Effect.flatMap((stdout) =>
        decodeDevspaceJson(stdout, schema, {
          operation: input.operation,
          command,
          cwd: input.cwd,
        }),
      ),
    );

  return DevspaceCli.of({
    listRepos: () =>
      runJson(
        {
          operation: "DevspaceCli.listRepos",
          args: ["repo", "list", "--json"],
          cwd: config.cwd,
        },
        DevspaceRepositoryList,
      ),
    addCheckout: (input) =>
      runJson(
        {
          operation: "DevspaceCli.addCheckout",
          args: ["add", input.repo, "-r", input.rev, input.path, "--json"],
          cwd: config.cwd,
        },
        DevspaceCheckoutInfo,
      ),
    removeCheckout: (input) =>
      run({
        operation: "DevspaceCli.removeCheckout",
        args: ["remove", "-R", input.path],
        cwd: config.cwd,
      }).pipe(Effect.asVoid),
    info: (input) =>
      runJson(
        {
          operation: "DevspaceCli.info",
          args: ["info", "--json"],
          cwd: input.cwd,
        },
        DevspaceCheckoutInfo,
      ),
    listWorkspaces: (input) =>
      runJson(
        {
          operation: "DevspaceCli.listWorkspaces",
          args: ["list", "-R", input.repo, "--json"],
          cwd: config.cwd,
        },
        DevspaceWorkspaceList,
      ),
    listBookmarks: (input) =>
      run({
        operation: "DevspaceCli.listBookmarks",
        // Skip remote-tracking rows (diverged bookmarks render one row per
        // remote) and locally-deleted bookmarks, which have no local row.
        args: ["-R", input.repo, "bookmark", "list", "-T", 'if(remote, "", name ++ "\\n")'],
        cwd: config.cwd,
      }).pipe(
        Effect.map((result) => result.stdout),
        Effect.flatMap((stdout) =>
          Schema.decodeUnknownEffect(DevspaceBookmarkList)(
            stdout
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line.length > 0),
          ).pipe(
            Effect.mapError(
              (cause) =>
                new DevspaceCliDecodeError({
                  operation: "DevspaceCli.listBookmarks",
                  command,
                  cwd: config.cwd,
                  outputLength: stdout.length,
                  cause,
                }),
            ),
          ),
        ),
      ),
    readSkillGuide: () =>
      skillGuideCache !== undefined
        ? Effect.succeed(skillGuideCache)
        : run({
            operation: "DevspaceCli.readSkillGuide",
            args: ["skill"],
            cwd: config.cwd,
          }).pipe(
            Effect.map((result) => {
              skillGuideCache = result.stdout.trim();
              return skillGuideCache;
            }),
          ),
  });
});

export const layer = Layer.effect(DevspaceCli, make);
