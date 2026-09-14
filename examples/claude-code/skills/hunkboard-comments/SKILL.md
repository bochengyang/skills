---
name: hunkboard-comments
description: Fetch the reviewer's open comment threads from the hunkboard for the current repo and branch, act on each one, record the outcome in resolutions.json and republish. Use when the user says "handle the board comments", "check hunkboard", or after they reviewed on their phone.
---

# hunkboard-comments

Requires the same environment as hunkboard-publish, plus the board URL (`HUNKBOARD_URL`,
e.g. `https://review.example.com`) and, if the board uses basic auth, a `~/.netrc` entry so
`curl -n` can read it.

1. Locate the namespace and fetch both documents (a 404 for either means "none yet"):

```sh
repo=$(basename "$(git rev-parse --show-toplevel)")
branch=$(git rev-parse --abbrev-ref HEAD | tr '/' '-')
out="$HOME/.cache/hunkboard/$repo/$branch"
curl -nsf "$HUNKBOARD_URL/$repo/$branch/comments.json" -o "$out/comments.json" || echo '{"version":1,"updatedAt":"","threads":[]}' > "$out/comments.json"
[ -f "$out/resolutions.json" ] || echo '{"version":1,"updatedAt":"","resolutions":[]}' > "$out/resolutions.json"
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

3. For each open thread, read the code at that location, make the change the reviewer asked
   for (or decide not to, with a reason), then append one resolution:

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
