// session-widget.js — Session switcher UI
// Requires sessions.js to be loaded first

(function initSessionWidget() {
  // ── Styles ──────────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    #session-trigger {
      position: fixed;
      background: none;
      border: none;
      padding: 0;
      color: #fcf6ff;
      font-size: 34px;
      cursor: pointer;
      z-index: 9998;
      transition: color 0.25s ease, transform 0.2s ease;
    }
    #session-trigger:hover { color: #d4af37; transform: scale(1.08); }
    #session-trigger svg { width: 34px; height: 34px; stroke-width: 2; vertical-align: middle; }

    #session-panel {
      position: fixed;
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 10px;
      width: 240px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.7);
      overflow-x: hidden;
      overflow-y: auto;
      display: none;
      z-index: 9997;
      font-family: 'Inter', sans-serif;
      font-size: 13px;
    }
    #session-panel.open { display: block; }

    .session-panel-header {
      padding: 10px 14px 8px;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #888;
      border-bottom: 1px solid #2a2a2a;
    }

    .session-list {
      padding: 6px 0;
      max-height: 220px;
      overflow-y: auto;
    }

    .session-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 14px;
      cursor: pointer;
      transition: background 0.1s;
      position: relative;
    }
    .session-item:hover { background: #222; }
    .session-item.active { background: rgba(212,175,55,0.08); }

    .session-item .s-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #444;
      flex-shrink: 0;
    }
    .session-item.active .s-dot { background: #d4af37; }

    .session-item .s-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #fcf6ff;
    }
    .session-item.active .s-name { color: #d4af37; font-weight: 600; }

    .session-item .s-actions { display: none; gap: 4px; }
    .session-item:hover .s-actions { display: flex; }

    .session-item .s-actions button {
      background: none;
      border: none;
      color: #888;
      cursor: pointer;
      padding: 2px 4px;
      border-radius: 4px;
      font-size: 11px;
      transition: color 0.1s, background 0.1s;
    }
    .session-item .s-actions button:hover { color: #fcf6ff; background: #333; }
    .session-item .s-actions button.del:hover { color: #ff5555; }

    .session-panel-footer {
      border-top: 1px solid #2a2a2a;
      padding: 8px;
    }
    #session-add-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      width: 100%;
      padding: 8px;
      background: none;
      border: 1px dashed #333;
      border-radius: 6px;
      color: #888;
      cursor: pointer;
      font-size: 12px;
      font-family: 'Inter', sans-serif;
      transition: border-color 0.15s, color 0.15s;
    }
    #session-add-btn:hover { border-color: #d4af37; color: #d4af37; }

    .session-cache-warning {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      margin-top: 8px;
      padding: 7px 9px;
      background: rgba(255, 85, 85, 0.07);
      border: 1px solid rgba(255, 85, 85, 0.25);
      border-radius: 6px;
      font-size: 10.5px;
      color: #ff8888;
      line-height: 1.4;
    }
    .session-cache-warning svg {
      flex-shrink: 0;
      width: 13px;
      height: 13px;
      margin-top: 1px;
    }

    .session-item .s-rename-input {
      flex: 1;
      min-width: 0;
      width: 0;
      background: #2a2a2a;
      border: 1px solid #d4af37;
      color: #fcf6ff;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 13px;
      font-family: 'Inter', sans-serif;
      outline: none;
      box-sizing: border-box;
    }
  `;
  document.head.appendChild(style);

  // ── DOM ──────────────────────────────────────────────────────────────────────
  const trigger = document.createElement('button');
  trigger.id = 'session-trigger';
  trigger.title = 'Switch session';
  trigger.innerHTML = '<i data-lucide="circle-user"></i>';
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
