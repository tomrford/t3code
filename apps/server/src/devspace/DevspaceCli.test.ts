import { describe, expect, it } from "vite-plus/test";

import { buildDevspaceAddCheckoutArgs } from "./DevspaceCli.ts";

describe("buildDevspaceAddCheckoutArgs", () => {
  it("creates a fresh child by default", () => {
    expect(
      buildDevspaceAddCheckoutArgs({
        repo: "owner/repo",
        rev: "trunk()",
        edit: false,
        path: "/tmp/checkout",
      }),
    ).toEqual(["add", "owner/repo", "-r", "trunk()", "/tmp/checkout", "--json"]);
  });

  it("passes --edit when adopting the selected revision", () => {
    expect(
      buildDevspaceAddCheckoutArgs({
        repo: "owner/repo",
        rev: "macmini@",
        edit: true,
        path: "/tmp/checkout",
      }),
    ).toEqual(["add", "owner/repo", "-r", "macmini@", "--edit", "/tmp/checkout", "--json"]);
  });
});
