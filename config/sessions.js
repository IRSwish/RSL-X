// sessions.js — Session Manager (load BEFORE any data scripts)
// Provides window.SessionManager and window.LS (namespaced localStorage wrapper)

window.SessionManager = (() => {
  const META_KEY   = 'rslx_sessions';
  const ACTIVE_KEY = 'rslx_active_session';

  function getSessions() {
    try { return JSON.parse(localStorage.getItem(META_KEY)) || []; }
    catch { return []; }
  }

  function getActiveId() {
    return localStorage.getItem(ACTIVE_KEY) || null;
  }

  function getActive() {
    const id = getActiveId();
    return getSessions().find(s => s.id === id) || null;
  }

  function saveSessions(sessions) {
    localStorage.setItem(META_KEY, JSON.stringify(sessions));
  }

  // Ensures at least one session exists and one is active
  function ensureDefault() {
    let sessions = getSessions();
    if (sessions.length === 0) {
      sessions = [{ id: 's_default', name: 'Account 1' }];
      saveSessions(sessions);
    }
    const activeId = getActiveId();
    if (!activeId || !sessions.find(s => s.id === activeId)) {
      localStorage.setItem(ACTIVE_KEY, sessions[0].id);
    }
  }

  function setActive(id) {
    localStorage.setItem(ACTIVE_KEY, id);
    window.dispatchEvent(new CustomEvent('rslx-session-change', { detail: { id } }));
  }

  function create(name) {
    const sessions = getSessions();
    const id = 's_' + Date.now();
    sessions.push({ id, name: name || 'Account ' + (sessions.length + 1) });
    saveSessions(sessions);
    return id;
  }

  function rename(id, name) {
    const sessions = getSessions();
    const s = sessions.find(s => s.id === id);
    if (s) { s.name = name; saveSessions(sessions); }
  }

  function remove(id) {
    let sessions = getSessions();
    if (sessions.length <= 1) return; // keep at least one
    sessions = sessions.filter(s => s.id !== id);
    saveSessions(sessions);
    // Clean up namespaced keys for deleted session
    const prefix = id + '::';
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) localStorage.removeItem(key);
    }
    if (getActiveId() === id) {
      setActive(sessions[0].id);
    }
  }

  ensureDefault();

  return { getSessions, getActive, getActiveId, setActive, create, rename, remove, ensureDefault };
})();

// window.LS — drop-in replacement for localStorage, namespaced per active session
window.LS = {
  _prefix() {
    return (window.SessionManager.getActiveId() || 'default') + '::';
  },
  getItem(key) {
    return localStorage.getItem(this._prefix() + key);
  },
  setItem(key, value) {
    localStorage.setItem(this._prefix() + key, value);
  },
  removeItem(key) {
    localStorage.removeItem(this._prefix() + key);
  }
};
