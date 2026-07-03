import { createDevspaceEnvironmentAtoms } from "@t3tools/client-runtime/state/devspace";

import { connectionAtomRuntime } from "../connection/runtime";

export const devspaceEnvironment = createDevspaceEnvironmentAtoms(connectionAtomRuntime);
