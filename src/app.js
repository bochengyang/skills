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
  const viewMode = () => state.focus
    ? (window.innerWidth < 768 ? 'inline' : state.focusMode)
    : state.mode;
  const narrowScreen = window.matchMedia('(max-width: 767px)');
  narrowScreen.addEventListener('change', () => {
    if (state.diff && state.focus) render();
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
      sidebar.append(tree);
    }
  }

  let notice,
    revision = 0,
    saving = false,
    savedTimer;
  const decorated = () => applyResolutions(state.threads, state.resolutions);
  function setNotice(text) {
    notice.textContent = text;
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
    header.append(el('span', '', `${title} as `));
    const author = el('input');
    author.placeholder = 'Your name';
    author.setAttribute('aria-label', 'Your name');
    author.value = read('hunkboard:author') || '';
    author.required = true;
    if (author.value) {
      const name = el('strong', '', author.value);
      const change = button('Change name', () => {
        name.remove();
        change.replaceWith(author);
        author.focus();
      }, 'link-button');
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
  function composer(host, submit, title, action = 'Add comment', nameOnly = false) {
    hideTextComment();
    textPreview = null;
    dismissComposer();
    const node = el('form', 'comment-form');
    const getAuthor = identity(node, title);
    const body = el('textarea');
    body.placeholder = 'Leave a comment';
    body.setAttribute('aria-label', 'Comment');
    body.required = true;
    body.autofocus = true;
    const cancel = () => {
      node.remove();
      clearSelection();
      host.querySelector('button')?.focus();
    };
    const add = el('button', 'primary', action);
    add.type = 'submit';
    if (!nameOnly) node.append(body);
    node.append(add, button('Cancel', cancel));
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
    dismissComposer = () => node.remove();
    host.after(node);
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
    const closed = ['resolved', 'wontfix'].includes(threadState(thread));
    const card = el('div', 'thread');
    card.dataset.threadId = thread.id;
    const content = el('div', 'thread-content');
    const statuses = { resolved: 'Resolved', wontfix: "Won't fix", 'needs-info': 'Needs info' };
    if (closed) {
      const label = thread.resolved
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
      summary.append(el('span', '', `${label} · `), toggle);
      card.append(summary);
    }
    for (const message of thread.messages) {
      const item = el('div', 'message');
      const header = el('div', 'message-header');
      const avatar = el('span', 'avatar', avatarLetter(message.author));
      avatar.setAttribute('aria-hidden', 'true');
      header.append(avatar, el('strong', '', message.author), relativeTime(message.createdAt));
      item.append(header, el('p', '', message.body));
      content.append(item);
    }
    if (thread.resolution) {
      const { by, status, at, note } = thread.resolution;
      const system = el('div', 'resolution');
      const header = el('div', 'message-header');
      header.append(el('span', '', `⚙ ${by} · ${statuses[status]}`), relativeTime(at));
      system.append(header);
      if (note) system.append(el('p', '', note));
      content.append(system);
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
        body.placeholder = 'Reply…';
        body.setAttribute('aria-label', 'Reply');
        body.required = true;
        body.value = input.value;
        const send = el('button', 'primary', 'Reply');
        send.type = 'submit';
        form.append(body, send, button('Cancel', collapseReply));
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
        composer(card, update, action, action, true);
        return;
      }
      update('', author);
      render();
      persist();
    });
    footer.append(replyHost, resolve);
    content.append(footer);
    card.append(content);
    return card;
  }
  function sourceLines(file, side) {
    const text = state.diff.files?.[file.path]?.[side];
    if (typeof text === 'string') return text.split('\n');
    const map = [];
    file.hunks.forEach((h) =>
      h.lines.forEach((l) => {
        const n = l[`${side}Line`];
        if (n !== null) map[n - 1] = l.content;
      })
    );
    return map;
  }
  const selectionControls = new WeakMap();
  let drag = null;
  function paintRow(row) {
    const selected = ['old', 'new'].map((side) => {
      const line = row.dataset[side];
      const active = isSelected(textPreview || state.selection, row.dataset.path, side,
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
  let textPreview = null;
  function hideTextComment() {
    clearTimeout(selectionTimer);
    textComment?.remove();
    textComment = null;
  }
  function dismissTextSelection() {
    hideTextComment();
    if (textPreview) {
      textPreview = null;
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
      ? (cell === row.children[1] ? 'old' : 'new')
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
    textPreview = selection;
    paintSelection();
    const activate = (event) => {
      if (event.type === 'pointerdown' && event.button !== 0) return;
      event.preventDefault();
      textPreview = null;
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
    textPreview = null;
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
    textPreview = null;
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
    composer(
      host,
      (body, author) =>
        state.threads.push(
          createThread({ filePath: file.path, side, line: range, codeSnapshot, body, author })
        ),
      `Commenting on ${side} ${start === end ? `line ${start}` : `lines ${start}–${end}`}`
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
        if ((line.type === 'del' && part.added) || (line.type === 'add' && part.removed)) continue;
        const span = el('span', part.added || part.removed ? 'word-change' : '');
        syntax(span, part.value, file.path);
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
        const words = window.Diff.diffWordsWithSpace(left.content, right.content);
        wordMap.set(left, words);
        wordMap.set(right, words);
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
      const cell = el('span', 'gutter-cell');
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
          codeCell(left, file, wordMap.get(left)),
          gutter(right, 'new', row),
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
          el('span', 'sign', line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' '),
          codeCell(line, file, wordMap.get(line))
        );
        paintRow(row);
        container.append(row);
        attach(row, 'old', line.oldLine);
        attach(row, 'new', line.newLine);
      }
  }
  function isReviewed(file) {
    return read(viewedKey(dataBase, file.path, fileContentHash(file))) === '1';
  }
  function viewedControl(file) {
    const label = el('label', 'viewed');
    const input = el('input');
    input.type = 'checkbox';
    input.checked = isReviewed(file);
    input.addEventListener('change', () => {
      write(viewedKey(dataBase, file.path, fileContentHash(file)), input.checked ? '1' : '0');
      state.collapsed.set(file.path, input.checked);
      render();
    });
    label.append(input, document.createTextNode('Viewed'));
    return label;
  }
  async function copyPrompt(event) {
    const target = event.currentTarget;
    const text = formatPrompt(openThreads(decorated()));
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
      target.textContent = 'Copied';
      setTimeout(() => {
        copy.textContent = 'Copy prompt';
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
  let toolbar, copy;
  function statCell(node) {
    const cell = el('span', 'tree-stat');
    const stat = formatStat(node);
    if (stat) {
      cell.append(
        el('span', 'add-count', stat.additions),
        document.createTextNode(' '),
        el('span', 'del-count', stat.deletions)
      );
    }
    return cell;
  }
  function renderFileTree(nav) {
    const tree = buildFileTree(state.files);
    const indent = (row, depth) => {
      row.style.setProperty('--indent', `${Math.min(depth, 6) * 14}px`);
    };
    const rootRow = button('', () => {
      location.hash = '';
    }, 'tree-root');
    rootRow.append(el('span', 'tree-name', state.diff.repo));
    rootRow.title = state.diff.repo;
    rootRow.append(el('span', 'tree-count', String(state.files.length)));
    rootRow.append(statCell(tree), el('span', 'tree-viewed'), el('span', 'status-mark'));
    if (!state.focus) rootRow.setAttribute('aria-current', 'page');
    nav.append(rootRow);
    const appendChildren = (host, node, depth) => {
      for (const directory of node.dirs) {
        const details = el('details', 'tree-dir');
        details.open = !state.treeClosed.has(directory.path);
        const summary = el('summary');
        indent(summary, depth);
        summary.append(el('span', 'tree-name', directory.name));
        summary.title = directory.path;
        summary.append(
          statCell(directory), el('span', 'tree-viewed'), el('span', 'status-mark')
        );
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
          render();
        }, 'tree-viewed');
        tick.setAttribute('aria-pressed', String(viewed));
        tick.setAttribute('aria-label', `Mark ${file.path} as viewed`);
        tick.title = viewed ? 'Mark as unviewed' : 'Mark as viewed';
        const mark = statusMark(file);
        const status = el('span', `status-mark status-${mark.letter}`, mark.letter);
        status.title = mark.label;
        status.setAttribute('aria-label', mark.label);
        linkRow.append(link, statCell(file), tick, status);
        host.append(linkRow);
      }
    };
    appendChildren(nav, tree, 1);
  }
  function render() {
    dismissTextSelection();
    root.replaceChildren();
    const all = decorated(),
      threads = state.onlyOpen ? openThreads(all) : all;
    toolbar = el('header', 'toolbar');
    toolbar.append(
      el('strong', 'brand', 'hunkboard'),
      el(
        'span',
        'metadata',
        `${state.diff.repo} · ${state.diff.branch} · ${(
          state.diff.baseCommit || state.diff.base
        ).slice(
          0,
          8
        )} · ${formatRelativeTime(state.diff.generatedAt)}`
      )
    );
    const sum = totals(state.files);
    toolbar.append(
      el('span', 'totals', `${sum.files} files`),
      el('span', 'add-count', `+${sum.additions}`),
      el('span', 'del-count', `−${sum.deletions}`),
      el('span', 'open-count', `${openThreads(all).length} open`)
    );
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
    toolbar.append(modes);
    copy = button('Copy prompt', copyPrompt);
    toolbar.append(copy);
    const filter = el('label', 'open-filter');
    const checkbox = el('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.onlyOpen;
    checkbox.addEventListener('change', () => {
      state.onlyOpen = checkbox.checked;
      render();
    });
    filter.append(checkbox, document.createTextNode('Open only'));
    toolbar.append(filter);
    const oldNotice = notice?.textContent;
    notice = el('div', 'save-notice', oldNotice || (local.length ? localNotice : ''));
    notice.setAttribute('role', 'status');
    root.append(toolbar, notice);
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
      const header = el('div', 'file-header');
      const collapsed = state.collapsed.get(file.path) ?? (!state.focus && isReviewed(file));
      const toggle = button(collapsed ? '▸' : '▾', () => {
        state.collapsed.set(file.path, !collapsed);
        render();
      });
      toggle.setAttribute('aria-label', `Toggle ${file.path}`);
      toggle.setAttribute('aria-expanded', String(!collapsed));
      header.append(
        toggle,
        el(
          'strong',
          'file-path',
          file.status === 'renamed' ? `${file.oldPath} → ${file.newPath}` : file.path
        ),
        el('span', 'add-count', `+${file.additions}`),
        el('span', 'del-count', `−${file.deletions}`),
        viewedControl(file)
      );
      section.append(header);
      main.append(section);
      if (file.similarity !== undefined)
        header.append(el('small', '', `${file.similarity}% similar`));
      if (file.oldMode || file.newMode)
        header.append(
          el('small', '', `Mode ${file.oldMode || '—'} → ${file.newMode || '—'}`)
        );
      const content = state.diff.files?.[file.path];
      if (file.isBinary || content?.binary) section.append(el('p', 'file-notice', 'Binary file'));
      if (content?.truncated)
        section.append(el('p', 'file-notice', 'File content omitted: size limit exceeded'));
      const whole = state.focus ? fullFileLines(file, content) : null;
      if (state.focus && whole === null) {
        section.append(el('p', 'file-notice', 'Whole-file view is not available for this file'));
      }
      if (collapsed) return;
      const code = el('div', 'diff-code');
      section.append(code);
      if (whole !== null) {
        addRows(code, file, whole, threads, placed);
      } else {
        const gap = (newStart, end, oldStart) => {
          if (
            content?.truncated ||
            typeof content?.new !== 'string' ||
            typeof content?.old !== 'string' ||
            end < newStart
          )
            return;
          const key = `${file.path}:${newStart}:${end}`;
          if (state.expanded.has(key))
            addRows(code, file, gapLines(content.new, newStart, end, oldStart), threads, placed);
          else
            code.append(
              button(
                `Expand ${end - newStart + 1} lines of context`,
                () => {
                  state.expanded.add(key);
                  render();
                },
                'expand-context'
              )
            );
        };
        let oldEnd = 1,
          newEnd = 1;
        for (const hunk of file.hunks) {
          gap(newEnd, hunk.newStart - 1, oldEnd);
          code.append(
            el(
              'div',
              'hunk-header',
              `@@ -${hunk.oldStart},${hunk.oldLines} +${
                hunk.newStart
              },${hunk.newLines} @@${hunk.section ? ` ${hunk.section}` : ''}`
            )
          );
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
      state.files = parseDiff(diff.rawDiff).files;
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
