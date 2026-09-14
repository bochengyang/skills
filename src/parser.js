export function parseDiff(text) {
  const files = [];
  let file, hunk, oldLine, newLine;
  const pathValue = (value) => {
    value = value.replace(/\t$/, '');
    if (value.startsWith('"')) {
      try { value = JSON.parse(value); } catch {}
    }
    return value === '/dev/null' ? null : value.replace(/^[ab]\//, '');
  };
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const paths = line.slice(11);
      const midpoint = (paths.length - 1) / 2;
      const split = paths[midpoint] === ' ' && paths.slice(2, midpoint) === paths.slice(midpoint + 3)
        ? midpoint : paths.indexOf(' b/');
      const quoted = paths.match(/^("(?:\\.|[^"\\])*") ("(?:\\.|[^"\\])*")$/);
      const oldPath = pathValue(quoted ? quoted[1] : paths.slice(0, split));
      const newPath = pathValue(quoted ? quoted[2] : paths.slice(split + 1));
      file = { path: newPath ?? oldPath, oldPath, newPath, status: 'modified', isBinary: false, additions: 0, deletions: 0, hunks: [] };
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;
    const range = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
    if (range) {
      hunk = { oldStart: +range[1], oldLines: +(range[2] ?? 1), newStart: +range[3], newLines: +(range[4] ?? 1), section: range[5].trim(), lines: [] };
      oldLine = hunk.oldStart;
      newLine = hunk.newStart;
      file.hunks.push(hunk);
    } else if (hunk) {
      if (line === '\\ No newline at end of file') {
        if (hunk.lines.length) hunk.lines[hunk.lines.length - 1].noNewline = true;
      } else if (' +-'.includes(line[0]) && line.length) {
        const type = line[0] === '+' ? 'add' : line[0] === '-' ? 'del' : 'context';
        hunk.lines.push({ type, content: line.slice(1), oldLine: type === 'add' ? null : oldLine++, newLine: type === 'del' ? null : newLine++ });
        if (type === 'add') file.additions++;
        if (type === 'del') file.deletions++;
      }
    } else {
      if (line.startsWith('--- ')) file.oldPath = pathValue(line.slice(4));
      else if (line.startsWith('+++ ')) file.newPath = pathValue(line.slice(4));
      else if (line.startsWith('rename from ')) { file.oldPath = line.slice(12); file.status = 'renamed'; }
      else if (line.startsWith('rename to ')) { file.newPath = line.slice(10); file.status = 'renamed'; }
      else if (line.startsWith('new file mode ')) { file.oldPath = null; file.newMode = line.slice(14); file.status = 'added'; }
      else if (line.startsWith('deleted file mode ')) { file.newPath = null; file.oldMode = line.slice(18); file.status = 'deleted'; }
      else if (line.startsWith('old mode ')) file.oldMode = line.slice(9);
      else if (line.startsWith('new mode ')) file.newMode = line.slice(9);
      else if (line.startsWith('similarity index ')) file.similarity = parseInt(line.slice(17), 10);
      else if (line.startsWith('Binary files ') || line === 'GIT binary patch') file.isBinary = true;
      file.path = file.newPath ?? file.oldPath;
    }
  }
  return { files };
}
