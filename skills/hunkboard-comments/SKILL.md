---
name: hunkboard-comments
description: Act on the review comments the user left on a hunkboard — fix the code or answer each thread, record the outcome, and republish. Use when the user says they reviewed or commented on the board, pastes text copied from it, or says "check hunkboard".
---

# Handle hunkboard comments

## Get the threads

**Pasted text.** If the user pasted text copied from the board, those are the threads. Each
starts with a header line (`path:L12 (new) [id]`, or `path (new) [id]` under an "Outdated"
heading), then the commented code quoted with `>`, then the conversation. A header ending in
`(file) [id]` is a comment on the whole file: it has no line and no quoted code.

**From a board server.** Otherwise, with `HUNKBOARD_URL` set, fetch both files for this repo
and branch (`<branch>` with `/` replaced by `-`; a 404 means none yet; `curl -n` reads basic-auth
credentials from `~/.netrc`):

```sh
out="$HOME/.cache/hunkboard/<repo>/<branch>"; mkdir -p "$out"
curl -nsf "$HUNKBOARD_URL/<repo>/<branch>/comments.json" -o "$out/comments.json" \
  || echo '{"version":1,"updatedAt":"","threads":[]}' > "$out/comments.json"
curl -nsf "$HUNKBOARD_URL/<repo>/<branch>/resolutions.json" -o "$out/resolutions.remote.json" \
  || echo '{"version":1,"updatedAt":"","resolutions":[]}' > "$out/resolutions.remote.json"
[ -f "$out/resolutions.json" ] || echo '{"version":1,"updatedAt":"","resolutions":[]}' > "$out/resolutions.json"
# Merge: the local copy may be gone, the board's may lack entries not yet pushed.
jq -s '{version: 1, updatedAt: (map(.updatedAt) | max),
        resolutions: (map(.resolutions) | add | unique_by(.threadId, .at) | sort_by(.at))}' \
   "$out/resolutions.json" "$out/resolutions.remote.json" > "$out/resolutions.json.tmp" \
   && mv "$out/resolutions.json.tmp" "$out/resolutions.json" && rm -f "$out/resolutions.remote.json"
```

A thread is open unless it has a `resolved` field or its latest entry in `resolutions.json`
is `resolved` or `wontfix`. Work only on open threads.

## Work each thread

1. **Find the code by the quoted lines, not the line number.** The code may have moved since
   the comment was written, and threads under "Outdated" have no line number at all. Look at
   the given lines first; if they do not match the quote (ignoring trailing whitespace),
   search for the quoted text. If it is nowhere, do not guess: ask what was meant.
   A thread about the whole file (`(file)` in pasted text, `position.scope` is `"file"` in
   `comments.json`) is about the file as a whole — including one that is binary, renamed or
   deleted — so there is nothing to locate.
2. Make the change the reviewer asked for, or decide not to and say why.
3. Record the outcome.
   - With a board server, append one entry per thread to `$out/resolutions.json`:
     `{threadId, status, note, by, at}` where `status` is `resolved` (changed), `wontfix`
     (declined, the note says why) or `needs-info` (you are asking back; the thread stays open).
     ```sh
     jq --arg id "$ID" --arg status resolved --arg note "What changed, in a sentence." \
        --arg by "<agent name>" --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        '.updatedAt = $at | .resolutions += [{threadId: $id, status: $status, note: $note, by: $by, at: $at}]' \
        "$out/resolutions.json" > "$out/resolutions.json.tmp" && mv "$out/resolutions.json.tmp" "$out/resolutions.json"
     ```
   - Without one, answer in the conversation, one line per thread.

## Finish

Run the project's tests, then republish with the hunkboard-publish skill so the user sees the
new diff (with a board server, `hunkboard-push` also uploads `resolutions.json`). Summarise one
line per thread with its outcome. Do not commit; the user decides.
