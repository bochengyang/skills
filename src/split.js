export function toSplitRows(hunk) {
  const rows = [];
  let left = [], right = [];
  const flush = () => {
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      rows.push({ left: left[i] ?? null, right: right[i] ?? null });
    }
    left = [];
    right = [];
  };
  for (const line of hunk.lines) {
    if (line.type === 'context') {
      flush();
      rows.push({ left: line, right: line });
    } else (line.type === 'del' ? left : right).push(line);
  }
  flush();
  return rows;
}
