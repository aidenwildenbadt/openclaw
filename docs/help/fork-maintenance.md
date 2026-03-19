---
summary: "Personal fork workflow: keep main mirrored, keep open PRs on an integration branch"
read_when:
  - You maintain a personal fork alongside open upstream PRs
  - You want a repeatable way to sync your fork without mixing PR history into main
title: "Fork Maintenance"
---

# Fork Maintenance

This workflow keeps responsibilities separate:

- `origin/main` is the upstream source of truth.
- `aiden/main` mirrors `origin/main`.
- `integration/open-prs` is the combined branch for the current open PR stack.
- Individual PR branches stay isolated for review, CI, and feedback.

## Current branch roles

- `main`
  - Local branch that tracks `origin/main`.
  - Should stay clean so upstream sync stays trivial.
- `integration/open-prs`
  - Fork-only integration branch.
  - Combines the currently open PR branches on top of `origin/main`.

## Helper scripts

- `./scripts/sync-fork-main.sh`
  - Fetches upstream and force-updates `aiden/main` to match `origin/main`.
  - Refuses to run if the worktree is dirty.
- `./scripts/refresh-integration-open-prs.sh`
  - Fetches upstream and the tracked PR branches from `aiden`.
  - Rebuilds `integration/open-prs` from `origin/main`.
  - Merges the current PR branches in this order:
    - `codex/source-cutover-with-local-patches`
    - `codex/last-two-message-reliability-fixes`
    - `fix/gateway-agents-create-readiness-upstream`
    - `codex/bluebubbles-webhook-replay-gating`
  - Pushes the refreshed integration branch back to `aiden`.

## Recommended cadence

1. Run `./scripts/sync-fork-main.sh` when you want fork `main` to match upstream.
2. Run `./scripts/refresh-integration-open-prs.sh` when upstream moved or one of the PR branches changed.
3. Use `integration/open-prs` for combined testing and fork-only comparisons.

## Safety notes

- Both scripts refuse to run with uncommitted changes.
- `refresh-integration-open-prs.sh` intentionally rewrites the local `integration/open-prs` branch to start from `origin/main`.
- If one of the merges conflicts, resolve it on `integration/open-prs`, rerun tests, and push the branch when it is ready.
