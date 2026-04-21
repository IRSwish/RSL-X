// session-widget.js — Session switcher UI
// Requires sessions.js to be loaded first

(function initSessionWidget() {
  // ── Styles ──────────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    #session-trigger {
      position: fixed;
      background: rgba(0,0,0,0.35);
      border: 1px solid rgba(201,169,106,0.5);
      border-radius: 0;
      padding: 5px;
      color: #c9a96a;
      cursor: pointer;
      z-index: 9998;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      transition: color 0.2s ease, background 0.2s ease, border-color 0.2s ease;
    }
    #session-trigger:hover {
      color: #0a0a0a;
      background: #c9a96a;
      border-color: #c9a96a;
    }
    #session-trigger svg { width: 20px; height: 20px; stroke-width: 1.5; vertical-align: middle; }

    #session-panel {
      position: fixed;
      background: linear-gradient(180deg, rgba(22,18,16,0.98), rgba(10,8,8,0.98));
      border: 1px solid rgba(201,169,106,0.5);
      border-radius: 0;
      width: 260px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.75), 0 0 0 1px rgba(0,0,0,0.6);
      overflow-x: hidden;
      overflow-y: auto;
      display: none;
      z-index: 9997;
      font-family: 'Cormorant Garamond', serif;
      font-size: 14px;
      color: #e8e0d2;
    }
    #session-panel.open { display: block; }

    .session-panel-header {
      padding: 10px 14px 8px;
      font-family: 'MedievalSharp', 'Cinzel', serif;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 2px;
      color: #c9a96a;
      border-bottom: 1px solid rgba(201,169,106,0.25);
    }

    .session-list {
      padding: 6px 0;
      max-height: 220px;
      overflow-y: auto;
    }

    .session-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 14px;
      cursor: pointer;
      transition: background 0.15s ease;
      position: relative;
    }
    .session-item:hover { background: rgba(201,169,106,0.08); }
    .session-item.active { background: rgba(201,169,106,0.14); border-left: 2px solid #c9a96a; }

    .session-item .s-dot {
      width: 7px;
      height: 7px;
      background: rgba(201,169,106,0.3);
      border: 1px solid rgba(201,169,106,0.5);
      flex-shrink: 0;
      transform: rotate(45deg);
    }
    .session-item.active .s-dot { background: #c9a96a; border-color: #c9a96a; }

    .session-item .s-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #e8e0d2;
      font-weight: 500;
      font-size: 15px;
      letter-spacing: 0.3px;
    }
    .session-item.active .s-name { color: #f1ddb1; font-weight: 700; }

    .session-item .s-actions { display: none; gap: 4px; }
    .session-item:hover .s-actions { display: flex; }

    .session-item .s-actions button {
      background: transparent;
      border: 1px solid rgba(201,169,106,0.35);
      color: #c9a96a;
      cursor: pointer;
      padding: 3px 5px;
      border-radius: 0;
      font-size: 11px;
      line-height: 1;
      transition: color 0.15s ease, background 0.15s ease, border-color 0.15s ease;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .session-item .s-actions button:hover { color: #0a0a0a; background: #c9a96a; border-color: #c9a96a; }
    .session-item .s-actions button.del:hover { color: #fff; background: #a8324a; border-color: #a8324a; }
    .session-item .s-actions svg { width: 13px; height: 13px; stroke-width: 1.7; }

    .session-panel-footer {
      border-top: 1px solid rgba(201,169,106,0.25);
      padding: 10px;
      background: rgba(0,0,0,0.3);
    }
    #session-add-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      width: 100%;
      padding: 7px 10px;
      background: transparent;
      border: 1px solid rgba(201,169,106,0.5);
      border-radius: 0;
      color: #c9a96a;
      cursor: pointer;
      font-family: 'Cormorant Garamond', serif;
      font-size: 14px;
      font-weight: 600;
      letter-spacing: 0.5px;
      transition: color 0.15s ease, background 0.15s ease, border-color 0.15s ease;
    }
    #session-add-btn:hover { color: #0a0a0a; background: #c9a96a; border-color: #c9a96a; }

    .session-cache-warning {
      display: flex;
      align-items: flex-start;
      gap: 7px;
      margin-top: 10px;
      padding: 8px 10px;
      background: rgba(168,50,74,0.08);
      border: 1px solid rgba(168,50,74,0.4);
      border-radius: 0;
      font-family: 'Cormorant Garamond', serif;
      font-size: 12px;
      color: #d89fad;
      line-height: 1.4;
    }
    .session-cache-warning svg {
      flex-shrink: 0;
      width: 14px;
      height: 14px;
      margin-top: 1px;
      color: #a8324a;
    }

    .session-item .s-rename-input {
      flex: 1;
      min-width: 0;
      width: 0;
      background: rgba(0,0,0,0.5);
      border: 1px solid #c9a96a;
      color: #f1ddb1;
      padding: 3px 6px;
      border-radius: 0;
      font-size: 14px;
      font-family: 'Cormorant Garamond', serif;
      outline: none;
      box-sizing: border-box;
    }
  `;
  document.head.appendChild(style);

  // ── DOM ──────────────────────────────────────────────────────────────────────
  const trigger = document.createElement('button');
  trigger.id = 'session-trigger';
  trigger.title = 'Switch session';
  trigger.innerHTML = '<i data-lucide="user"></i>';
  document.body.appendChild(trigger);

  const panel = document.createElement('div');
  panel.id = 'session-panel';
  panel.innerHTML = `
    <div class="session-panel-header">Sessions</div>
    <div class="session-list" id="session-list"></div>
    <div class="session-panel-footer">
      <button id="session-add-btn">＋ New session</button>
      <div class="session-cache-warning">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        Clearing your browser's site data will permanently delete all sessions and progress.
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  const listEl  = document.getElementById('session-list');
  const addBtn  = document.getElementById('session-add-btn');
  const SM      = window.SessionManager;

  // Position trigger directly below info-btn, right-aligned with it
  // Falls back to top-right if no info-btn exists
  function alignBelowInfoBtn() {
    const infoBtn = document.getElementById('info-btn');
    const gap = 8;
    if (!infoBtn) {
      trigger.style.top   = '12px';
      trigger.style.right = '12px';
      requestAnimationFrame(() => {
        panel.style.top   = (trigger.getBoundingClientRect().bottom + gap) + 'px';
        panel.style.right = '12px';
      });
      return;
    }
    const cs = getComputedStyle(infoBtn);
    const cssRight  = parseFloat(cs.right)         || 0;
    const prRight   = parseFloat(cs.paddingRight)  || 0;
    const pbBottom  = parseFloat(cs.paddingBottom) || 0;
    const rect = infoBtn.getBoundingClientRect();
    // Align trigger's right edge with info-btn's icon right edge (strip padding)
    const rightVal = cssRight + prRight;
    // Place trigger 8px below info-btn's icon bottom (strip bottom padding)
    trigger.style.top   = (rect.bottom - pbBottom + gap) + 'px';
    trigger.style.right = rightVal + 'px';
    requestAnimationFrame(() => {
      panel.style.top   = (trigger.getBoundingClientRect().bottom + gap) + 'px';
      panel.style.right = rightVal + 'px';
    });
  }
  // Wait for load, then also watch for Lucide injecting the SVG into info-btn
  // (ResizeObserver fires as soon as the button gets its real height)
  window.addEventListener('load', () => {
    alignBelowInfoBtn();
    const infoBtn = document.getElementById('info-btn');
    if (infoBtn) {
      new ResizeObserver(alignBelowInfoBtn).observe(infoBtn);
    }
  });
  window.addEventListener('resize', alignBelowInfoBtn);

  // Render Lucide icon
  const renderIcon = () => {
    if (window.lucide?.createIcons) lucide.createIcons({ nodes: [trigger] });
    else setTimeout(renderIcon, 200);
  };
  renderIcon();

  // ── Render list ───────────────────────────────────────────────────────────
  function render() {
    const sessions = SM.getSessions();
    const activeId = SM.getActiveId();

    listEl.innerHTML = '';
    sessions.forEach(s => {
      const item = document.createElement('div');
      item.className = 'session-item' + (s.id === activeId ? ' active' : '');
      item.dataset.id = s.id;
      item.innerHTML = `
        <span class="s-dot"></span>
        <span class="s-name">${escHtml(s.name)}</span>
        <span class="s-actions">
          <button class="ren" title="Rename">✏️</button>
          ${sessions.length > 1 ? `<button class="del" title="Delete">🗑</button>` : ''}
        </span>
      `;

      item.addEventListener('click', (e) => {
        if (e.target.closest('.s-actions') || e.target.closest('.s-rename-input')) return;
        if (s.id === activeId) { closePanel(); return; }
        SM.setActive(s.id);
        location.reload();
      });

      item.querySelector('.ren')?.addEventListener('click', (e) => {
        e.stopPropagation();
        startRename(item, s);
      });

      item.querySelector('.del')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!confirm(`Delete session "${s.name}"? All its data will be lost.`)) return;
        SM.remove(s.id);
        if (s.id === activeId) location.reload();
        else render();
      });

      listEl.appendChild(item);
    });
  }

  function startRename(item, session) {
    const nameSpan = item.querySelector('.s-name');
    const input = document.createElement('input');
    input.className = 's-rename-input';
    input.value = session.name;
    nameSpan.replaceWith(input);
    input.focus();
    input.select();

    const commit = () => {
      const val = input.value.trim();
      if (val && val !== session.name) SM.rename(session.id, val);
      render();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') render();
    });
  }

  function closePanel() { panel.classList.remove('open'); }

  function escHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Events ────────────────────────────────────────────────────────────────
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) render();
  });

  addBtn.addEventListener('click', () => {
    const name = prompt('Session name:', 'Account ' + (SM.getSessions().length + 1));
    if (!name?.trim()) return;
    const id = SM.create(name.trim());
    SM.setActive(id);
    location.reload();
  });

  document.addEventListener('click', (e) => {
    if (!panel.contains(e.target) && e.target !== trigger) closePanel();
  });
})();
