// ============================================================
//  RSL-X — Navigation V2  |  Rail + persistent panel loader
// ============================================================

// 1) CSS critique inline (synchrone). On RÉSERVE l'espace du rail (padding du
//    body) et on garde le menu MASQUÉ (display:none) tant que menu.css n'est pas
//    appliqué : ainsi il n'apparaît jamais dans un état intermédiaire (dim, sans
//    glow/espacements) — il surgit en une fois, déjà entièrement stylé.
//    display:none (et pas visibility) sinon le menu non-stylé occuperait toute
//    sa hauteur "dépliée" et pousserait le contenu (saut de mise en page).
(function injectCriticalCss() {
  if (document.getElementById('rsx-critical-css')) return;
  const s = document.createElement('style');
  s.id = 'rsx-critical-css';
  s.textContent =
    ':root{--rail-w:60px}' +
    'body{padding-left:var(--rail-w)}' +
    '#menu-container{display:none}' +
    'html.rsx-css-ready #menu-container{display:block}' +
    '@media(max-width:768px){:root{--rail-w:52px}}';
  document.head.appendChild(s);
})();

// 2) CSS complet du menu dans le <head>, chargé une seule fois (cache HTTP).
//    On ne révèle le menu qu'une fois la feuille appliquée (onload).
function ensureMenuCss() {
  const ready = () => document.documentElement.classList.add('rsx-css-ready');
  if (document.querySelector('link[data-rsx-menu-css]')) { ready(); return; }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/style/menu.css';
  link.setAttribute('data-rsx-menu-css', '');
  link.onload = ready;
  link.onerror = ready; // en cas d'échec, on révèle quand même
  document.head.appendChild(link);
}
ensureMenuCss();

// 3) Le HTML du menu est identique sur toutes les pages : on le garde en
//    sessionStorage pour le réinjecter SYNCHRONIQUEMENT à chaque navigation
//    (aucune attente réseau → plus de "rechargement" visible du menu).
const MENU_SRC_KEY = 'rsx-menu-src-v2';            // HTML brut (détection de changement)
const MENU_RENDERED_KEY = 'rsx-menu-rendered-v2';  // HTML avec SVG lucide déjà rendus (paint instantané)
let onHashChange = null;   // handler unique, réassigné à chaque (ré)init

