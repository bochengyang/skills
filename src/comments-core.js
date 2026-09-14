function commentId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function commentMessage(body, author, now) {
  if (typeof body !== 'string' || !body.length) throw new Error('body must be non-empty');
  if (typeof author !== 'string' || !author.length) throw new Error('author must be non-empty');
  return { id: commentId(), author, body, createdAt: now };
}

export function createThread({ id = commentId(), filePath, side, line, body, author, codeSnapshot, now = new Date().toISOString() }) {
  if (side !== 'old' && side !== 'new') throw new Error('invalid side');
  const positive = (n) => Number.isInteger(n) && n >= 1;
  if (!(positive(line) || (line && positive(line.start) && positive(line.end) && line.end >= line.start))) throw new Error('invalid line');
  const thread = {
    id, filePath, position: { side, line: typeof line === 'object' ? { start: line.start, end: line.end } : line },
    createdAt: now, updatedAt: now, messages: [commentMessage(body, author, now)],
  };
  if (codeSnapshot !== undefined) thread.codeSnapshot = codeSnapshot;
  return thread;
}

export function addReply(thread, { body, author, now = new Date().toISOString() }) {
  return { ...thread, updatedAt: now, messages: [...thread.messages, commentMessage(body, author, now)] };
}

export function threadAnchor(thread) {
  return `${thread.filePath}:${thread.position.side}:${thread.position.line.start ?? thread.position.line}`;
}

export function applyResolutions(threads, document) {
  const latest = new Map();
  for (const resolution of document?.resolutions ?? []) {
    const previous = latest.get(resolution.threadId);
    if (!previous || Date.parse(resolution.at) >= Date.parse(previous.at)) latest.set(resolution.threadId, resolution);
  }
  return threads.map((thread) => ({ ...thread, resolution: latest.has(thread.id) ? { ...latest.get(thread.id) } : null }));
}

export function openThreads(threads) {
  return threads.filter((thread) => !['resolved', 'wontfix'].includes(thread.resolution?.status));
}

export function formatPrompt(threads) {
  return threads.map((thread) => {
    const { side, line } = thread.position;
    const location = typeof line === 'object' ? `L${line.start}-L${line.end}` : `L${line}`;
    return [
      `${thread.filePath}:${location} (${side}) [${thread.id}]`,
      ...(thread.codeSnapshot === undefined ? [] : thread.codeSnapshot.split('\n').map((text) => `> ${text}`)),
      ...thread.messages.map((message) => `${message.author}: ${message.body}`),
    ].join('\n');
  }).join('\n\n');
}
