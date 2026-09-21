---
name: hunkboard-publish
description: Publish the current branch (commits since it left main, plus staged, unstaged and untracked changes) as a hunkboard review board and print the URL to open on a phone or tablet. Use when the user says "publish the board", "hunkboard", or wants to review the agent's changes outside the editor.
---

# hunkboard-publish

Requires `HUNKBOARD_REMOTE`, `HUNKBOARD_ROOT` and `HUNKBOARD_BIN` in the environment
(see ../README.md). Runs from the repository root.

1. Publish the working tree to a local staging directory named after repo and branch:

```sh
repo=$(basename "$(git rev-parse --show-toplevel)")
branch=$(git rev-parse --abbrev-ref HEAD | tr '/' '-')
out="$HOME/.cache/hunkboard/$repo/$branch"
mkdir -p "$out"
"$HUNKBOARD_BIN/hunkboard-publish" --out "$out"
```

2. If `$out/resolutions.json` does not exist yet, do not create it; the comments skill owns it.

3. Push the round, and the shared viewer with it (build it first if this checkout has no
   `dist/viewer.html`; the build is plain POSIX sh, no Node needed):

```sh
viewer="$HUNKBOARD_BIN/../dist/viewer.html"
[ -f "$viewer" ] || sh "$HUNKBOARD_BIN/build"
"$HUNKBOARD_BIN/hunkboard-push" --from "$out" --viewer "$viewer"
```

4. Tell the user the URL: `$HUNKBOARD_URL/<repo>/<branch>/`, where `HUNKBOARD_URL` is the
   public base including any prefix, e.g. `https://review.example.com/hunkboard` (ask once
   and remember it in memory). Mention the file count and +/- totals from
   `jq -r '.rawDiff' "$out/diff.json" | grep -cE '^\+[^+]'` style counts only if useful.

Never publish if the repository is not clean of secrets you would not put in a PR: the board
contains full file contents of every changed file.