function initMenu(html) {
    const host = document.getElementById('menu-container');
    if (!host) {
      console.warn('⚠️ #menu-container introuvable');
      return;
    }
    // Préserve l'icône account VIVANTE (avec ses listeners) avant de réécrire le
    // menu, pour la cas d'un ré-affichage (menu modifié en cours de session).
    const liveTrigger = host.querySelector('#session-trigger');
    host.innerHTML = html;

    // Le slot account est rempli dynamiquement par session-widget.js à chaque
    // page. On le vide après injection pour ne jamais empiler d'anciennes icônes
    // venues du cache (sinon elles s'accumulent à chaque navigation), puis on y
    // replace l'icône vivante si on en avait une.
    const acctSlot = host.querySelector('#rail-account-slot');
    if (acctSlot) {
      acctSlot.innerHTML = '';
      if (liveTrigger) acctSlot.appendChild(liveTrigger);
    }

    // === Icônes Lucide (avec retry tant que la lib n'est pas prête) ===
    const renderIcons = () => {
      if (window.lucide && lucide.createIcons) {
        lucide.createIcons();
        // Mémorise la version RENDUE (SVG inline) : les pages suivantes peignent
        // les icônes instantanément, sans repasser par lucide → plus de flicker.
        // On clone et on VIDE le slot account : injecté dynamiquement, il ne doit
        // pas être mémorisé (sinon accumulation d'icônes à chaque navigation).
        try {
          const clone = host.cloneNode(true);
          const slot = clone.querySelector('#rail-account-slot');
          if (slot) slot.innerHTML = '';
          sessionStorage.setItem(MENU_RENDERED_KEY, clone.innerHTML);
        } catch (e) {}
      } else setTimeout(renderIcons, 150);
    };
    renderIcons();

    const body      = document.body;
    const panel     = document.getElementById('rsx-panel');
    const backdrop  = document.getElementById('rsx-backdrop');
    const railItems = [...document.querySelectorAll('.rail-item[data-section]')];
    const panes     = [...document.querySelectorAll('.rsx-pane[data-section]')];
    const isMobile  = () => window.matchMedia('(max-width: 768px)').matches;

    let current = null; // section affichée dans le panneau

    // === Recalcul fluide pendant l'animation de réservation d'espace ──────────
    // Le padding-left du body s'anime en 0.26s. Plutôt que de notifier la page
    // une seule fois à la fin (ce qui fait "sauter" les calendriers), on pousse
    // un 'resize' à chaque frame pendant la transition : les timelines grandissent
    // en même temps que le conteneur. Un rebuild par frame ne flicke pas (le
    // navigateur ne peint qu'une fois par frame). Inutile sur mobile : le panneau
    // y est en overlay, l'espace réservé ne change pas.
    // On émet un événement DÉDIÉ ('rsx-reflow') plutôt qu'un 'resize' global :
    // seules les timelines l'écoutent. Sinon le 'resize' réinitialise les canvas
    // de bruit de fond à chaque frame → flash/saut.
    let pumpId = null, pumpUntil = 0;
    const pump = () => {
      window.dispatchEvent(new Event('rsx-reflow'));
      if (performance.now() < pumpUntil) pumpId = requestAnimationFrame(pump);
      else { pumpId = null; window.dispatchEvent(new Event('rsx-reflow')); }
    };
    const startReflowPump = () => {
      if (isMobile()) return;
      pumpUntil = performance.now() + 340;   // > durée de transition (260ms)
      if (pumpId === null) pumpId = requestAnimationFrame(pump);
    };

    // === Ouvre / change la section du panneau ===
    const openSection = (section) => {
      const pane = panes.find(p => p.dataset.section === section);
      if (!pane) return;

      panes.forEach(p => p.classList.toggle('active', p === pane));
      railItems.forEach(b => b.classList.toggle('active', b.dataset.section === section));

      const wasOpen = body.classList.contains('rsx-panel-open');
      body.classList.add('rsx-panel-open');
      current = section;
      if (!wasOpen) startReflowPump();   // l'espace ne change qu'à la 1re ouverture
    };

    // === Ferme le panneau (rail seul) ===
    const closePanel = () => {
      const wasOpen = body.classList.contains('rsx-panel-open');
      body.classList.remove('rsx-panel-open');
      railItems.forEach(b => b.classList.remove('active'));
      current = null;
      if (wasOpen) startReflowPump();
    };

    // === Clics sur le rail (boutons de section) ===
    railItems.forEach(btn => {
      btn.addEventListener('click', () => {
        const section = btn.dataset.section;
        if (current === section) closePanel();   // re-clic = referme
        else openSection(section);
      });
    });

    // === Fermeture sur mobile : backdrop + clic sur un lien ===
    backdrop?.addEventListener('click', closePanel);

    // Clic sur un lien du panneau → on referme la sous-nav
    panel?.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', closePanel);
    });

    // === Lien actif d'après l'URL (surlignage seulement, sans ouvrir) ===
    const norm = s => (s || '').toLowerCase().replace(/\/+$/, '');

    const highlightActiveLink = () => {
      const path = norm(window.location.pathname);
      const hash = window.location.hash.toLowerCase();
      const full = norm(`${path}${hash}`);

      panel.querySelectorAll('.active-link').forEach(a => a.classList.remove('active-link'));

      const links = [...panel.querySelectorAll('a[href]')];
      let active = null;

      if (hash) {
        active = links.find(a => {
          const href = norm(a.getAttribute('href'));
          return href === full || href === hash || href.endsWith(hash);
        });
      }
      if (!active) {
        active = links.find(a => {
          const href = norm((a.getAttribute('href') || '').split('#')[0]);
          if (!href || href.startsWith('#') || href.startsWith('http')) return false;
          return path === href || path.startsWith(href);
        });
      }
      if (active) active.classList.add('active-link');
    };

    // === État initial : panneau fermé, on surligne juste le lien courant ===
    highlightActiveLink();

    // === Mise à jour quand le hash change (un seul handler, ré-init-safe) ===
    if (onHashChange) window.removeEventListener('hashchange', onHashChange);
    onHashChange = () => {
      highlightActiveLink();
      if (isMobile()) closePanel();
    };
    window.addEventListener('hashchange', onHashChange);
}

// Rendu instantané depuis la version RENDUE en cache (icônes SVG déjà inline →
// paint immédiat, aucune attente réseau ni lucide).
let menuRendered = false;
const cachedRendered = sessionStorage.getItem(MENU_RENDERED_KEY);
const cachedSrc = sessionStorage.getItem(MENU_SRC_KEY);
if (cachedRendered) {
  initMenu(cachedRendered);
  menuRendered = true;
}

// Rafraîchit le HTML source en arrière-plan : ne ré-affiche QUE si c'est le 1er
// passage ou si le menu a réellement changé (ajout d'un item) → sinon on garde
// la version rendue, sans flicker d'icônes.
fetch('/menu.html')
  .then(r => r.text())
  .then(html => {
    const changed = html !== cachedSrc;
    sessionStorage.setItem(MENU_SRC_KEY, html);
    if (!menuRendered || changed) initMenu(html);
  })
  .catch(() => {});
