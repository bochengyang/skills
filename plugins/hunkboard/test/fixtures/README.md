# Diff fixtures

Every `*.diff` here is verbatim `git diff` output, produced by `regenerate.sh` from a scratch
repository. Do not hand-edit them; add a case to the script and re-run it:

```sh
sh test/fixtures/regenerate.sh
```

| Fixture | Edge case |
|---|---|
| `modify.diff` | one hunk, mixed context/del/add |
| `multi-hunk.diff` | two hunks, `@@ ... @@ section` text |
| `delete.diff` | deleted file (`+++ /dev/null`) |
| `added-untracked.diff` | new file via `git add -N` on an untracked file |
| `rename-modified.diff` | rename with 95% similarity and a hunk |
| `rename-pure.diff` | 100% rename, no hunks |
| `binary.diff` | `Binary files ... differ` |
| `mode-change.diff` | `old mode` / `new mode`, no hunks |
| `path-with-space.diff` | path with spaces; git appends a TAB on `---`/`+++` lines |
| `no-newline-eof.diff` | `\ No newline at end of file` on both sides |
| `crlf.diff` | CRLF content, `\r` kept inside line content |
| `combined.diff` | all of the above in one diff (ten files) |
| `empty.diff` | zero bytes |
