# hunkboard

Static, agent-neutral, PR-style diff review for a working tree that has not been committed yet.

Your coding agent edits files. `hunkboard-publish` turns the working tree into one `diff.json`.
You push that file to any static web server, open the shared `viewer.html` on a phone, tablet
or laptop, read the changes GitHub-style (inline or side-by-side), and leave comments.
The comments land in `comments.json` next to the diff. Your agent reads them, fixes the code,
answers in `resolutions.json`, and publishes the next round.

No database, no application server, no account. One directory per repo and branch.

## How it works

```
Mac / dev box                       static web server               phone / tablet
─────────────                       ─────────────────               ──────────────
git working tree                    /viewer.html                    viewer.html
  │ hunkboard-publish                 /<repo>/<branch>/               │ renders diff.json
  ▼                                     diff.json         ◀────────── │ PUTs comments.json
diff.json ── scp/rsync ──────────▶      comments.json     ◀────────── │
                                        resolutions.json ◀── agent writes, then pushes
```

Three files, each with exactly one writer:

| File | Written by | Read by |
|---|---|---|
| `diff.json` | `hunkboard-publish` | viewer |
| `comments.json` | viewer (HTTP PUT) | agent, viewer |
| `resolutions.json` | agent | viewer |

Schemas live in [`schema/`](schema/).

## Requirements

- Locally: `git`, `jq`, `ssh`/`scp` (or any way to copy a file). No Node or Python at runtime.
- Remotely: any static file server. For in-page comment saving, the server must accept `PUT`
  on `comments.json` (nginx: `dav_methods PUT`, see [`examples/nginx/`](examples/nginx/)).
  Without PUT, the viewer still works: use **Copy prompt** and paste the text to your agent.
- Node 20+ only to run the test-suite. `bin/build` (POSIX sh) assembles `dist/viewer.html` without Node.

## Quick start

```sh
# 1. publish the current working tree (uncommitted + untracked changes vs HEAD)
bin/hunkboard-publish --out /tmp/board/myrepo/feat-x
# 2. copy the viewer and the data next to each other on any static server
scp dist/viewer.html  server:/srv/hunkboard/
scp /tmp/board/myrepo/feat-x/diff.json server:/srv/hunkboard/myrepo/feat-x/
# 3. open https://server/myrepo/feat-x/ on your phone
#    (nginx maps that URL to /viewer.html; on a plain file server use
#     https://server/viewer.html?ns=myrepo/feat-x instead)
```

Try it locally without a server:

```sh
npm run build
mkdir -p /tmp/board && cp dist/viewer.html /tmp/board/
bin/hunkboard-publish --out /tmp/board/demo/main
(cd /tmp/board && python3 -m http.server 8000)
# open http://localhost:8000/viewer.html?ns=demo/main
```

## Command reference

`bin/hunkboard-publish` — working tree → `diff.json`

| Flag | Default | Meaning |
|---|---|---|
| `--out DIR` | required | directory that receives `diff.json` (written atomically) |
| `--repo NAME` | basename of the git toplevel | namespace segment 1 |
| `--branch NAME` | current branch | namespace segment 2 (`/` becomes `-` when pushed) |
| `--base REV` | `HEAD` | revision to diff against |
| `--no-untracked` | off | leave untracked files out (by default they are included via a temporary index, honouring `.gitignore`) |
| `--max-file-bytes N` | `512000` | files larger than this keep their hunks but not their full contents |

Prints the absolute path of `diff.json`. Never touches the real index or working tree.

`bin/hunkboard-push` — copy a round to the server

| Flag | Default | Meaning |
|---|---|---|
| `--from DIR` | required | directory containing `diff.json` (and `resolutions.json` if the agent wrote one) |
| `--remote HOST` | `$HUNKBOARD_REMOTE` | ssh host or alias |
| `--root PATH` | `$HUNKBOARD_ROOT` | web root on the server |
| `--repo`, `--branch` | from `diff.json` | override the namespace |
| `--viewer FILE` | none | also upload the shared `viewer.html` to the root |
| `--dry-run` | off | print the `ssh`/`scp` commands instead of running them |

`comments.json` is never pushed: the server copy is the reviewer's, written by the viewer.

`bin/build` — assemble `dist/viewer.html` from `src/` and `vendor/` (POSIX sh, no dependencies).

## Viewer

Open `https://server/hunkboard/<repo>/<branch>/` (nginx example, any prefix works) or
`viewer.html?ns=<repo>/<branch>` on a plain static server. The overview shows every file's hunks side by side (inline on phones), with
word-level highlights, syntax colouring, expandable context and a per-file "viewed" state.
The sidebar is a dense directory tree: collapsible folders, one line per file, and a status
letter on the right (`M` modified, `A` added, `D` deleted, `R` renamed), the file's `+N −M`,
and a tick for files you have marked as viewed. Directory rows carry the totals underneath
them, and `Files` in the toolbar hides the sidebar when you want the full width for code. Pick a file to open it on its own as a whole-file diff, use
Previous / Next to walk the changes, and click the root to return to the overview. Deep links
carry the file in the URL hash (`#file=src%2Fapp.js`). Light and dark themes follow the
system. Tap a line number to comment, shift-tap another to comment on a range. Comments are saved with a `PUT`; when the
server refuses, they stay in the browser and **Copy prompt** hands them to your agent as text.

## Agent integration

The contract is the three JSON files. Any agent that can read and write files can take part:

1. Read `comments.json`. A thread is open until the reviewer resolves it in the viewer
   (`resolved` on the thread) or a resolution with status `resolved` or `wontfix` exists
   for it in `resolutions.json`.
2. Change the code.
3. Append to `resolutions.json` (`resolved`, `wontfix` with a note, or `needs-info` to ask back).
4. Re-run `hunkboard-publish` and push both files.

`examples/claude-code/` shows a Stop hook that publishes after every agent turn and a
slash command that drains open comments.

## Security

The board contains your source code. Always put it behind authentication and TLS, only allow
`PUT` on `comments.json`, and never expose the publisher's machine.

## Development

```sh
npm test          # node --test, fixtures are real git output in test/fixtures
sh bin/build      # concatenates src/ and vendor/ into dist/viewer.html (same as npm run build)
```

## License

MIT. Embedded third-party code is listed in [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md).
