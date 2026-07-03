import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import { createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

export function createDevspaceEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    repos: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:devspace:repos",
      tag: WS_METHODS.devspaceReposList,
      staleTimeMs: 5_000,
      refreshIntervalMs: 15_000,
    }),
  };
}
