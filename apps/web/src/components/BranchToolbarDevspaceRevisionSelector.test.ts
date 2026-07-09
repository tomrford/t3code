import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_DEVSPACE_REV,
  resolveDevspaceRevisionTriggerLabel,
} from "./BranchToolbarDevspaceRevisionSelector";

describe("resolveDevspaceRevisionTriggerLabel", () => {
  it("makes the default new-change mode explicit", () => {
    expect(resolveDevspaceRevisionTriggerLabel(DEFAULT_DEVSPACE_REV, false)).toBe("New from trunk");
  });

  it("keeps edit mode visible alongside the selected revision", () => {
    expect(resolveDevspaceRevisionTriggerLabel("macmini@", true)).toBe("Edit macmini@");
  });
});
