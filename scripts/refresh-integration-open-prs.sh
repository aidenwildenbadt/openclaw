#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Refusing to run with a dirty worktree. Commit or stash changes first." >&2
  exit 1
fi

ORIGINAL_BRANCH="$(git branch --show-current)"
INTEGRATION_BRANCH="integration/open-prs"
PR_BRANCHES=(
  "codex/source-cutover-with-local-patches"
  "codex/last-two-message-reliability-fixes"
  "fix/gateway-agents-create-readiness-upstream"
  "codex/bluebubbles-webhook-replay-gating"
)

echo "Fetching upstream, fork, and PR branches..."
git fetch origin main
git fetch aiden "${INTEGRATION_BRANCH}:${INTEGRATION_BRANCH}" || true
for branch in "${PR_BRANCHES[@]}"; do
  git fetch aiden "${branch}:${branch}"
done

git switch "${INTEGRATION_BRANCH}" >/dev/null
git reset --hard origin/main >/dev/null

for branch in "${PR_BRANCHES[@]}"; do
  echo "Merging ${branch}..."
  git merge --no-ff --no-edit "${branch}"
done

git push aiden "${INTEGRATION_BRANCH}:${INTEGRATION_BRANCH}"

if [[ -n "${ORIGINAL_BRANCH}" && "${ORIGINAL_BRANCH}" != "${INTEGRATION_BRANCH}" ]]; then
  git switch "${ORIGINAL_BRANCH}" >/dev/null
fi

echo "Refreshed ${INTEGRATION_BRANCH} from origin/main and pushed to aiden."
