(() => {
  const root = document.getElementById('app');
  const dataBase = resolveDataBase(window.location);
  if (new URL(dataBase).origin !== window.location.origin) {
    root.textContent = 'The review namespace must be on the same origin as this viewer.';
    return;
  }
  const commentsKey = `hunkboard:comments:${dataBase}`;
  const localNotice =
    'Comments are kept in this browser only — use Copy prompt to hand them to your agent';
  const read = (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };
  const write = (key, value) => {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  };
  const sidebarKey = () => window.innerWidth >= 768
    ? 'hunkboard:sidebar:wide' : 'hunkboard:sidebar:narrow';
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (text, action, className) => {
    const node = el('button', className, text);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  };
  let local = [];
  try {
    const doc = JSON.parse(read(commentsKey));
    local = Array.isArray(doc) ? doc : (doc?.threads ?? []);
  } catch {}
  const state = {
    threads: [],
    resolutions: null,
    files: [],
    diff: null,
    focus: focusTarget(location.hash),
    focusMode: window.innerWidth < 768 ? 'inline' : 'split',
    mode: read('hunkboard:view') || (window.innerWidth < 768 ? 'inline' : 'split'),
    onlyOpen: false,
    fileFilter: '',
    onlyUnresolved: false,
    collapsed: new Map(),
    expanded: new Set(),
    treeClosed: new Set(),
    sidebarShown: (read(sidebarKey()) ||
      (window.innerWidth >= 768 ? 'shown' : 'hidden')) === 'shown',
    selection: null
  };
  // Sidebar navigation uses #file= paths; section ids remain overview anchors.
  window.addEventListener('hashchange', () => {
    const focus = focusTarget(location.hash);
    if (focus && !state.focus) {
      state.focusMode = window.innerWidth < 768 ? 'inline' : 'split';
    }
    state.focus = focus;
    if (focus) state.collapsed.set(focus, false);
    state.selection = null;
    if (state.diff) render();
  });
  const viewMode = () => window.innerWidth < 768
    ? 'inline' : (state.focus ? state.focusMode : state.mode);
  const narrowScreen = window.matchMedia('(max-width: 767px)');
  narrowScreen.addEventListener('change', () => {
    if (state.diff) render();
  });
  function syncSidebar() {
    const sidebar = root.querySelector('.sidebar');
    if (!sidebar) return;
    sidebar.classList.toggle('collapsed', !state.sidebarShown);
    root.querySelector('.layout').classList.toggle('sidebar-collapsed', !state.sidebarShown);
    sidebar.replaceChildren();
    const head = el('div', 'sidebar-head');
    const toggle = button(state.sidebarShown ? '‹' : '›', () => {
      state.sidebarShown = !state.sidebarShown;
      write(sidebarKey(), state.sidebarShown ? 'shown' : 'hidden');
      syncSidebar();
      sidebar.querySelector('button').focus();
    });
    toggle.setAttribute('aria-label', state.sidebarShown ? 'Hide file tree' : 'Show file tree');
    toggle.setAttribute('aria-expanded', String(state.sidebarShown));
    toggle.setAttribute('aria-controls', 'hb-tree');
    head.append(el('span', 'sidebar-title', 'Files'));
    head.append(toggle);
    sidebar.append(head);
    if (state.sidebarShown) {
      const tree = el('div');
      tree.id = 'hb-tree';
      renderFileTree(tree);
      const controls = el('div', 'file-filters');
      const search = el('label', 'file-search');
      const input = el('input');
      input.placeholder = 'Filter files…';
      input.setAttribute('aria-label', 'Filter files');
      input.value = state.fileFilter;
      const refresh = () => {
        tree.replaceChildren();
        renderFileTree(tree);
      };
      input.addEventListener('input', () => {
        state.fileFilter = input.value;
        refresh();
      });
      search.append(treeGlyph('search'), input);
      const funnel = button('', () => {
        state.onlyUnresolved = !state.onlyUnresolved;
        funnel.setAttribute('aria-pressed', String(state.onlyUnresolved));
        refresh();
      });
      funnel.append(treeGlyph('filter'));
      funnel.title = 'Show only files with unresolved comments';
      funnel.setAttribute('aria-label', funnel.title);
      funnel.setAttribute('aria-pressed', String(state.onlyUnresolved));
      controls.append(search, funnel);
      sidebar.append(controls, tree);
    }
  }

  let notice,
    revision = 0,
    saving = false,
    savedTimer;
  const decorated = () => applyResolutions(state.threads, state.resolutions);
  function setNotice(text) {
    notice.textContent = text === localNotice ? 'Browser only' : text;
    notice.title = text;
    notice.setAttribute('aria-label', text);
    notice.classList.toggle('local-only', text === localNotice);
  }
  async function persist() {
    revision++;
    write(commentsKey, JSON.stringify(buildCommentsDocument(state.threads)));
    setNotice(localNotice);
    if (saving) return;
    saving = true;
    try {
      while (true) {
        const sentRevision = revision;
        const document = buildCommentsDocument(state.threads);
        let ok = false;
        try {
          ok = (
            await fetch(`${dataBase}comments.json`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(document)
            })
          ).ok;
        } catch {}
        if (sentRevision !== revision) continue;
        if (ok) {
          local = [];
          try {
            localStorage.removeItem(commentsKey);
          } catch {}
          setNotice('Saved');
          clearTimeout(savedTimer);
          savedTimer = setTimeout(() => {
            if (notice.textContent === 'Saved') setNotice('');
          }, 2000);
        } else setNotice(localNotice);
        break;
      }
    } finally {
      saving = false;
    }
  }
  let dismissComposer = () => {};
  function identity(host, title) {
    const header = el('div', 'composer-header');
    const author = el('input');
    author.placeholder = 'Your name';
    author.setAttribute('aria-label', 'Your name');
    author.value = read('hunkboard:author') || '';
    author.required = true;
    const avatar = el('span', 'avatar', avatarLetter(author.value));
    avatar.setAttribute('aria-hidden', 'true');
    author.addEventListener('input', () => {
      avatar.textContent = avatarLetter(author.value);
    });
    header.append(avatar, el('strong', '', title), el('span', '', 'as'));
    if (author.value) {
      const name = el('strong', '', author.value);
      const change = button('Change name', () => {
        name.remove();
        change.replaceWith(author);
        author.focus();
      }, 'link-button');
      change.setAttribute('aria-label', 'Change name');
      const glyph = el('span', 'change-name-glyph', '✎');
      glyph.setAttribute('aria-hidden', 'true');
      change.replaceChildren(el('span', 'change-name-label', 'Change name'), glyph);
      header.append(name, change);
    } else header.append(author);
    host.append(header);
    return () => {
      if (!author.value.trim()) {
        author.value = '';
        author.reportValidity();
        author.focus();
        return null;
      }
      write('hunkboard:author', author.value.trim());
      return author.value.trim();
    };
  }
  function editorKeys(node, submit, cancel) {
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        submit();
      }
    });
  }
  function commentRow(node, side) {
    const layout = viewMode();
    const row = el('div', `comment-row ${layout}`);
    const { start, span } = commentColumns(layout, side);
    node.style.gridColumn = `${start} / span ${span}`;
    row.append(node);
    return row;
  }
  function composer(host, submit, title, action = 'Comment', nameOnly = false, side) {
    hideTextComment();
    textSelection = null;
    dismissComposer();
    const node = el('form', 'comment-form');
    const row = commentRow(node, side);
    const getAuthor = identity(node, title);
    const body = el('textarea');
    body.placeholder = 'Leave a comment';
    body.setAttribute('aria-label', 'Comment');
    body.required = true;
    body.autofocus = true;
    const cancel = () => {
      row.remove();
      clearSelection();
      host.querySelector('button')?.focus();
    };
    const add = el('button', 'primary', action);
    add.type = 'submit';
    if (!nameOnly) {
      const box = el('div', 'composer-box');
      box.append(body);
      node.append(box);
    }
    const footer = el('div', 'composer-footer');
    footer.append(button('Cancel', cancel), add);
    node.append(footer);
    node.addEventListener('submit', (event) => {
      event.preventDefault();
      const author = getAuthor();
      if (!author || (!nameOnly && !body.value.trim())) return;
      submit(body.value, author);
      state.selection = null;
      render();
      persist();
    });
    editorKeys(node, () => node.requestSubmit(), cancel);
    dismissComposer = () => row.remove();
    const anchor = host.closest('.comment-row') ?? host;
    anchor.after(row);
    if (nameOnly) node.querySelector('input')?.focus();
    else body.focus();
  }
  function relativeTime(iso) {
    const time = el('time', '', formatRelativeTime(iso));
    time.title = iso;
    time.dateTime = iso;
    return time;
  }
  function threadCard(thread) {
    const outdated = freshness(thread) !== 'current';
    const closed = outdated || ['resolved', 'wontfix'].includes(threadState(thread));
    const card = el('div', 'thread');
    card.dataset.threadId = thread.id;
    card.classList.toggle('closed', closed);
    const content = el('div', 'thread-content');
    const statuses = { resolved: 'Resolved', wontfix: "Won't fix", 'needs-info': 'Needs info' };
    if (closed) {
      const label = outdated ? 'Code moved' : thread.resolved
        ? `${thread.resolved.by} resolved this conversation`
        : `${thread.resolution.by} marked this ${statuses[thread.resolution.status]}`;
      const summary = el('div', 'thread-summary');
      const toggle = button('Show', () => {
        content.hidden = !content.hidden;
        toggle.textContent = content.hidden ? 'Show' : 'Hide';
        toggle.setAttribute('aria-expanded', String(!content.hidden));
      }, 'link-button');
      toggle.setAttribute('aria-expanded', 'false');
      content.hidden = true;
      if (outdated) summary.append(el('span', 'outdated-chip', 'Outdated'));
      summary.append(el('span', '', `${label} · `), toggle);
      card.append(summary);
    }
    for (const message of thread.messages) {
      const item = el('div', 'message');
      const header = el('div', 'message-header');
      const avatar = el('span', 'avatar', avatarLetter(message.author));
      avatar.setAttribute('aria-hidden', 'true');
      header.append(avatar, el('strong', '', message.author), relativeTime(message.createdAt));
      item.append(el('p', '', message.body));
      content.append(header, item);
    }
    if (thread.resolution) {
      const { by, status, at, note } = thread.resolution;
      const system = el('div', 'resolution');
      const header = el('div', 'message-header');
      header.append(el('span', '', `⚙ ${by} · ${statuses[status]}`), relativeTime(at));
      if (note) system.append(el('p', '', note));
      content.append(header, system);
    }
    const footer = el('div', 'thread-footer');
    const replyHost = el('div', 'reply-host');
    const collapseReply = () => {
      replyHost.replaceChildren();
      const input = el('input', 'reply-preview');
      input.placeholder = 'Reply…';
      input.setAttribute('aria-label', 'Reply');
      const expand = () => {
        dismissComposer();
        dismissComposer = collapseReply;
        const form = el('form', 'comment-form reply-form');
        const getAuthor = identity(form, 'Replying');
        const body = el('textarea');
        body.placeholder = 'Leave a comment';
        body.setAttribute('aria-label', 'Reply');
        body.required = true;
        body.value = input.value;
        const send = el('button', 'primary', 'Reply');
        send.type = 'submit';
        const actions = el('div', 'composer-footer');
        actions.append(button('Cancel', collapseReply), send);
        const box = el('div', 'composer-box');
        box.append(body);
        form.append(box, actions);
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          const author = getAuthor();
          if (!author || !body.value.trim()) return;
          state.threads = state.threads.map((t) =>
            t.id === thread.id ? addReply(t, { body: body.value, author }) : t
          );
          render();
          persist();
        });
        editorKeys(form, () => form.requestSubmit(), () => {
          collapseReply();
          footer.querySelector('button')?.focus();
        });
        replyHost.replaceChildren(form);
        body.focus();
      };
      input.addEventListener('focus', expand);
      input.addEventListener('input', expand);
      replyHost.append(input);
    };
    collapseReply();
    const action = thread.resolved ? 'Unresolve' : 'Resolve conversation';
    const resolve = button(action, () => {
      const update = (body, by) => {
        const now = new Date().toISOString();
        state.threads = state.threads.map((t) => t.id !== thread.id ? t :
          thread.resolved ? unresolveThread(t, { now }) : resolveThread(t, { by, now }));
      };
      const author = read('hunkboard:author')?.trim();
      if (!author) {
        composer(card, update, action, action, true, thread.position.scope === 'file' ? 'file' : thread.position.side);
        return;
      }
      update('', author);
      render();
      persist();
    });
    footer.append(replyHost, resolve);
    content.append(footer);
    card.append(content);
    return commentRow(card, thread.position.scope === 'file' ? 'file' : thread.position.side);
  }
  function sourceLines(file, side) {
    const text = state.diff.files?.[file.path]?.[side];
    if (typeof text === 'string') {
      const lines = text.split('\n');
      if (lines.at(-1) === '') lines.pop();
      return lines;
    }
    const map = [];
    file.hunks.forEach((h) =>
      h.lines.forEach((l) => {
        const n = l[`${side}Line`];
        if (n !== null) map[n - 1] = l.content;
      })
    );
    return map;
  }
  function freshness(thread) {
    const file = state.files.find((file) => file.path === thread.filePath);
    return threadFreshness(thread, file ? sourceLines(file, thread.position.side ?? 'new') : null);
  }
  const selectionControls = new WeakMap();
  let drag = null;
  function paintRow(row) {
    const selected = ['old', 'new'].map((side) => {
      const line = row.dataset[side];
      const active = isSelected(textSelection || state.selection, row.dataset.path, side,
        line === undefined ? null : Number(line));
      row.classList.toggle(`selected-${side}`, active);
      return active;
    });
    row.classList.toggle('selected', selected.some(Boolean));
  }
  function paintSelection() {
    root.querySelectorAll('.code-row').forEach(paintRow);
  }
  let textComment = null;
  let selectionTimer;
  let textSelection = null;
  function hideTextComment() {
    clearTimeout(selectionTimer);
    textComment?.remove();
    textComment = null;
  }
  function dismissTextSelection() {
    hideTextComment();
    if (textSelection) {
      textSelection = null;
      paintSelection();
    }
  }
  function selectedCell(node) {
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    const cell = element?.closest('.hb-code');
    return cell && root.contains(cell) ? cell : null;
  }
  function cellEntry(cell) {
    const row = cell.closest('.code-row');
    const side = row.classList.contains('split')
      ? (cell === row.children[2] ? 'old' : 'new')
      : (row.dataset.new === undefined ? 'old' : 'new');
    return { path: row.dataset.path, side, line: Number(row.dataset[side]), row };
  }
  function readTextSelection() {
    const native = window.getSelection();
    const first = selectedCell(native?.anchorNode);
    const last = selectedCell(native?.focusNode);
    if (!native?.rangeCount || native.isCollapsed || !first || !last) {
      return null;
    }
    const range = native.getRangeAt(0);
    const pieces = [];
    for (const cell of root.querySelectorAll('.code-row > .hb-code')) {
      if (!range.intersectsNode(cell)) continue;
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      let text = '';
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.parentElement.closest('.no-newline') || !range.intersectsNode(node)) continue;
        const start = node === range.startContainer ? range.startOffset : 0;
        const end = node === range.endContainer ? range.endOffset : node.length;
        text += node.textContent.slice(start, end);
      }
      if (text || !cell.textContent) pieces.push({ ...cellEntry(cell), text });
    }
    const selection = selectionFromLines([cellEntry(first), ...pieces]);
    const seen = new Set();
    const covered = pieces.filter((entry) => {
      if (entry.path !== selection?.path || entry.side !== selection.side ||
        !Number.isInteger(entry.line) || entry.line <= 0 || seen.has(entry.line)) return false;
      seen.add(entry.line);
      return true;
    }).sort((a, b) => a.line - b.line);
    const snapshot = covered.map((entry) => entry.text).join('\n').replace(/\n$/, '');
    if (!selection || !snapshot || !covered.length) return null;
    return { selection, covered, snapshot, range };
  }
  function updateTextSelection() {
    hideTextComment();
    if (drag) return;
    const selected = readTextSelection();
    if (!selected) {
      dismissTextSelection();
      return;
    }
    const { selection, covered, snapshot, range } = selected;
    textSelection = selection;
    paintSelection();
    const activate = (event) => {
      if (event.type === 'pointerdown' && event.button !== 0) return;
      event.preventDefault();
      textSelection = null;
      state.selection = selection;
      const file = state.files.find((item) => item.path === selection.path);
      openSelection(file, selection.side, covered.at(-1).row, snapshot);
    };
    textComment = button('Comment', activate, 'text-comment');
    textComment.addEventListener('pointerdown', activate);
    document.body.append(textComment);
    const rect = range.getBoundingClientRect();
    const width = textComment.offsetWidth, height = textComment.offsetHeight;
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
    const right = left + (viewport?.width ?? window.innerWidth);
    const bottom = top + (viewport?.height ?? window.innerHeight);
    textComment.style.left = `${window.scrollX + Math.max(left + 4,
      Math.min(rect.right, right - width - 4))}px`;
    textComment.style.top = `${window.scrollY + Math.max(top + 4,
      Math.min(rect.bottom + 6, bottom - height - 4))}px`;
  }
  function scheduleTextSelection() {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(updateTextSelection, 120);
  }
  let selectionPointerDown = false;
  function clearSelectionSide() {
    for (const code of root.querySelectorAll('.diff-code.selecting-old,.diff-code.selecting-new')) {
      code.classList.remove('selecting-old', 'selecting-new');
    }
  }
  function clearCollapsedSelectionSide() {
    if (!selectionPointerDown && window.getSelection()?.isCollapsed) clearSelectionSide();
  }
  document.addEventListener('pointerdown', (event) => {
    clearSelectionSide();
    const cell = selectedCell(event.target);
    selectionPointerDown = Boolean(cell);
    if (!cell?.closest('.code-row.split')) return;
    const side = cellEntry(cell).side;
    cell.closest('.diff-code').classList.add(`selecting-${side}`);
  });
  const endSelectionPointer = () => {
    selectionPointerDown = false;
    clearCollapsedSelectionSide();
  };
  document.addEventListener('pointerup', endSelectionPointer);
  document.addEventListener('pointercancel', endSelectionPointer);
  document.addEventListener('selectionchange', clearCollapsedSelectionSide);
  document.addEventListener('selectionchange', scheduleTextSelection);
  document.addEventListener('pointerup', scheduleTextSelection);
  document.addEventListener('copy', (event) => {
    if (event.defaultPrevented || !event.clipboardData) return;
    const selected = readTextSelection();
    if (!selected) return;
    event.clipboardData.setData('text/plain', selected.snapshot);
    event.preventDefault();
  });
  document.addEventListener('keyup', (event) => {
    if (event.key !== 'Escape') scheduleTextSelection();
  });
  document.addEventListener('scroll', dismissTextSelection, true);
  function clearSelection() {
    hideTextComment();
    textSelection = null;
    const previous = drag;
    drag = null;
    if (previous?.control.hasPointerCapture(previous.id)) {
      previous.control.releasePointerCapture(previous.id);
    }
    state.selection = null;
    paintSelection();
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') dismissTextSelection();
    if (event.key === 'Escape' && state.selection) {
      event.preventDefault();
      dismissComposer();
      clearSelection();
    }
  });
  function setSelection(event, file, side, number) {
    hideTextComment();
    textSelection = null;
    const previous = state.selection;
    const anchor = event.shiftKey && previous?.path === file.path && previous.side === side
      ? previous.anchor : number;
    state.selection = { path: file.path, side, anchor, head: number };
    paintSelection();
  }
  function selectLine(event, file, side, number, host) {
    setSelection(event, file, side, number);
    openSelection(file, side, host);
  }
  function openSelection(file, side, host, selectedText) {
    const range = selectionRange(state.selection);
    const start = range.start ?? range,
      end = range.end ?? range;
    const codeSnapshot = selectedText ?? sourceLines(file, side)
      .slice(start - 1, end)
      .join('\n');
    const prefix = side === 'new' ? 'R' : 'L';
    const title = start === end
      ? `Add a comment on line ${prefix}${start}`
      : `Add a comment on lines ${prefix}${start} to ${prefix}${end}`;
    composer(
      host,
      (body, author) =>
        state.threads.push(
          createThread({ filePath: file.path, side, line: range, codeSnapshot, body, author })
        ),
      title,
      'Comment',
      false,
      side
    );
  }
  function syntax(node, content, path) {
    const language = pickLanguage(path);
    if (language && window.hljs?.getLanguage(language)) {
      try {
        node.innerHTML = window.hljs.highlight(content, { language }).value;
        return;
      } catch {}
    }
    node.textContent = content;
  }
  function codeCell(line, file, words) {
    const code = el('code', `hb-code ${line?.type || 'empty'}`);
    if (!line) return code;
    if (words) {
      for (const part of words) {
        const span = el('span', part.changed ? 'word-change' : '');
        syntax(span, part.text, file.path);
        code.append(span);
      }
    } else syntax(code, line.content, file.path);
    if (line.noNewline) code.append(el('span', 'no-newline', ' ⏎ No newline at end of file'));
    return code;
  }
  function addRows(container, file, lines, threads, placed) {
    const pairs = toSplitRows({ lines });
    const wordMap = new Map();
    for (const { left, right } of pairs)
      if (
        left?.type === 'del' &&
        right?.type === 'add' &&
        left.content.length < 1000 &&
        right.content.length < 1000 &&
        window.Diff
      ) {
        const words = wordHighlights(window.Diff.diffWordsWithSpace(left.content, right.content));
        if (words) {
          wordMap.set(left, words.old);
          wordMap.set(right, words.new);
        }
      }
    const attach = (row, side, number) => {
      if (number == null) return;
      for (const thread of threadsEndingAt(threads, file.path, side, number))
        if (!placed.has(thread.id)) {
          container.append(threadCard(thread));
          placed.add(thread.id);
        }
    };
    const addControl = (side, number, row) => {
      let pointerClick = false;
      const add = button('+', (event) => {
        if (pointerClick && event.detail !== 0) {
          pointerClick = false;
          return;
        }
        selectLine(event, file, side, number, row);
      }, 'add-comment');
      selectionControls.set(add, { file, side, number, row });
      add.setAttribute('aria-label', `Add a comment on ${side} line ${number}`);
      add.title = 'Drag to select lines; Shift-click to extend selection';
      add.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || drag) return;
        event.preventDefault();
        pointerClick = false;
        dismissComposer();
        setSelection(event, file, side, number);
        drag = { id: event.pointerId, control: add, row };
        add.setPointerCapture(event.pointerId);
      });
      const move = (event) => {
        if (drag?.id !== event.pointerId) return;
        const hit = document.elementFromPoint(event.clientX, event.clientY);
        const target = selectionControls.get(hit?.closest('.add-comment, .gutter'));
        if (!target || target.file.path !== file.path || target.side !== side) return;
        state.selection.head = target.number;
        drag.row = target.row;
        paintSelection();
      };
      add.addEventListener('pointermove', move);
      add.addEventListener('pointerup', (event) => {
        if (drag?.id !== event.pointerId) return;
        move(event);
        const host = drag.row;
        drag = null;
        pointerClick = true;
        add.releasePointerCapture(event.pointerId);
        openSelection(file, side, host);
      });
      const abort = (event) => {
        if (drag?.id === event.pointerId) clearSelection();
      };
      add.addEventListener('pointercancel', abort);
      add.addEventListener('lostpointercapture', abort);
      return add;
    };
    const gutter = (line, side, row) => {
      const cell = el('span', `gutter-cell ${line?.type || 'empty'}`);
      const number = line?.[`${side}Line`];
      row.dataset.path = file.path;
      if (number != null) row.dataset[side] = number;
      if (number == null) cell.append(el('span', 'gutter'));
      else {
        const b = button(String(number),
          (event) => selectLine(event, file, side, number, row), 'gutter');
        b.setAttribute('aria-label', `Comment on ${side} line ${number}`);
        selectionControls.set(b, { file, side, number, row });
        cell.append(b);
        if (viewMode() === 'split') cell.append(addControl(side, number, row));
      }
      if (viewMode() === 'inline' && side === 'old') {
        const target = line.newLine == null ? 'old' : 'new';
        cell.append(addControl(target, line[`${target}Line`], row));
      }
      return cell;
    };
    if (viewMode() === 'split') {
      for (const { left, right } of pairs) {
        const row = el('div', 'code-row split');
        row.append(
          gutter(left, 'old', row),
          signCell(left),
          codeCell(left, file, wordMap.get(left)),
          gutter(right, 'new', row),
          signCell(right),
          codeCell(right, file, wordMap.get(right))
        );
        paintRow(row);
        container.append(row);
        attach(row, 'old', left?.oldLine);
        attach(row, 'new', right?.newLine);
      }
    } else
      for (const line of lines) {
        const row = el('div', `code-row inline ${line.type}`);
        row.append(
          gutter(line, 'old', row),
          gutter(line, 'new', row),
          signCell(line),
          codeCell(line, file, wordMap.get(line))
        );
        paintRow(row);
        container.append(row);
        attach(row, 'old', line.oldLine);
        attach(row, 'new', line.newLine);
      }
  }
  function signCell(line) {
    const sign = line?.type === 'add' ? '+' : line?.type === 'del' ? '−' : '';
    const cell = el('span', `sign-cell ${line?.type || 'empty'}`, sign);
    cell.setAttribute('aria-hidden', 'true');
    return cell;
  }
  function isReviewed(file) {
    return read(viewedKey(dataBase, file.path, fileContentHash(file))) === '1';
  }
  function viewedControl(file) {
    const viewed = isReviewed(file);
    const tick = el('label', 'viewed');
    const checkbox = el('input');
    checkbox.type = 'checkbox';
    checkbox.checked = viewed;
    checkbox.addEventListener('change', () => {
      write(viewedKey(dataBase, file.path, fileContentHash(file)), viewed ? '0' : '1');
      state.collapsed.set(file.path, !viewed);
      renderAfterToggle(file.path, !viewed);
    });
    tick.append(checkbox, el('span', 'viewed-label', 'Viewed'));
    tick.setAttribute('aria-pressed', String(viewed));
    tick.setAttribute('aria-label', `Mark ${file.path} as ${viewed ? 'unviewed' : 'viewed'}`);
    checkbox.setAttribute('aria-label', tick.getAttribute('aria-label'));
    return tick;
  }

  async function copyPath(path) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(path);
    } catch {
      const area = el('textarea', 'copy-fallback');
      area.readOnly = true;
      area.value = path;
      area.setAttribute('aria-label', 'Copy file path');
      root.querySelector('.copy-fallback')?.remove();
      toolbar.after(area);
      area.focus();
      area.select();
    }
  }
  function fileMenu(file, canViewWholeFile) {
    const host = el('div', 'file-overflow');
    const menu = el('div', 'file-menu');
    menu.hidden = true;
    const more = button('···', () => {
      menu.hidden = !menu.hidden;
      more.setAttribute('aria-expanded', String(!menu.hidden));
      if (!menu.hidden) menu.querySelector('button').focus();
    });
    more.setAttribute('aria-label', `More actions for ${file.path}`);
    more.setAttribute('aria-expanded', 'false');
    const close = () => {
      menu.hidden = true;
      more.setAttribute('aria-expanded', 'false');
    };
    if (canViewWholeFile) menu.append(button('View whole file', () => {
      close();
      location.hash = focusTarget.toHash(file.path);
    }));
    menu.append(button('Copy path', () => {
      close();
      copyPath(file.path);
    }), button('Mark all as viewed', () => {
      for (const item of state.files) {
        write(viewedKey(dataBase, item.path, fileContentHash(item)), '1');
        state.collapsed.set(item.path, true);
      }
      render();
    }));
    host.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      close();
      more.focus();
    });
    host.addEventListener('focusout', (event) => {
      if (!host.contains(event.relatedTarget)) close();
    });
    host.append(more, menu);
    return host;
  }
  async function copyPrompt(event) {
    const target = event.currentTarget;
    const label = target.textContent;
    const text = formatPrompt(openThreads(decorated()), { freshness });
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
      target.textContent = 'Copied';
      setTimeout(() => {
        target.textContent = label;
      }, 2000);
    } catch {
      const area = el('textarea', 'copy-fallback');
      area.readOnly = true;
      area.value = text;
      area.setAttribute('aria-label', 'Copy review prompt');
      root.querySelector('.copy-fallback')?.remove();
      toolbar.after(area);
      area.focus();
      area.select();
    }
  }
  let toolbar;
  const progressRule = el('div', 'review-progress');
  const progressFill = el('div', 'review-progress-fill');
  progressRule.append(progressFill);
  function treeGlyph(kind) {
    const svgNode = (tag, attributes) => {
      const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
      return node;
    };
    const svg = svgNode('svg', {
      viewBox: '0 0 12 12',
      width: '12',
      height: '12',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '1',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
      focusable: 'false',
      class: `tree-${kind}`
    });
    if (kind === 'chevron') {
      svg.append(svgNode('path', { d: 'M4.5 2.5 8 6 4.5 9.5' }));
    } else if (kind === 'folder') {
      svg.append(svgNode('path', { d: 'M1 10V2h4l1 2h5v6Z' }));
    } else if (kind === 'search') {
      svg.append(svgNode('circle', { cx: '5', cy: '5', r: '3' }));
      svg.append(svgNode('path', { d: 'M7.5 7.5 11 11' }));
    } else {
      const shapes = {
        document: 'M3 1h4l3 3v7H3ZM7 1v3h3',
        filter: 'M1 2h10L7 6v4l-2 1V6Z',
        copy: 'M4 4h7v7H4ZM8 2V1H1v7h1',
        comment: 'M1 1h10v7H5l-3 3V8H1Z'
      };
      svg.append(svgNode('path', { d: shapes[kind] }));
    }
    return svg;
  }
  function renderFileTree(nav) {
    const unresolved = openThreads(decorated());
    const tree = buildFileTree(state.files.filter((file) =>
      matchesFileFilter(file.path, state.fileFilter, state.onlyUnresolved, unresolved)));
    const indent = (row, depth) => {
      row.style.setProperty('--indent', `${Math.min(depth, 6) * 12}px`);
    };
    const rootRow = button('', () => {
      location.hash = '';
    }, 'tree-root');
    rootRow.append(el('span', 'tree-name', state.diff.repo));
    rootRow.title = state.diff.repo;
    rootRow.append(el('span', 'tree-viewed'));
    if (!state.focus) rootRow.setAttribute('aria-current', 'page');
    nav.append(rootRow);
    const appendChildren = (host, node, depth) => {
      for (const directory of node.dirs) {
        const details = el('details', 'tree-dir');
        details.open = !state.treeClosed.has(directory.path);
        const summary = el('summary');
        indent(summary, depth);
        summary.append(
          treeGlyph('chevron'), treeGlyph('folder'), el('span', 'tree-name', directory.name)
        );
        summary.title = directory.path;
        summary.append(el('span', 'tree-viewed'));
        const remember = (open) => {
          if (open) state.treeClosed.delete(directory.path);
          else state.treeClosed.add(directory.path);
        };
        summary.addEventListener('click', () => remember(!details.open));
        details.addEventListener('toggle', () => {
          if (details.isConnected) remember(details.open);
        });
        details.append(summary);
        appendChildren(details, directory, depth + 1);
        host.append(details);
      }
      for (const file of node.files) {
        const linkRow = el('div', 'file-link');
        indent(linkRow, depth);
        const link = el('a', '', file.path.split('/').pop());
        link.title = file.path;
        link.href = focusTarget.toHash(file.path);
        if (state.focus === file.path) link.setAttribute('aria-current', 'page');
        const viewed = isReviewed(file);
        linkRow.classList.toggle('is-viewed', viewed);
        const tick = button(viewed ? '✓' : '', () => {
          write(viewedKey(dataBase, file.path, fileContentHash(file)), viewed ? '0' : '1');
          state.collapsed.set(file.path, !viewed);
          renderAfterToggle(file.path, !viewed);
        }, 'tree-viewed');
        tick.setAttribute('aria-pressed', String(viewed));
        tick.setAttribute('aria-label', `Mark ${file.path} as viewed`);
        tick.title = viewed ? 'Mark as unviewed' : 'Mark as viewed';
        const mark = statusMark(file);
        const status = el('span', 'status-mark');
        status.append(treeGlyph('document'));
        linkRow.title = `${file.path}: ${mark.label}`;
        linkRow.setAttribute('aria-label', linkRow.title);
        link.setAttribute('aria-label', linkRow.title);
        linkRow.append(status, link, tick);
        host.append(linkRow);
      }
    };
    appendChildren(nav, tree, 1);
  }
  let headerFrame = null;
  function scheduleHeaderSync() {
    if (headerFrame !== null) return;
    headerFrame = requestAnimationFrame(() => {
      headerFrame = null;
      for (const section of root.querySelectorAll('section.file')) {
        const header = section.querySelector('.file-header');
        const stuck = headerIsStuck(
          section.getBoundingClientRect().top,
          header.getBoundingClientRect().top,
          parseFloat(getComputedStyle(section).borderTopWidth)
        );
        if (header.classList.contains('stuck') !== stuck) {
          header.classList.toggle('stuck', stuck);
        }
      }
    });
  }
  window.addEventListener('scroll', scheduleHeaderSync, { passive: true });
  window.addEventListener('resize', scheduleHeaderSync);
  function renderAfterToggle(toggled, folded) {
    const stickyTop = progressRule.getBoundingClientRect().bottom;
    const sections = [...root.querySelectorAll('section.file')].map((section) => {
      const { top, bottom } = section.getBoundingClientRect();
      return { path: section.dataset.path, top, bottom };
    });
    const anchor = readingAnchor(sections, stickyTop);
    render();
    const pageTops = Object.fromEntries([...root.querySelectorAll('section.file')].map((section) =>
      [section.dataset.path, section.getBoundingClientRect().top + window.scrollY]));
    const target = scrollAfterToggle({
      anchor, toggled, folded, pageTops, order: sections.map((section) => section.path), stickyTop
    });
    if (target !== null) window.scrollTo(0, target);
    scheduleHeaderSync();
  }
  function render() {
    dismissTextSelection();
    for (const child of [...root.children]) {
      if (child !== progressRule) child.remove();
    }
    const all = decorated(),
      threads = state.onlyOpen ? openThreads(all) : all;
    toolbar = el('header', 'toolbar');
    const identity = el('div', 'identity');
    const metadata = el('div', 'metadata');
    metadata.append(el('strong', 'repo', state.diff.repo));
    metadata.append(document.createTextNode(` · ${state.diff.branch}`));
    const base = (state.diff.baseCommit || state.diff.base).slice(0, 8);
    identity.append(metadata, el('div', 'revision',
      `${base} · ${formatRelativeTime(state.diff.generatedAt)}`));
    const counts = totals(state.files);
    const changeTotals = el('div', 'change-totals', `${counts.files} files · `);
    changeTotals.append(
      el('span', 'add-count', `+${counts.additions}`),
      document.createTextNode(' '),
      el('span', 'del-count', `-${counts.deletions}`)
    );
    identity.append(changeTotals);
    toolbar.append(identity);
    const progress = reviewProgress(state.files, isReviewed);
    const open = openThreads(all).length;
    const progressLabel = progress.complete
      ? button(open ? `${open} open · Copy prompt` : 'All resolved · Copy prompt', copyPrompt)
      : el('span', '', `${progress.viewed} of ${progress.total} reviewed`);
    progressLabel.className = 'progress-label';
    if (progress.complete && open) progressLabel.classList.add('open-count');
    toolbar.append(progressLabel);
    progressRule.setAttribute('role', 'progressbar');
    progressRule.setAttribute('aria-label', 'Files reviewed');
    progressRule.setAttribute('aria-valuemin', '0');
    progressRule.setAttribute('aria-valuemax', String(progress.total));
    progressRule.setAttribute('aria-valuenow', String(progress.viewed));
    progressFill.style.width = `${progress.ratio * 100}%`;
    const actions = el('div', 'actions');
    toolbar.append(actions);
    const modes = el('div', 'view-modes');
    modes.setAttribute('role', 'group');
    modes.setAttribute('aria-label', 'Diff layout');
    for (const mode of ['inline', 'split']) {
      const b = button(mode === 'inline' ? 'Inline' : 'Split', () => {
        state.mode = mode;
        if (state.focus) state.focusMode = mode;
        write('hunkboard:view', mode);
        render();
      });
      b.setAttribute('aria-pressed', String(viewMode() === mode));
      modes.append(b);
    }
    actions.append(modes);
    const overflow = el('div', 'overflow');
    const more = button('More', () => {
      const open = overflow.classList.toggle('is-open');
      more.setAttribute('aria-expanded', String(open));
    }, 'more');
    more.setAttribute('aria-expanded', 'false');
    more.setAttribute('aria-controls', 'review-actions');
    more.setAttribute('aria-label', 'More review actions');
    const menu = el('div', 'action-menu');
    menu.id = 'review-actions';
    overflow.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      overflow.classList.remove('is-open');
      more.setAttribute('aria-expanded', 'false');
      more.focus();
    });
    menu.append(button('Copy prompt', copyPrompt));
    overflow.append(more, menu);
    actions.append(overflow);
    const filter = el('label', 'open-filter');
    const checkbox = el('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.onlyOpen;
    checkbox.addEventListener('change', () => {
      state.onlyOpen = checkbox.checked;
      render();
    });
    filter.append(checkbox, document.createTextNode('Open only'));
    menu.append(filter);
    const oldNotice = notice?.title;
    notice = el('span', 'save-notice');
    notice.setAttribute('role', 'status');
    setNotice(oldNotice || (local.length ? localNotice : ''));
    identity.append(notice);
    if (!progressRule.isConnected) root.append(progressRule);
    root.insertBefore(toolbar, progressRule);
    const layout = el('div', 'layout'),
      sidebar = el('aside', 'sidebar');
    sidebar.id = 'hb-sidebar';
    const main = el('main');
    layout.append(sidebar, main);
    root.append(layout);
    syncSidebar();
    if (!state.files.length)
      main.append(el('p', 'empty-state', `Nothing changed since ${state.diff.base}`));
    if (state.focus) {
      const index = state.files.findIndex((file) => file.path === state.focus);
      const bar = el('div', 'focus-bar');
      const previous = button('‹ Previous', () => {
        location.hash = focusTarget.toHash(state.files[index - 1].path);
      });
      const next = button('Next ›', () => {
        location.hash = focusTarget.toHash(state.files[index + 1].path);
      });
      previous.disabled = index <= 0;
      next.disabled = index < 0 || index === state.files.length - 1;
      bar.append(
        button('All files', () => { location.hash = ''; }),
        previous,
        next,
        el('span', '', `${index + 1} of ${state.files.length}`)
      );
      main.append(bar);
      if (index < 0) main.append(el('p', 'file-notice', 'File is not in this diff'));
    }
    const placed = new Set();
    state.files.forEach((file, index) => {
      if (state.focus && state.focus !== file.path) return;
      const section = el('section', 'file');
      section.id = `file-${index}`;
      section.dataset.path = file.path;
      const header = el('div', 'file-header');
      const collapsed = state.collapsed.get(file.path) ?? (!state.focus && isReviewed(file));
      const toggle = button('', () => {
        state.collapsed.set(file.path, !collapsed);
        renderAfterToggle(file.path, !collapsed);
      }, 'file-toggle');
      const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      chevron.setAttribute('viewBox', '0 0 16 16');
      chevron.setAttribute('width', '16');
      chevron.setAttribute('height', '16');
      chevron.setAttribute('aria-hidden', 'true');
      const chevronPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      chevronPath.setAttribute('d', collapsed
        ? 'M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z'
        : 'M12.78 5.22a.749.749 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.06 0L3.22 6.28a.749.749 0 1 1 1.06-1.06L8 8.939l3.72-3.719a.749.749 0 0 1 1.06 0Z');
      chevron.append(chevronPath);
      toggle.append(chevron);
      toggle.setAttribute('aria-label', `Toggle ${file.path}`);
      toggle.setAttribute('aria-expanded', String(!collapsed));
      const path = el('div', 'file-path');
      const pathLine = el('div', 'file-path-line');
      const content = state.diff.files?.[file.path];
      const canViewWholeFile = state.focus !== file.path && fullFileLines(file, content) !== null;
      const pathLabel = file.status === 'renamed' ? `${file.oldPath} → ${file.newPath}` : file.path;
      const pathText = el('strong');
      if (canViewWholeFile) {
        const link = el('a', '', pathLabel);
        link.href = focusTarget.toHash(file.path);
        pathText.append(link);
      } else {
        pathText.textContent = pathLabel;
      }
      pathLine.append(pathText);
      const copy = button('', () => copyPath(file.path), 'copy-path');
      copy.append(treeGlyph('copy'));
      copy.setAttribute('aria-label', `Copy path ${file.path}`);
      copy.title = 'Copy path';
      pathLine.append(copy);
      path.append(pathLine);
      const notes = [];
      if (file.isBinary || content?.binary) notes.push('Binary file');
      if (content?.truncated) notes.push('Content omitted: size limit exceeded');
      const modeLabel = modeChangeLabel(file);
      if (modeLabel) notes.push(modeLabel);
      if (file.similarity !== undefined) notes.push(`${file.similarity}% similar`);
      if (notes.length) path.append(el('div', 'file-meta', notes.join(' · ')));
      const meter = el('span', 'diffstat');
      meter.setAttribute('aria-hidden', 'true');
      for (const color of diffstatSquares(file.additions, file.deletions)) {
        meter.append(el('span', `diffstat-square ${color}`));
      }
      header.append(
        toggle,
        path,
        el('span', 'add-count', `+${file.additions}`),
        el('span', 'del-count', `−${file.deletions}`),
        meter,
        viewedControl(file)
      );
      const count = all.filter((thread) => thread.filePath === file.path).length;
      const comments = button('', () => {
        if (collapsed) {
          state.collapsed.set(file.path, false);
          render();
        }
        clearSelection();
        const host = document.getElementById(`file-${index}`).querySelector('.file-header');
        composer(host, (body, author) => {
          state.threads.push(createThread({ filePath: file.path, scope: 'file', body, author }));
        }, 'Comment on this file', 'Comment', false, 'file');
      }, 'file-comments');
      comments.append(treeGlyph('comment'));
      if (count) comments.append(document.createTextNode(String(count)));
      comments.setAttribute('aria-label', 'Comment on this file');
      header.append(comments, fileMenu(file, canViewWholeFile));
      section.append(header);
      main.append(section);
      if (!collapsed) {
        for (const thread of fileThreads(threads, file.path)) {
          section.append(threadCard(thread));
          placed.add(thread.id);
        }
      }
      const whole = state.focus ? fullFileLines(file, content) : null;
      if (state.focus && whole === null) {
        section.append(el('p', 'file-notice', 'Whole-file view is not available for this file'));
      }
      if (collapsed) return;
      const code = el('div', 'diff-code');
      const clip = el('div', 'diff-clip');
      clip.append(code);
      section.append(clip);
      if (whole !== null) {
        addRows(code, file, whole, threads, placed);
      } else {
        const gap = (newStart, end, oldStart, label = '') => {
          const band = el('div', `hunk-row ${viewMode()}`);
          const gutter = el('div', 'hunk-gutter');
          const key = `${file.path}:${newStart}:${end}`;
          const available = !content?.truncated && typeof content?.new === 'string' &&
            typeof content?.old === 'string' && end >= newStart;
          if (available && state.expanded.has(key)) {
            addRows(code, file, gapLines(content.new, newStart, end, oldStart), threads, placed);
          } else if (available) {
            const expand = button('···', () => {
              state.expanded.add(key);
              render();
            }, 'expand-context');
            expand.setAttribute('aria-label', `Expand ${end - newStart + 1} lines of context`);
            gutter.append(expand);
          }
          if (!label && !gutter.childElementCount) return;
          band.append(gutter, el('div', 'hunk-header', label));
          if (viewMode() === 'split') {
            band.append(el('div', 'hunk-gutter'), el('div', 'hunk-header'));
          }
          code.append(band);
        };
        let oldEnd = 1,
          newEnd = 1;
        for (const hunk of file.hunks) {
          gap(newEnd, hunk.newStart - 1, oldEnd,
            `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@` +
            (hunk.section ? ` ${hunk.section}` : ''));
          addRows(code, file, hunk.lines, threads, placed);
          oldEnd = hunk.oldStart + hunk.oldLines;
          newEnd = hunk.newStart + hunk.newLines;
        }
        if (typeof content?.new === 'string') {
          const lines = content.new.split('\n');
          if (lines.at(-1) === '') lines.pop();
          gap(newEnd, lines.length, oldEnd);
        }
      }
      const unplaced = threads.filter((t) => t.filePath === file.path && !placed.has(t.id));
      if (unplaced.length) {
        section.append(el('p', 'file-notice', 'Comments outside the visible diff'));
        for (const t of unplaced) {
          section.append(threadCard(t));
          placed.add(t.id);
        }
      }
    });
    const missing = threads.filter(
      (t) => !placed.has(t.id) && !state.files.some((f) => f.path === t.filePath)
    );
    if (!state.focus && missing.length) {
      main.append(el('h2', '', 'Comments on files outside this diff'));
      for (const t of missing) {
        main.append(el('p', '', t.filePath), threadCard(t));
      }
    }
    scheduleHeaderSync();
  }
  async function load(name, required = false) {
    try {
      const response = await fetch(`${dataBase}${name}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (required) throw error;
      return null;
    }
  }
  Promise.all([load('diff.json', true), load('comments.json'), load('resolutions.json')])
    .then(([diff, comments, resolutions]) => {
      state.diff = diff;
      state.files = treeOrder(parseDiff(diff.rawDiff).files);
      state.resolutions = resolutions;
      state.threads = mergeThreads(comments?.threads, local);
      render();
    })
    .catch(() => {
      root.replaceChildren(
        el(
          'p',
          'empty-state',
          `Could not load diff.json from ${
            dataBase
          }diff.json. Check the review URL and publish the diff first.`
        )
      );
    });
})();
