#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Refusing to run with a dirty worktree. Commit or stash changes first." >&2
  exit 1
fi

echo "Fetching upstream and fork remotes..."
git fetch origin main
git fetch aiden main || true

UPSTREAM_SHA="$(git rev-parse origin/main)"

echo "Force-updating aiden/main to match origin/main (${UPSTREAM_SHA})..."
git push --force-with-lease aiden origin/main:main

if git show-ref --verify --quiet refs/heads/main; then
  git branch --set-upstream-to=origin/main main >/dev/null 2>&1 || true
fi

echo "aiden/main now mirrors origin/main at ${UPSTREAM_SHA}."
