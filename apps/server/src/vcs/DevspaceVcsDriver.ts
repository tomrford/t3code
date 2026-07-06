import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import {
  type VcsListRefsInput,
  VcsProcessExitError,
  VcsUnsupportedOperationError,
} from "@t3tools/contracts";
import { resolveDevspaceCommand } from "../devspace/DevspaceCli.ts";
import * as VcsDriver from "./VcsDriver.ts";
import * as VcsProcess from "./VcsProcess.ts";

const WORKSPACE_FILES_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const CHECK_IGNORE_MAX_STDIN_BYTES = 256 * 1024;
const STATUS_MAX_OUTPUT_BYTES = 1024 * 1024;
const BOOKMARKS_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const CURRENT_BOOKMARK_TEMPLATE = 'bookmarks.map(|b| b.name()).join("\\n")';

const nowFreshness = Effect.fn("DevspaceVcsDriver.nowFreshness")(function* () {
  const now = yield* DateTime.now;
  return {
    source: "live-local" as const,
    observedAt: now,
    expiresAt: Option.none(),
  };
});

function splitNullSeparatedPaths(input: string, truncated: boolean): string[] {
  const parts = input.split("\0");
  if (parts.length === 0) return [];

  if (truncated && parts[parts.length - 1]?.length) {
    parts.pop();
  }

  return parts.filter((value) => value.length > 0);
}

function splitLineSeparatedPaths(input: string, truncated: boolean): string[] {
  const lines = input.split(/\r?\n/g);
  if (truncated) {
    // Truncated output ends with the "[truncated]" marker line, preceded by
    // a blank line and a partial final path — drop all three.
    lines.pop();
    while (lines.length > 0 && lines[lines.length - 1]?.trim().length === 0) {
      lines.pop();
    }
    lines.pop();
  }

  return lines.map((line) => line.trim()).filter((line) => line.length > 0);
}

function parseDevspaceRemoteList(output: string): Array<{ name: string; url: string }> {
  return output
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .flatMap((line) => {
      if (line.length === 0) {
        return [];
      }

      const [name, ...urlParts] = line.split(/\s+/g);
      const url = urlParts.join(" ").trim();
      return name && url ? [{ name, url }] : [];
    });
}

function parseDevspaceStatusFiles(output: string) {
  return output
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .flatMap((line) => {
      const match = /^([A-Z?!]{1,2})\s+(.+)$/.exec(line);
      if (!match) {
        return [];
      }
      const path = match[2]?.trim();
      return path ? [{ path, insertions: 0, deletions: 0 }] : [];
    });
}

function parseCurrentBookmarks(output: string): string[] {
  return output
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function parseBookmarkLine(line: string): { name: string; current: boolean } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const current = trimmed.startsWith("*");
  const normalized = current ? trimmed.slice(1).trim() : trimmed;
  const colonIndex = normalized.indexOf(":");
  const name = (colonIndex === -1 ? normalized.split(/\s+/g)[0] : normalized.slice(0, colonIndex))
    ?.trim()
    .replace(/\*$/g, "");
  return name ? { name, current } : null;
}

function filterRefsForListQuery(
  refs: ReadonlyArray<{
    readonly name: string;
    readonly isRemote?: boolean;
    readonly remoteName?: string;
    readonly current: boolean;
    readonly isDefault: boolean;
    readonly worktreePath: string | null;
  }>,
  input: VcsListRefsInput,
) {
  const query = input.query?.toLowerCase();
  const filteredByKind =
    input.refKind === "local"
      ? refs.filter((ref) => !ref.isRemote)
      : input.refKind === "remote"
        ? refs.filter((ref) => ref.isRemote)
        : refs;
  const filtered = query
    ? filteredByKind.filter((ref) => ref.name.toLowerCase().includes(query))
    : filteredByKind;
  const cursor = input.cursor ?? 0;
  const limit = input.limit ?? 50;
  const page = filtered.slice(cursor, cursor + limit);
  const nextCursor = cursor + page.length < filtered.length ? cursor + page.length : null;
  return {
    refs: page,
    nextCursor,
    totalCount: filtered.length,
  };
}

function remoteNameForBookmark(name: string): string | undefined {
  const atIndex = name.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === name.length - 1) {
    return undefined;
  }
  return name.slice(atIndex + 1);
}

