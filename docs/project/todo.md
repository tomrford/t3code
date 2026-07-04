# TODO

## Small things

- [ ] Submitting new messages should scroll to bottom
- [ ] Only show last 10 threads for a given project
- [ ] New projects should go on top
- [ ] Projects should be sorted by latest thread update
- [ ] Sidebar Devspaces section doesn't reliably reflect devspace add/remove — not worth fixing until the devspace integration goes deeper

## Bigger things

- [ ] Queueing messages
- [ ] Devspace selector "edit" mode — land inside the selected change instead of on a new child, via `ds add --edit`.
- [ ] Unarchiving a devspace thread whose checkout was cleaned leaves worktreePath dangling; the next turn fails at provider spawn. Needs a guard or re-bootstrap.
- [ ] Persistent (non-thread) devspace checkouts registered as ordinary projects render oddly — decide how a long-lived checkout should present in the UI.
- [ ] Ordinary projects don't detect that their directory is a devspace checkout; devspace awareness only exists for Devspaces-section projects.
