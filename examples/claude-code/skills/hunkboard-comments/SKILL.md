---
name: hunkboard-comments
description: Fetch the reviewer's open comment threads from the hunkboard for the current repo and branch, act on each one, record the outcome in resolutions.json and republish. Use when the user says "handle the board comments", "check hunkboard", or after they reviewed on their phone.
---

# hunkboard-comments

Requires the same environment as hunkboard-publish, plus the board URL (`HUNKBOARD_URL`,
e.g. `https://review.example.com`) and, if the board uses basic auth, a `~/.netrc` entry so
`curl -n` can read it.

1. Locate the namespace and fetch both documents from the board (a 404 means "none yet").
   `comments.json` is taken as-is: only the viewer writes it. `resolutions.json` is merged
   with the copy in `$out`: the local copy is a cache that may be gone (cleared, or this is
   another machine) and the board's copy may lack entries appended since the last push.
   Starting from an empty file would republish it empty and reopen every thread you
   already handled.

```sh
repo=$(basename "$(git rev-parse --show-toplevel)")
branch=$(git rev-parse --abbrev-ref HEAD | tr '/' '-')
out="$HOME/.cache/hunkboard/$repo/$branch"
mkdir -p "$out"
curl -nsf "$HUNKBOARD_URL/$repo/$branch/comments.json" -o "$out/comments.json" || echo '{"version":1,"updatedAt":"","threads":[]}' > "$out/comments.json"
curl -nsf "$HUNKBOARD_URL/$repo/$branch/resolutions.json" -o "$out/resolutions.remote.json" || echo '{"version":1,"updatedAt":"","resolutions":[]}' > "$out/resolutions.remote.json"
[ -f "$out/resolutions.json" ] || echo '{"version":1,"updatedAt":"","resolutions":[]}' > "$out/resolutions.json"
jq -s '{version: 1, updatedAt: (map(.updatedAt) | max),
        resolutions: (map(.resolutions) | add | unique_by(.threadId, .at) | sort_by(.at))}' \
   "$out/resolutions.json" "$out/resolutions.remote.json" > "$out/resolutions.json.tmp" \
   && mv "$out/resolutions.json.tmp" "$out/resolutions.json" && rm -f "$out/resolutions.remote.json"
```

2. List the open threads. A thread is open when the reviewer has not resolved it (no
   `resolved` field) and its latest agent resolution is absent or `needs-info`:

```sh
jq -r --slurpfile r "$out/resolutions.json" '
  ($r[0].resolutions | group_by(.threadId) | map({key: .[0].threadId, value: (sort_by(.at) | last).status}) | from_entries) as $st
  | .threads[] | select(.resolved == null) | select(($st[.id] // "open") as $s | $s == "open" or $s == "needs-info")
  | "\(.filePath):L\(.position.line | if type == "object" then "\(.start)-L\(.end)" else . end) (\(.position.side)) [\(.id)]\n" +
    ((.codeSnapshot // "") | split("\n") | map(select(length > 0) | "> " + .) | join("\n")) + "\n" +
    (.messages | map("\(.author): \(.body)") | join("\n")) + "\n"' "$out/comments.json"
```

3. For each open thread, first check that the anchor still holds. The line number is from
   the diff the reviewer looked at; the code may have moved since. On the `new` side, print
   that line range of the file in the working tree and compare it with the `>` snapshot
   lines (ignore trailing whitespace). If they match, work there. If they do not, search
   the file for the snapshot text and work where it is now. If it is nowhere — or the thread
   is on the `old` side and that code is gone — do not guess: answer `needs-info` saying
   what you looked for and where.

   Then make the change the reviewer asked for (or decide not to, with a reason), and
   append one resolution:

```sh
jq --arg id "$THREAD_ID" --arg status resolved --arg note "What you changed, one or two sentences." \
   --arg by "your-agent-name" --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
   '.updatedAt = $at | .resolutions += [{threadId: $id, status: $status, note: $note, by: $by, at: $at}]' \
   "$out/resolutions.json" > "$out/resolutions.json.tmp" && mv "$out/resolutions.json.tmp" "$out/resolutions.json"
```

Statuses: `resolved` (change made), `wontfix` (declined, note says why), `needs-info` (you are
asking the reviewer a question; the thread stays open).

4. Run the project's tests, then republish so the reviewer sees the new diff with the
   resolutions under their threads: follow the hunkboard-publish skill (it pushes
   `resolutions.json` along with `diff.json`).

5. Summarise to the user: one line per thread with its status. Do not commit; the user decides.
