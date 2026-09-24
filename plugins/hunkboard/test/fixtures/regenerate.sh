#!/bin/sh
# Regenerates every *.diff fixture from real git output.
# Usage: sh test/fixtures/regenerate.sh [target-dir]   (default: this directory)
set -eu
dest=$(cd "${1:-$(dirname "$0")}" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' 0
cd "$work"
git init -q -b main
git config user.email fixtures@hunkboard.invalid
git config user.name fixtures
git config commit.gpgsign false
mkdir -p src docs "dir with space"
printf 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11\nline12\nline13\nline14\nline15\nline16\nline17\nline18\nline19\nline20\n' > src/multi.txt
printf 'alpha\nbeta\ngamma\n' > src/modify.txt
printf 'to be deleted\n' > src/delete.txt
printf 'no newline at end' > src/noeol.txt
printf 'crlf line 1\r\ncrlf line 2\r\n' > src/crlf.txt
printf 'spaced file\n' > "dir with space/my file.txt"
printf '\211PNG\r\n\032\n\0\0binary1' > docs/img.png
printf '#!/bin/sh\necho hi\n' > bin.sh
seq 1 30 | sed 's/^/renamed content line /' > src/big.txt
printf 'pure rename\nline two\nline three\n' > src/pure.txt
git add -A
git commit -qm base

# Working-tree changes, one per edge case.
printf 'line1\nline2 changed\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11\nline12\nline13\nline14\nline15\nline16\nline17 changed\nline18\nline19\nline20\n' > src/multi.txt
printf 'alpha\nbeta modified\ngamma\ndelta added\n' > src/modify.txt
rm src/delete.txt
printf 'no newline at end, changed' > src/noeol.txt
printf 'crlf line 1\r\ncrlf line 2 changed\r\n' > src/crlf.txt
printf 'spaced file changed\n' > "dir with space/my file.txt"
printf '\211PNG\r\n\032\n\0\0binary2' > docs/img.png
chmod +x bin.sh
printf 'brand new file\nsecond\n' > src/added.txt
git add -N src/added.txt
git mv src/big.txt src/renamed-big.txt
sed 's/line 15$/line 15 tweaked/' src/renamed-big.txt > src/renamed-big.tmp && mv src/renamed-big.tmp src/renamed-big.txt
git mv src/pure.txt src/pure-renamed.txt

d() { git diff HEAD -M -- "$@"; }
d src/multi.txt                          > "$dest/multi-hunk.diff"
d src/modify.txt                         > "$dest/modify.diff"
d src/delete.txt                         > "$dest/delete.diff"
d src/noeol.txt                          > "$dest/no-newline-eof.diff"
d src/crlf.txt                           > "$dest/crlf.diff"
d "dir with space/my file.txt"           > "$dest/path-with-space.diff"
d docs/img.png                           > "$dest/binary.diff"
d bin.sh                                 > "$dest/mode-change.diff"
d src/added.txt                          > "$dest/added-untracked.diff"
d src/big.txt src/renamed-big.txt        > "$dest/rename-modified.diff"
d src/pure.txt src/pure-renamed.txt      > "$dest/rename-pure.diff"
: > "$dest/empty.diff"
# combined = everything except the pure rename (keeps the file list at ten entries)
git diff HEAD -M -- . ':!src/pure.txt' ':!src/pure-renamed.txt' > "$dest/combined.diff"
ls "$dest"/*.diff | wc -l
