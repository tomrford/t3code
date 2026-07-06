import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it, describe } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ChildProcessSpawner } from "effect/unstable/process";

import type { VcsProcessInput, VcsProcessOutput } from "./VcsProcess.ts";
import * as DevspaceVcsDriver from "./DevspaceVcsDriver.ts";
import * as VcsProcess from "./VcsProcess.ts";

const commandCalls = (calls: ReadonlyArray<VcsProcessInput>) =>
  calls.map((call) => [call.command].concat(call.args));

const processOutput = (stdout: string, exitCode = 0, stderr = ""): VcsProcessOutput => ({
  exitCode: ChildProcessSpawner.ExitCode(exitCode),
  stdout,
  stderr,
  stdoutTruncated: false,
  stderrTruncated: false,
});

describe("DevspaceVcsDriver", () => {
  it.effect("detects repository identity with ds root", () => {
    const calls: VcsProcessInput[] = [];

    return Effect.gen(function* () {
      const driver = yield* DevspaceVcsDriver.makeVcsDriverShape();
      const identity = yield* driver.detectRepository("/repo/src");

      assert.equal(identity?.kind, "jj");
      assert.equal(identity?.rootPath, "/repo");
      assert.equal(identity?.metadataPath, "/repo/.jj");
      assert.deepStrictEqual(commandCalls(calls), [["ds", "root"]]);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          NodeServices.layer,
          Layer.mock(VcsProcess.VcsProcess)({
            run: (input) =>
              Effect.sync(() => {
                calls.push(input);
                return processOutput("/repo\n");
              }),
          }),
        ),
      ),
    );
  });

  it.effect("lists workspace files through ds file list", () => {
    let observedInput: VcsProcessInput | null = null;

    return Effect.gen(function* () {
      const driver = yield* DevspaceVcsDriver.makeVcsDriverShape();
      const result = yield* driver.listWorkspaceFiles("/repo");

      assert.deepStrictEqual(result.paths, ["README.md", "src/index.ts"]);
      assert.equal(observedInput?.command, "ds");
      assert.deepStrictEqual(observedInput?.args, ["file", "list"]);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          NodeServices.layer,
          Layer.mock(VcsProcess.VcsProcess)({
            run: (input) =>
              Effect.sync(() => {
                observedInput = input;
                return processOutput("README.md\nsrc/index.ts\n");
              }),
          }),
        ),
      ),
    );
  });

  it.effect("reads local status through ds status", () => {
    const calls: VcsProcessInput[] = [];

    return Effect.gen(function* () {
      const driver = yield* DevspaceVcsDriver.makeVcsDriverShape();
      const localStatus = driver.localStatus;
      if (!localStatus) {
        throw new Error("expected DevspaceVcsDriver.localStatus");
      }
      const result = yield* localStatus({ cwd: "/repo" });

      assert.equal(result.isRepo, true);
      assert.equal(result.refName, "feature/demo");
      assert.equal(result.hasPrimaryRemote, true);
      assert.equal(result.hasWorkingTreeChanges, true);
      assert.deepStrictEqual(result.workingTree.files, [
        { path: "src/index.ts", insertions: 0, deletions: 0 },
        { path: "README.md", insertions: 0, deletions: 0 },
      ]);
      assert.deepStrictEqual(
        commandCalls(calls)
          .map((call) => call.join(" "))
          .toSorted(),
        [
          "ds git remote list",
          'ds log -r @ --no-graph -T bookmarks.map(|b| b.name()).join("\\n")',
          "ds status",
        ],
      );
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          NodeServices.layer,
          Layer.mock(VcsProcess.VcsProcess)({
            run: (input) =>
              Effect.sync(() => {
                calls.push(input);
                if (input.args[0] === "status") {
                  return processOutput("M src/index.ts\nA README.md\n");
                }
                if (input.args[0] === "log") {
                  return processOutput("feature/demo\n");
                }
                if (input.args.join(" ") === "git remote list") {
                  return processOutput("origin git@example.com:repo.git\n");
                }
                return processOutput("");
              }),
          }),
        ),
      ),
    );
  });

  it.effect("lists refs through ds bookmark list", () => {
    const calls: VcsProcessInput[] = [];

    return Effect.gen(function* () {
      const driver = yield* DevspaceVcsDriver.makeVcsDriverShape();
      const listRefs = driver.listRefs;
      if (!listRefs) {
        throw new Error("expected DevspaceVcsDriver.listRefs");
      }
      const result = yield* listRefs({ cwd: "/repo", query: "feature" });

      assert.equal(result.isRepo, true);
      assert.equal(result.hasPrimaryRemote, true);
      assert.equal(result.totalCount, 1);
      assert.deepStrictEqual(result.refs, [
        {
          name: "feature/demo",
          current: true,
          isDefault: false,
          worktreePath: null,
        },
      ]);
      assert.deepStrictEqual(
        commandCalls(calls)
          .map((call) => call.join(" "))
          .toSorted(),
        [
          "ds bookmark list",
          "ds git remote list",
          'ds log -r @ --no-graph -T bookmarks.map(|b| b.name()).join("\\n")',
        ],
      );
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          NodeServices.layer,
          Layer.mock(VcsProcess.VcsProcess)({
            run: (input) =>
              Effect.sync(() => {
                calls.push(input);
                if (input.args[0] === "bookmark") {
                  return processOutput("main: qpvuntsm default\nfeature/demo: zzzzzzzz work\n");
                }
                if (input.args[0] === "log") {
                  return processOutput("feature/demo\n");
                }
                if (input.args.join(" ") === "git remote list") {
                  return processOutput("origin git@example.com:repo.git\n");
                }
                return processOutput("");
              }),
          }),
        ),
      ),
    );
  });

  it.effect("uses a synthetic git dir for the isolated ignore fallback", () => {
    const calls: VcsProcessInput[] = [];

    return Effect.gen(function* () {
      const driver = yield* DevspaceVcsDriver.makeVcsDriverShape();
      const result = yield* driver.filterIgnoredPaths("/repo", [
        "keep.ts",
        "debug.log",
        "src/index.ts",
      ]);

      assert.deepStrictEqual(result, ["keep.ts", "src/index.ts"]);
      assert.equal(calls[0]?.command, "git");
      assert.deepStrictEqual(calls[0]?.args.slice(-2), ["init", "--bare"]);
      assert.equal(calls[1]?.command, "git");
      assert.deepStrictEqual(calls[1]?.args.slice(-6), [
        "--work-tree",
        "/repo",
        "check-ignore",
        "--no-index",
        "-z",
        "--stdin",
      ]);
      assert.notEqual(calls[1]?.args[1], "/repo/.git");
      assert.equal(calls[1]?.stdin, "keep.ts\0debug.log\0src/index.ts\0");
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          NodeServices.layer,
          Layer.mock(VcsProcess.VcsProcess)({
            run: (input) =>
              Effect.sync(() => {
                calls.push(input);
                if (input.command === "git" && input.args.includes("check-ignore")) {
                  return processOutput("debug.log\0");
                }
                return processOutput("");
              }),
          }),
        ),
      ),
    );
  });

  it.effect("forwards execute env to ds", () => {
    let observedInput: VcsProcessInput | null = null;

    return Effect.gen(function* () {
      const driver = yield* DevspaceVcsDriver.makeVcsDriverShape();

      yield* driver.execute({
        operation: "DevspaceVcsDriver.test.env",
        cwd: "/repo",
        args: ["status"],
        env: {
          JJ_CONFIG: "/tmp/t3-jj-config.toml",
        },
      });

      assert.equal(observedInput?.command, "ds");
      assert.deepStrictEqual(observedInput?.args, ["status"]);
      assert.deepStrictEqual(observedInput?.env, {
        JJ_CONFIG: "/tmp/t3-jj-config.toml",
      });
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          NodeServices.layer,
          Layer.mock(VcsProcess.VcsProcess)({
            run: (input) =>
              Effect.sync(() => {
                observedInput = input;
                return processOutput("");
              }),
          }),
        ),
      ),
    );
  });
});