function chunkPathsForCheckIgnore(relativePaths: ReadonlyArray<string>): string[][] {
  const chunks: string[][] = [];
  let chunk: string[] = [];
  let chunkBytes = 0;

  for (const relativePath of relativePaths) {
    const relativePathBytes = Buffer.byteLength(relativePath) + 1;
    if (chunk.length > 0 && chunkBytes + relativePathBytes > CHECK_IGNORE_MAX_STDIN_BYTES) {
      chunks.push(chunk);
      chunk = [];
      chunkBytes = 0;
    }

    chunk.push(relativePath);
    chunkBytes += relativePathBytes;

    if (chunkBytes >= CHECK_IGNORE_MAX_STDIN_BYTES) {
      chunks.push(chunk);
      chunk = [];
      chunkBytes = 0;
    }
  }

  if (chunk.length > 0) {
    chunks.push(chunk);
  }

  return chunks;
}

const runCommand = (
  process: VcsProcess.VcsProcess["Service"],
  command: string,
  operation: string,
  cwd: string,
  args: ReadonlyArray<string>,
  options?: {
    readonly stdin?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly allowNonZeroExit?: boolean;
    readonly timeoutMs?: number;
    readonly maxOutputBytes?: number;
    readonly appendTruncationMarker?: boolean;
  },
) =>
  process.run({
    operation,
    command,
    args,
    cwd,
    ...(options?.stdin !== undefined ? { stdin: options.stdin } : {}),
    ...(options?.env !== undefined ? { env: options.env } : {}),
    ...(options?.allowNonZeroExit !== undefined
      ? { allowNonZeroExit: options.allowNonZeroExit }
      : {}),
    ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options?.maxOutputBytes !== undefined ? { maxOutputBytes: options.maxOutputBytes } : {}),
    ...(options?.appendTruncationMarker !== undefined
      ? { appendTruncationMarker: options.appendTruncationMarker }
      : {}),
  });

const dsCommand = (
  process: VcsProcess.VcsProcess["Service"],
  command: string,
  operation: string,
  cwd: string,
  args: ReadonlyArray<string>,
  options?: Parameters<typeof runCommand>[5],
) => runCommand(process, command, operation, cwd, args, options);

const gitCommand = (
  process: VcsProcess.VcsProcess["Service"],
  operation: string,
  cwd: string,
  args: ReadonlyArray<string>,
  options?: Parameters<typeof runCommand>[5],
) => runCommand(process, "git", operation, cwd, args, options);

const makeScopedTempGitDir = (fileSystem: FileSystem.FileSystem, operation: string, cwd: string) =>
  fileSystem.makeTempDirectoryScoped({ prefix: "t3-jj-check-ignore-" }).pipe(
    Effect.mapError(
      (cause) =>
        new VcsProcessExitError({
          operation,
          command: "git check-ignore",
          cwd,
          exitCode: 0,
          detail: `failed to create temp git dir: ${String(cause)}`,
        }),
    ),
  );

