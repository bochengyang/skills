export function commentColumns(layout, side) {
  if (layout === 'split') return { start: side === 'old' ? 1 : 4, span: 3 };
  return { start: 1, span: 4 };
}

export function resolveDataBase(location) {
  const directory = new URL('.', location.href);
  const ns = new URLSearchParams(location.search).get('ns');
  return ns ? new URL(ns.replace(/\/*$/, '/'), directory).href : directory.href;
}
export function hashString(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}
export function fileContentHash(file) {
  const lines = file.hunks.flatMap((h) => h.lines.map((l) => [l.type, l.content]));
  return hashString(JSON.stringify(lines));
}
export function viewedKey(base, path, hash) {
  return `hunkboard:viewed:${base}:${path}:${hash}`;
}
export function mergeThreads(remote, local) {
  const threads = new Map();
  for (const thread of [...(remote ?? []), ...(local ?? [])]) {
    const previous = threads.get(thread.id);
    if (!previous || thread.updatedAt >= previous.updatedAt) threads.set(thread.id, thread);
  }
  return [...threads.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
export function buildCommentsDocument(threads, now = new Date().toISOString()) {
  return {
    version: 1,
    updatedAt: now,
    threads: mergeThreads(threads, []).map(({ resolution, ...thread }) => thread)
  };
}
export function threadsEndingAt(threads, path, side, line) {
  return threads.filter((t) =>
    t.filePath === path && t.position.side === side &&
    (t.position.line.end ?? t.position.line) === line
  );
}
export function threadFreshness(thread, lines) {
  if (thread.codeSnapshot === undefined) return 'current';
  if (lines === null) return 'missing';
  const { line } = thread.position;
  const start = line.start ?? line;
  const end = line.end ?? line;
  const range = [];
  for (let n = start; n <= end; n++) {
    if (lines[n - 1] === undefined) return 'missing';
    range.push(lines[n - 1]);
  }
  const normalize = (text) => text.replace(/\r\n/g, '\n')
    .split('\n').map((line) => line.replace(/\s+$/, '')).join('\n').replace(/\n$/, '');
  return normalize(range.join('\n')) === normalize(thread.codeSnapshot) ? 'current' : 'outdated';
}
export function gapLines(text, start, end, oldStart) {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const result = [];
  for (let n = Math.max(1, start); n <= Math.min(end, lines.length); n++) {
    result.push({
      type: 'context', content: lines[n - 1], oldLine: oldStart + n - start, newLine: n
    });
  }
  return result;
}
export function pickLanguage(path) {
  const name = path.split('/').pop().toLowerCase();
  if (/^dockerfile(?:\.|$)/.test(name)) return 'dockerfile';
  if (name === 'makefile') return 'makefile';
  return ({
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    yaml: 'yaml',
    yml: 'yaml',
    json: 'json',
    sh: 'bash',
    bash: 'bash',
    md: 'markdown',
    go: 'go',
    rs: 'rust',
    css: 'css',
    html: 'xml',
    xml: 'xml',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    java: 'java',
    rb: 'ruby',
    sql: 'sql' })[name.split('.').pop()] ?? null;
}
export function formatStat(node) {
  const additions = node?.additions ?? 0;
  const deletions = node?.deletions ?? 0;
  if (!additions && !deletions) return null;
  return { additions: `+${additions}`, deletions: `−${deletions}` };
}

export function totals(files) {
  return files.reduce((sum, f) => ({
    files: sum.files + 1,
    additions: sum.additions + f.additions,
    deletions: sum.deletions + f.deletions
  }), { files: 0, additions: 0, deletions: 0 });
}

export function buildFileTree(files) {
  const node = (name, path) => ({
    name, path, dirs: [], files: [], additions: 0, deletions: 0
  });
  const root = node('', '');
  const directories = new Map([['', root]]);
  for (const file of files) {
    let parent = root;
    parent.additions += file.additions;
    parent.deletions += file.deletions;
    const parts = file.path.split('/');
    parts.pop();
    for (const name of parts) {
      const path = parent.path ? `${parent.path}/${name}` : name;
      if (!directories.has(path)) {
        const directory = node(name, path);
        directories.set(path, directory);
        parent.dirs.push(directory);
      }
      parent = directories.get(path);
      parent.additions += file.additions;
      parent.deletions += file.deletions;
    }
    parent.files.push(file);
  }
  for (const directory of directories.values()) {
    directory.dirs.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  }
  return root;
}

export function fullFileLines(file, content) {
  if (!content || content.truncated || content.binary || file.isBinary) return null;
  if (file.oldPath === null || file.newPath === null) {
    const side = file.oldPath === null ? 'new' : 'old';
    return typeof content[side] === 'string' ? file.hunks.flatMap((h) => h.lines) : null;
  }
  if (typeof content.old !== 'string' || typeof content.new !== 'string') return null;
  const lines = [];
  let next = 1;
  let offset = 0;
  for (const hunk of file.hunks) {
    const start = hunk.newStart + (hunk.newLines === 0 ? 1 : 0);
    for (const line of gapLines(content.new, next, start - 1, next - offset)) lines.push(line);
    for (const line of hunk.lines) {
      lines.push(line);
      if (line.type === 'add') offset++;
      if (line.type === 'del') offset--;
    }
    next = start + hunk.newLines;
  }
  for (const line of gapLines(content.new, next, Infinity, next - offset)) lines.push(line);
  return lines;
}
export function focusTarget(hash) {
  if (typeof hash !== 'string' || !hash.startsWith('#file=') || hash === '#file=') return null;
  try {
    return decodeURIComponent(hash.slice(6));
  } catch {
    return null;
  }
}
focusTarget.toHash = (path) => path === null ? '' : '#file=' + encodeURIComponent(path);

export function statusMark(file) {
  switch (file?.status) {
    case 'added': return { letter: 'A', label: 'Added' };
    case 'deleted': return { letter: 'D', label: 'Deleted' };
    case 'renamed': return { letter: 'R', label: 'Renamed' };
    default: return { letter: 'M', label: 'Modified' };
  }
}

export function formatRelativeTime(iso, now = Date.now()) {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  const seconds = Math.max(0, (now - at) / 1000);
  const ago = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return ago(Math.floor(seconds / 60), 'minute');
  if (seconds < 86400) return ago(Math.floor(seconds / 3600), 'hour');
  const days = Math.floor(seconds / 86400);
  if (days === 1) return 'yesterday';
  if (days < 14) return ago(days, 'day');
  const date = new Date(at);
  const month = date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const year = date.getUTCFullYear();
  const suffix = year === new Date(now).getUTCFullYear() ? '' : `, ${year}`;
  return `on ${month} ${date.getUTCDate()}${suffix}`;
}

export function avatarLetter(name) {
  return [...(name?.trim() || '?')][0].toUpperCase();
}

export function selectionRange(selection) {
  if (!selection) return null;
  const { anchor, head } = selection;
  return anchor === head ? anchor : { start: Math.min(anchor, head), end: Math.max(anchor, head) };
}

export function isSelected(selection, path, side, line) {
  if (!selection || line == null) return false;
  if (selection.path !== path || selection.side !== side) return false;
  return line >= Math.min(selection.anchor, selection.head) &&
    line <= Math.max(selection.anchor, selection.head);
}

export function selectionFromLines(entries) {
  let selection = null;
  for (const entry of entries ?? []) {
    if (!Number.isInteger(entry?.line) || entry.line <= 0) continue;
    const { path, side, line } = entry;
    if (!selection) selection = { path, side, anchor: line, head: line };
    if (path !== selection.path || side !== selection.side) continue;
    selection.anchor = Math.min(selection.anchor, line);
    selection.head = Math.max(selection.head, line);
  }
  return selection;
}

export function reviewProgress(files, isViewed) {
  const list = files ?? [];
  const total = list.length;
  const viewed = list.filter(isViewed).length;
  return {
    viewed,
    total,
    ratio: total ? viewed / total : 0,
    complete: total > 0 && viewed === total
  };
}

export function modeChangeLabel(file) {
  const { oldMode, newMode } = file;
  if (!oldMode || !newMode || oldMode === newMode) return null;
  const labels = {
    '100644:100755': 'Made executable',
    '100755:100644': 'No longer executable',
    '100644:120000': 'Became a symlink',
    '120000:100644': 'No longer a symlink'
  };
  return labels[`${oldMode}:${newMode}`] ?? `Mode ${oldMode} → ${newMode}`;
}

export function diffstatSquares(additions, deletions) {
  const total = additions + deletions;
  const filled = Math.min(5, total);
  const rounded = total ? Math.round(filled * additions / total) : 0;
  const green = additions && deletions ? Math.max(1, Math.min(filled - 1, rounded)) : rounded;
  return Array.from({ length: 5 }, (_, index) =>
    index < green ? 'add' : index < filled ? 'del' : 'neutral');
}

export function matchesFileFilter(path, query, onlyUnresolved, threads) {
  return path.toLowerCase().includes(query.toLowerCase()) &&
    (!onlyUnresolved || threads.some((thread) => thread.filePath === path));
}
