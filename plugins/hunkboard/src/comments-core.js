function commentId() {
  return globalThis.crypto?.randomUUID?.() ?? [
    Date.now().toString(36), Math.random().toString(36).slice(2),
    Math.random().toString(36).slice(2)
  ].join('-');
}

function commentMessage(body, author, now) {
  if (typeof body !== 'string' || !body.length) throw new Error('body must be non-empty');
  if (typeof author !== 'string' || !author.length) throw new Error('author must be non-empty');
  return { id: commentId(), author, body, createdAt: now };
}

export function createThread({
  id = commentId(), filePath, scope, side, line, body, author, codeSnapshot,
  now = new Date().toISOString()
}) {
  if (scope !== undefined && scope !== 'file') throw new Error('invalid scope');
  if (scope === 'file' && (side !== undefined || line !== undefined || codeSnapshot !== undefined)) {
    throw new Error('file comments cannot have side, line, or codeSnapshot');
  }
  if (scope !== 'file' && side !== 'old' && side !== 'new') throw new Error('invalid side');
  const positive = (n) => Number.isInteger(n) && n >= 1;
  const range = line && positive(line.start) && positive(line.end) && line.end >= line.start;
  if (scope !== 'file' && !(positive(line) || range)) throw new Error('invalid line');
  const thread = {
    id, filePath,
    position: scope === 'file' ? { scope: 'file' } : {
      side, line: typeof line === 'object' ? { start: line.start, end: line.end } : line
    },
    createdAt: now, updatedAt: now, messages: [commentMessage(body, author, now)],
  };
  if (codeSnapshot !== undefined) thread.codeSnapshot = codeSnapshot;
  return thread;
}

export function addReply(thread, { body, author, now = new Date().toISOString() }) {
  return {
    ...thread, updatedAt: now, messages: [...thread.messages, commentMessage(body, author, now)]
  };
}

export function threadAnchor(thread) {
  if (thread.position.scope === 'file') return `${thread.filePath}:file`;
  const { side, line } = thread.position;
  return `${thread.filePath}:${side}:${line.start ?? line}`;
}

export function applyResolutions(threads, document) {
  const latest = new Map();
  for (const resolution of document?.resolutions ?? []) {
    const previous = latest.get(resolution.threadId);
    if (!previous || Date.parse(resolution.at) >= Date.parse(previous.at)) {
      latest.set(resolution.threadId, resolution);
    }
  }
  return threads.map((thread) => ({
    ...thread, resolution: latest.has(thread.id) ? { ...latest.get(thread.id) } : null
  }));
}

export function resolveThread(thread, { by, now = new Date().toISOString() }) {
  if (typeof by !== 'string' || !by.trim()) throw new Error('by must be non-empty');
  return { ...thread, resolved: { by, at: now }, updatedAt: now };
}

export function unresolveThread(thread, { now = new Date().toISOString() }) {
  const { resolved, ...rest } = thread;
  return { ...rest, updatedAt: now };
}

export function threadState(thread) {
  return thread.resolved ? 'resolved' : (thread.resolution?.status ?? 'open');
}

export function openThreads(threads) {
  return threads.filter((thread) => ['open', 'needs-info'].includes(threadState(thread)));
}

export function formatPrompt(threads, { freshness } = {}) {
  const current = [], stale = [];
  for (const thread of threads) {
    const state = freshness?.(thread);
    (state === 'outdated' || state === 'missing' ? stale : current).push(thread);
  }
  const block = (thread, outdated = false) => {
    const { scope, side, line } = thread.position;
    const location = typeof line === 'object' ? `L${line.start}-L${line.end}` : `L${line}`;
    return [
      scope === 'file' ? `${thread.filePath} (file) [${thread.id}]`
        : `${thread.filePath}${outdated ? '' : `:${location}`} (${side}) [${thread.id}]`,
      ...(scope === 'file' || thread.codeSnapshot === undefined
        ? [] : thread.codeSnapshot.split('\n').map((text) => `> ${text}`)),
      ...thread.messages.map((message) => `${message.author}: ${message.body}`),
    ].join('\n');
  };
  return [
    ...current.map((thread) => block(thread)),
    ...(stale.length ? [
      '## Outdated — code moved; locate these by the quoted text because line numbers no longer apply',
      ...stale.map((thread) => block(thread, true))
    ] : [])
  ].join('\n\n');
}