export const makeVcsDriverShape = Effect.fn("makeDevspaceVcsDriverShape")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const vcsProcess = yield* VcsProcess.VcsProcess;
  const command = resolveDevspaceCommand();
  const capabilities = {
    kind: "jj" as const,
    supportsWorktrees: false,
    supportsBookmarks: true,
    supportsAtomicSnapshot: false,
    supportsPushDefaultRemote: false,
    ignoreClassifier: "git-compatible-fallback" as const,
  };

  const isInsideWorkTree: VcsDriver.VcsDriver["Service"]["isInsideWorkTree"] = (cwd) =>
    dsCommand(vcsProcess, command, "DevspaceVcsDriver.isInsideWorkTree", cwd, ["root"], {
      allowNonZeroExit: true,
      timeoutMs: 5_000,
      maxOutputBytes: 4_096,
    }).pipe(
      Effect.map((result) => result.exitCode === 0 && result.stdout.trim().length > 0),
      Effect.orElseSucceed(() => false),
    );

  const execute: VcsDriver.VcsDriver["Service"]["execute"] = (input) =>
    dsCommand(vcsProcess, command, input.operation, input.cwd, input.args, {
      ...(input.stdin !== undefined ? { stdin: input.stdin } : {}),
      ...(input.env !== undefined ? { env: input.env } : {}),
      ...(input.allowNonZeroExit !== undefined ? { allowNonZeroExit: input.allowNonZeroExit } : {}),
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      ...(input.maxOutputBytes !== undefined ? { maxOutputBytes: input.maxOutputBytes } : {}),
      ...(input.appendTruncationMarker !== undefined
        ? { appendTruncationMarker: input.appendTruncationMarker }
        : {}),
    });

  const detectRepository: VcsDriver.VcsDriver["Service"]["detectRepository"] = Effect.fn(
    "DevspaceVcsDriver.detectRepository",
  )(function* (cwd) {
    const root = yield* dsCommand(
      vcsProcess,
      command,
      "DevspaceVcsDriver.detectRepository.root",
      cwd,
      ["root"],
      {
        allowNonZeroExit: true,
        timeoutMs: 5_000,
        maxOutputBytes: 4_096,
      },
    ).pipe(Effect.orElseSucceed(() => null));
    if (!root || root.exitCode !== 0) {
      return null;
    }

    const rootPath = root.stdout.trim();
    if (rootPath.length === 0) {
      return null;
    }

    // `ds root` resolves through ancestors, so a plain git repo nested
    // inside a devspace checkout would otherwise be claimed as jj with the
    // ancestor's root. Walk up from cwd: reaching a `.jj` root first keeps
    // jj; finding a real git repo first (a `.git` gitdir file, or a `.git`
    // dir with `objects/` — the devspace shim is index-only) yields to git.
    let probe = cwd.replace(/[\\/]+$/g, "");
    while (probe.length > 0) {
      const hasJjMeta = yield* fileSystem
        .exists(`${probe}/.jj`)
        .pipe(Effect.orElseSucceed(() => false));
      if (hasJjMeta) {
        break;
      }
      const gitInfo = yield* fileSystem
        .stat(`${probe}/.git`)
        .pipe(Effect.orElseSucceed(() => null));
      if (gitInfo?.type === "File") {
        return null;
      }
      if (gitInfo?.type === "Directory") {
        const hasObjects = yield* fileSystem
          .exists(`${probe}/.git/objects`)
          .pipe(Effect.orElseSucceed(() => false));
        if (hasObjects) {
          return null;
        }
      }
      const slash = probe.lastIndexOf("/");
      if (slash <= 0) {
        break;
      }
      probe = probe.slice(0, slash);
    }

    return {
      kind: "jj" as const,
      rootPath,
      metadataPath: `${rootPath.replace(/[\\/]$/g, "")}/.jj`,
      freshness: yield* nowFreshness(),
    };
  });

  const listWorkspaceFiles: VcsDriver.VcsDriver["Service"]["listWorkspaceFiles"] = (cwd) =>
    dsCommand(vcsProcess, command, "DevspaceVcsDriver.listWorkspaceFiles", cwd, ["file", "list"], {
      allowNonZeroExit: true,
      timeoutMs: 20_000,
      maxOutputBytes: WORKSPACE_FILES_MAX_OUTPUT_BYTES,
      appendTruncationMarker: true,
    }).pipe(
      Effect.flatMap((result) =>
        result.exitCode === 0
          ? Effect.gen(function* () {
              return {
                paths: splitLineSeparatedPaths(result.stdout, result.stdoutTruncated),
                truncated: result.stdoutTruncated,
                freshness: yield* nowFreshness(),
              };
            })
          : Effect.fail(
              new VcsProcessExitError({
                operation: "DevspaceVcsDriver.listWorkspaceFiles",
                command: `${command} file list`,
                cwd,
                exitCode: result.exitCode,
                detail: result.stderr.trim() || "ds file list failed",
              }),
            ),
      ),
    );

  const listRemotes: VcsDriver.VcsDriver["Service"]["listRemotes"] = Effect.fn(
    "DevspaceVcsDriver.listRemotes",
  )(function* (cwd) {
    const result = yield* dsCommand(
      vcsProcess,
      command,
      "DevspaceVcsDriver.listRemotes",
      cwd,
      ["git", "remote", "list"],
      {
        allowNonZeroExit: true,
        timeoutMs: 5_000,
        maxOutputBytes: 64 * 1024,
      },
    );

    if (result.exitCode !== 0) {
      return {
        remotes: [],
        freshness: yield* nowFreshness(),
      };
    }

    return {
      remotes: parseDevspaceRemoteList(result.stdout).map((remote) => ({
        name: remote.name,
        url: remote.url,
        pushUrl: Option.none(),
        isPrimary: remote.name === "origin",
      })),
      freshness: yield* nowFreshness(),
    };
  });

  const readCurrentBookmarks = Effect.fn("DevspaceVcsDriver.readCurrentBookmarks")(function* (
    cwd: string,
  ) {
    const result = yield* dsCommand(
      vcsProcess,
      command,
      "DevspaceVcsDriver.readCurrentBookmarks",
      cwd,
      ["log", "-r", "@", "--no-graph", "-T", CURRENT_BOOKMARK_TEMPLATE],
      {
        allowNonZeroExit: true,
        timeoutMs: 5_000,
        maxOutputBytes: 64 * 1024,
      },
    );

    return result.exitCode === 0 ? parseCurrentBookmarks(result.stdout) : [];
  });

  const localStatus: VcsDriver.VcsDriver["Service"]["localStatus"] = Effect.fn(
    "DevspaceVcsDriver.localStatus",
  )(function* (input) {
    const [statusResult, currentBookmarks, remotes] = yield* Effect.all(
      [
        dsCommand(
          vcsProcess,
          command,
          "DevspaceVcsDriver.localStatus.status",
          input.cwd,
          ["status"],
          {
            allowNonZeroExit: true,
            timeoutMs: 10_000,
            maxOutputBytes: STATUS_MAX_OUTPUT_BYTES,
          },
        ),
        readCurrentBookmarks(input.cwd).pipe(Effect.orElseSucceed(() => [])),
        listRemotes(input.cwd).pipe(
          Effect.map((result) => result.remotes),
          Effect.orElseSucceed(() => []),
        ),
      ],
      { concurrency: "unbounded" },
    );

    if (statusResult.exitCode !== 0) {
      return yield* new VcsProcessExitError({
        operation: "DevspaceVcsDriver.localStatus",
        command: `${command} status`,
        cwd: input.cwd,
        exitCode: statusResult.exitCode,
        detail: statusResult.stderr.trim() || "ds status failed",
      });
    }

    const files = parseDevspaceStatusFiles(statusResult.stdout);
    const refName = currentBookmarks[0] ?? null;
    return {
      isRepo: true,
      hasPrimaryRemote: remotes.some((remote) => remote.name === "origin"),
      isDefaultRef: refName === "main" || refName === "master",
      refName,
      hasWorkingTreeChanges: files.length > 0,
      workingTree: {
        files,
        insertions: 0,
        deletions: 0,
      },
    };
  });

  const remoteStatus: VcsDriver.VcsDriver["Service"]["remoteStatus"] = () => Effect.succeed(null);

  const listRefs: VcsDriver.VcsDriver["Service"]["listRefs"] = Effect.fn(
    "DevspaceVcsDriver.listRefs",
  )(function* (input) {
    const [bookmarkResult, currentBookmarks, remotes] = yield* Effect.all(
      [
        dsCommand(
          vcsProcess,
          command,
          "DevspaceVcsDriver.listRefs.bookmarkList",
          input.cwd,
          ["bookmark", "list"],
          {
            allowNonZeroExit: true,
            timeoutMs: 10_000,
            maxOutputBytes: BOOKMARKS_MAX_OUTPUT_BYTES,
          },
        ),
        readCurrentBookmarks(input.cwd).pipe(Effect.orElseSucceed(() => [])),
        listRemotes(input.cwd).pipe(
          Effect.map((result) => result.remotes),
          Effect.orElseSucceed(() => []),
        ),
      ],
      { concurrency: "unbounded" },
    );

    if (bookmarkResult.exitCode !== 0) {
      return yield* new VcsProcessExitError({
        operation: "DevspaceVcsDriver.listRefs",
        command: `${command} bookmark list`,
        cwd: input.cwd,
        exitCode: bookmarkResult.exitCode,
        detail: bookmarkResult.stderr.trim() || "ds bookmark list failed",
      });
    }

    const currentBookmarkSet = new Set(currentBookmarks);
    const refs = bookmarkResult.stdout
      .split(/\r?\n/g)
      .flatMap((line) => {
        const parsed = parseBookmarkLine(line);
        if (!parsed) return [];
        const remoteName = remoteNameForBookmark(parsed.name);
        return [
          {
            name: parsed.name,
            ...(remoteName === undefined
              ? {}
              : {
                  isRemote: true,
                  remoteName,
                }),
            current: parsed.current || currentBookmarkSet.has(parsed.name),
            isDefault: parsed.name === "main" || parsed.name === "master",
            worktreePath: null,
          },
        ];
      })
      .toSorted((a, b) => {
        const aPriority = a.current ? 0 : a.isDefault ? 1 : 2;
        const bPriority = b.current ? 0 : b.isDefault ? 1 : 2;
        return aPriority === bPriority ? a.name.localeCompare(b.name) : aPriority - bPriority;
      });
    const paginated = filterRefsForListQuery(refs, input);

    return {
      refs: paginated.refs,
      isRepo: true,
      hasPrimaryRemote: remotes.some((remote) => remote.name === "origin"),
      nextCursor: paginated.nextCursor,
      totalCount: paginated.totalCount,
    };
  });

  const filterIgnoredPaths: VcsDriver.VcsDriver["Service"]["filterIgnoredPaths"] = Effect.fn(
    "DevspaceVcsDriver.filterIgnoredPaths",
  )(function* (cwd, relativePaths) {
    if (relativePaths.length === 0) {
      return relativePaths;
    }

    const operation = "DevspaceVcsDriver.filterIgnoredPaths";
    const ignoredPaths = new Set<string>();

    yield* Effect.scoped(
      Effect.gen(function* () {
        const gitDir = yield* makeScopedTempGitDir(fileSystem, operation, cwd);
        const initResult = yield* gitCommand(
          vcsProcess,
          operation,
          cwd,
          ["--git-dir", gitDir, "init", "--bare"],
          {
            allowNonZeroExit: true,
            timeoutMs: 10_000,
            maxOutputBytes: 64 * 1024,
          },
        );
        if (initResult.exitCode !== 0) {
          return yield* new VcsProcessExitError({
            operation,
            command: "git init --bare",
            cwd,
            exitCode: initResult.exitCode,
            detail: initResult.stderr.trim() || "git init --bare failed",
          });
        }

        for (const chunk of chunkPathsForCheckIgnore(relativePaths)) {
          const result = yield* gitCommand(
            vcsProcess,
            operation,
            cwd,
            [
              "--git-dir",
              gitDir,
              "--work-tree",
              cwd,
              "check-ignore",
              "--no-index",
              "-z",
              "--stdin",
            ],
            {
              stdin: `${chunk.join("\0")}\0`,
              allowNonZeroExit: true,
              timeoutMs: 20_000,
              maxOutputBytes: WORKSPACE_FILES_MAX_OUTPUT_BYTES,
              appendTruncationMarker: true,
            },
          );

          if (result.exitCode !== 0 && result.exitCode !== 1) {
            return yield* new VcsProcessExitError({
              operation,
              command: "git check-ignore",
              cwd,
              exitCode: result.exitCode,
              detail: result.stderr.trim() || "git check-ignore failed",
            });
          }

          for (const ignoredPath of splitNullSeparatedPaths(
            result.stdout,
            result.stdoutTruncated,
          )) {
            ignoredPaths.add(ignoredPath);
          }
        }
      }),
    );

    if (ignoredPaths.size === 0) {
      return relativePaths;
    }

    return relativePaths.filter((relativePath) => !ignoredPaths.has(relativePath));
  });

  const initRepository: VcsDriver.VcsDriver["Service"]["initRepository"] = (_input) =>
    Effect.fail(
      new VcsUnsupportedOperationError({
        operation: "DevspaceVcsDriver.initRepository",
        kind: "jj",
        detail: `Initializing devspace-backed Jujutsu repositories is not exposed through ${command}.`,
      }),
    );

  return {
    capabilities,
    execute,
    detectRepository,
    isInsideWorkTree,
    listWorkspaceFiles,
    listRemotes,
    filterIgnoredPaths,
    initRepository,
    localStatus,
    remoteStatus,
    listRefs,
  } satisfies VcsDriver.VcsDriver["Service"];
});

export const makeVcsDriver = Effect.gen(function* () {
  const driver = yield* makeVcsDriverShape();
  return VcsDriver.VcsDriver.of(driver);
});

export const vcsLayer = Layer.effect(VcsDriver.VcsDriver, makeVcsDriver);
