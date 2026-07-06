# Devspace Mode (fork)

This fork integrates [Devspace](https://github.com/tomrford/devspace) — a jj-native workspace sync system — so T3 threads work in disposable, server-synced jj checkouts instead of git worktrees. Everything below is fork-specific; upstream knows nothing about it.

## How it works

- Devspace repos registered on the devspace server materialize as project records at startup (`ds repo list` via `DevspaceCli`, `apps/server/src/devspace/`). The sidebar shows them in a Devspaces section; a project whose repo is missing from the registry is dimmed with a "Missing" badge.
- The first message on a draft devspace thread runs `ds add` into `<base-dir>/devspaces/<repo>/<thread-id>`. The base revision comes from the toolbar selector: `trunk()` by default, or a bookmark, a `workspace@` head, or a free-text change ID/revset (resolved server-side by `ds add -r`; refs served by the `devspace.refs.list` WS method). Always a fresh checkout.
- Deleting or archiving a thread removes its checkout when no other live thread shares it (`ThreadDeletionReactor` + `checkoutCleanup.ts`). Archived threads are non-messageable while archived; un-archiving a cleaned thread leaves a dangling `worktreePath` (tracked in `docs/project/todo.md`).
- `DevspaceVcsDriver` (`apps/server/src/vcs/`) registers under the `jj` driver kind and shells `ds` for every operation — devspace checkouts have a devspace commit backend that plain `jj` cannot open, and their `.git` is a read-only Nix-compat shim that must not be claimed by git detection (detection probes `ds root` before git).
- Codex and Claude sessions for devspace-backed projects append a Devspace checkout briefing plus the cached `ds skill` guide to their provider instructions.
- `serve --no-auth` (or `T3CODE_NO_AUTH=1`) disables pairing entirely; acceptable only on the private tailnet.

## Operating it

- Servers run from source, but `serve` ships the prebuilt web bundle from `apps/web/dist`. UI changes are invisible until `pnpm vp run --filter @t3tools/web build` regenerates it — rebuild before bouncing a server, and confirm by grepping the served `assets/index-*.js` for a new string.
- `ds` must be reachable: set `DEVSPACE_BIN` (or have `ds` on PATH) when launching, or devspace reconciliation silently skips and the Devspaces section is empty. Reconciliation runs only at startup.
- Verify: `pnpm vp run --filter t3 --filter @t3tools/web typecheck`, scoped tests via `pnpm vp run --filter t3 test <package-relative-path>`, `pnpm vp check` before handoff.
- This checkout has no usable git: run VCS operations through `ds` (`ds skill` prints the guide). Publishing goes through bookmarks and forwarded `ds git push`.

## Open fork work

Tracked in `docs/project/todo.md` (devspace items) — notably the selector's edit mode (blocked on `ds add --edit` in the devspace repo), the unarchive dangling-checkout guard, and de-git-ifying the generic `vcs.*` RPC routes so the jj driver kind can serve refs/status to the UI.
