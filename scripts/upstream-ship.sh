#!/usr/bin/env bash
# After the update pull request exists and CI has been started: wait until every
# check is green, squash-merge only a chore/torrserver-* or chore/player2160-*
# branch, tag the merge, and start Release. A failed check does not merge.
# Env: PR, BRANCH, SHA, NOTICE, GITHUB_REPOSITORY, GH_TOKEN.
set -euo pipefail

: "${PR:?}"
: "${BRANCH:?}"
: "${SHA:?}"
: "${NOTICE:?}"
: "${EXPECTED:?}"
: "${GITHUB_REPOSITORY:?}"
: "${GH_TOKEN:?}"

node scripts/upstream-gate.mjs allow "$BRANCH"

deadline=$((SECONDS + 45 * 60))
verdict="wait"
while [ "$SECONDS" -lt "$deadline" ]; do
  set +e
  json=$(gh run list --repo "$GITHUB_REPOSITORY" --commit "$SHA" --json name,conclusion,status,headSha 2>/dev/null)
  set -e
  if [ -z "${json:-}" ]; then
    json='[]'
  fi
  verdict=$(printf '%s' "$json" | node scripts/upstream-gate.mjs runs)
  case "$verdict" in
    pass) break ;;
    fail)
      echo "::error::Checks failed for $BRANCH. Not merging and not releasing."
      exit 1
      ;;
    wait) sleep 30 ;;
    *) echo "::error::Bad checks verdict: $verdict"; exit 1 ;;
  esac
done
if [ "$verdict" != "pass" ]; then
  echo "::error::Checks did not pass within 45 minutes. Not merging and not releasing."
  exit 1
fi

head=$(gh pr view "$PR" --repo "$GITHUB_REPOSITORY" --json headRefOid --jq .headRefOid)
if [ "$head" != "$SHA" ]; then
  echo "::error::Pull request head moved ($head), refusing to merge $SHA"
  exit 1
fi

# Required checks, when main has them, hold auto-merge until they are green.
# The direct merge runs only when auto-merge itself is unavailable. Both commands
# refuse a head that is no longer the commit whose checks passed.
set +e
gh pr merge "$PR" --repo "$GITHUB_REPOSITORY" --squash --auto --match-head-commit "$SHA"
auto_code=$?
set -e
if [ "$auto_code" -eq 0 ]; then
  echo "auto-merge enabled, waiting until the pull request merges"
  merge_deadline=$((SECONDS + 30 * 60))
  state=$(gh pr view "$PR" --repo "$GITHUB_REPOSITORY" --json state --jq .state)
  while [ "$state" != "MERGED" ] && [ "$SECONDS" -lt "$merge_deadline" ]; do
    head=$(gh pr view "$PR" --repo "$GITHUB_REPOSITORY" --json headRefOid --jq .headRefOid)
    if [ "$head" != "$SHA" ]; then
      gh pr merge "$PR" --repo "$GITHUB_REPOSITORY" --disable-auto || true
      echo "::error::Pull request head moved ($head), auto-merge disabled"
      exit 1
    fi
    sleep 15
    state=$(gh pr view "$PR" --repo "$GITHUB_REPOSITORY" --json state --jq .state)
  done
  if [ "$state" != "MERGED" ]; then
    gh pr merge "$PR" --repo "$GITHUB_REPOSITORY" --disable-auto || true
    echo "::error::Auto-merge did not finish. It was disabled so a later merge cannot skip the release."
    exit 1
  fi
else
  echo "auto-merge was not accepted, merging this commit directly"
  head=$(gh pr view "$PR" --repo "$GITHUB_REPOSITORY" --json headRefOid --jq .headRefOid)
  if [ "$head" != "$SHA" ]; then
    echo "::error::Pull request head moved ($head), refusing to merge $SHA"
    exit 1
  fi
  gh pr merge "$PR" --repo "$GITHUB_REPOSITORY" --squash --match-head-commit "$SHA"
fi

merge=$(gh pr view "$PR" --repo "$GITHUB_REPOSITORY" --json mergeCommit --jq .mergeCommit.oid)
ver=$(gh api "repos/${GITHUB_REPOSITORY}/contents/package.json?ref=${merge}" --jq .content | base64 -d | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>process.stdout.write(JSON.parse(s).version))')
git fetch --no-tags origin "$merge"
git push origin "${merge}:refs/tags/v${ver}"
gh workflow run release.yml --repo "$GITHUB_REPOSITORY" --ref "v${ver}" \
  -f "tag=v${ver}" -f publish=true -f "notice=${NOTICE}"
echo "Release v${ver} started for ${NOTICE}"
