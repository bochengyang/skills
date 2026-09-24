---
name: hunkboard-publish
description: Show the current branch's changes as a pull-request-style review page the user opens in a browser, on this machine or on a phone. Use when the user wants to see or review the diff outside the editor, or says "hunkboard" or "publish the board".
---

# Publish a hunkboard

The board shows every change on this branch — commits since it left the default branch, plus
uncommitted and untracked files — side by side or inline, and lets the user comment on lines.
It contains the full text of every changed file, so do not publish anything you would not put
in a pull request.

## Get the tool

The skill drives two small shell scripts, `hunkboard-publish` and `hunkboard-push`, and a
viewer page. Use the first of these that exists as `<bin>`:

1. `$HUNKBOARD_BIN`, if set;
2. the directory holding `hunkboard-publish` on `PATH`;
3. `$CLAUDE_PLUGIN_ROOT/bin`, if set (the Claude Code plugin ships the scripts);
4. otherwise fetch it yourself: `git clone --depth 1 https://github.com/bochengyang/skills
   ~/.cache/hunkboard/tool` (or `git -C ~/.cache/hunkboard/tool pull` if it is already there),
   and use `~/.cache/hunkboard/tool/plugins/hunkboard/bin`.

The viewer is `<bin>/../dist/viewer.html`; if it is missing, run `sh <bin>/build` (POSIX sh,
no Node). The scripts need `git` and `jq`; if `jq` is missing, tell the user how to install it
for their system rather than installing it yourself.

Run everything from inside the repository. In the paths below, `<branch>` has `/` replaced
by `-`.

## With a board server

When `HUNKBOARD_REMOTE` is set, the user has a server that keeps the review between sessions
and saves comments from any device.

1. `<bin>/hunkboard-publish --out ~/.cache/hunkboard/<repo>/<branch>`
2. `<bin>/hunkboard-push --from ~/.cache/hunkboard/<repo>/<branch> --viewer <viewer.html>`
   (`HUNKBOARD_REMOTE` and `HUNKBOARD_ROOT` tell it where to go).
3. Give the user `$HUNKBOARD_URL/<repo>/<branch>/`. If `HUNKBOARD_URL` is not set, ask for it.

Do not create `resolutions.json` here; the hunkboard-comments skill owns it.

## Without one

1. Make a temporary directory outside the repository, copy the viewer into it, and run
   `<bin>/hunkboard-publish --out <dir>/<repo>/<branch>`.
2. Serve that directory over HTTP with any static file server the machine already has, in the
   background.
3. Give the user `http://<host>:<port>/viewer.html?ns=<repo>/<branch>`. If they may open it
   from another device, listen on all interfaces and give an address that device can reach;
   the page has no login, so say so.
4. Tell the user that comments stay in their browser: when they are done, press **Copy
   prompt** and paste the text back here.

Keep the directory and the server running for the rest of the session and republish into
the same place, so the page only needs a reload.
