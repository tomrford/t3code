import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { VcsError } from "./vcs.ts";

export const DevspaceRepository = Schema.Struct({
  name: TrimmedNonEmptyString,
  remotes: Schema.Record(TrimmedNonEmptyString, TrimmedNonEmptyString),
});
export type DevspaceRepository = typeof DevspaceRepository.Type;

export const DevspaceRepositoryList = Schema.Array(DevspaceRepository);
export type DevspaceRepositoryList = typeof DevspaceRepositoryList.Type;

export const DevspaceCheckoutInfo = Schema.Struct({
  root: TrimmedNonEmptyString,
  repo: TrimmedNonEmptyString,
  server: TrimmedNonEmptyString,
  workspace_id: TrimmedNonEmptyString,
});
export type DevspaceCheckoutInfo = typeof DevspaceCheckoutInfo.Type;

export const DevspaceWorkspace = Schema.Struct({
  name: TrimmedNonEmptyString,
  target: TrimmedNonEmptyString,
});
export type DevspaceWorkspace = typeof DevspaceWorkspace.Type;

export const DevspaceWorkspaceList = Schema.Array(DevspaceWorkspace);
export type DevspaceWorkspaceList = typeof DevspaceWorkspaceList.Type;

export const DevspaceReposListInput = Schema.Struct({});
export type DevspaceReposListInput = typeof DevspaceReposListInput.Type;

export const DevspaceReposListResult = Schema.Struct({
  repos: DevspaceRepositoryList,
});
export type DevspaceReposListResult = typeof DevspaceReposListResult.Type;

export class DevspaceCliUnavailableError extends Schema.TaggedErrorClass<DevspaceCliUnavailableError>()(
  "DevspaceCliUnavailableError",
  {
    operation: Schema.String,
    command: Schema.String,
    cwd: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Devspace CLI is unavailable for ${this.operation}: ${this.command}`;
  }
}

export class DevspaceCliDecodeError extends Schema.TaggedErrorClass<DevspaceCliDecodeError>()(
  "DevspaceCliDecodeError",
  {
    operation: Schema.String,
    command: Schema.String,
    cwd: Schema.String,
    outputLength: Schema.Number,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to decode Devspace CLI output for ${this.operation}: ${this.command}`;
  }
}

export const DevspaceCliError = Schema.Union([
  DevspaceCliUnavailableError,
  DevspaceCliDecodeError,
  VcsError,
]);
export type DevspaceCliError = typeof DevspaceCliError.Type;
