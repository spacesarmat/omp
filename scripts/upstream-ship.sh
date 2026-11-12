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
: "${GITHUB_REPOSITORY:?}"
: "${GH_TOKEN:?}"

node scripts/upstream-gate.mjs allow "$BRANCH"

deadline=$((SECONDS + 45 * 60))
verdict="wait"
while [ "$SECONDS" -lt "$deadline" ]; do
  set +e
  json=$(gh pr checks "$PR" --repo "$GITHUB_REPOSITORY" --json name,state 2>/dev/null)
  set -e
  if [ -z "${json:-}" ]; then
    json='[]'
  fi
  verdict=$(printf '%s' "$json" | node scripts/upstream-gate.mjs checks)
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

# Required checks, when main has them, hold this until they are green.
# When main has none, the pull request is merged now, and only because the
# checks above already passed.
gh pr merge "$PR" --repo "$GITHUB_REPOSITORY" --squash --auto \
  || echo "auto-merge was not accepted, merging directly"
state=$(gh pr view "$PR" --repo "$GITHUB_REPOSITORY" --json state --jq .state)
if [ "$state" = "OPEN" ]; then
  gh pr merge "$PR" --repo "$GITHUB_REPOSITORY" --squash
fi

for _ in 1 2 3 4 5 6 7 8 9 10; do
  state=$(gh pr view "$PR" --repo "$GITHUB_REPOSITORY" --json state --jq .state)
  [ "$state" = "MERGED" ] && break
  sleep 3
done
if [ "$state" != "MERGED" ]; then
  echo "::error::Pull request $PR did not merge"
  exit 1
fi

merge=$(gh pr view "$PR" --repo "$GITHUB_REPOSITORY" --json mergeCommit --jq .mergeCommit.oid)
ver=$(gh api "repos/${GITHUB_REPOSITORY}/contents/package.json?ref=${merge}" --jq .content | base64 -d | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>process.stdout.write(JSON.parse(s).version))')
git fetch --no-tags origin "$merge"
git push origin "${merge}:refs/tags/v${ver}"
gh workflow run release.yml --repo "$GITHUB_REPOSITORY" --ref "v${ver}" \
  -f "tag=v${ver}" -f publish=true -f "notice=${NOTICE}"
echo "Release v${ver} started for ${NOTICE}"
