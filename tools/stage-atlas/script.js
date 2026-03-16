'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let db           = null;
let areas        = [];      // [{ id, name }]
let regions      = [];      // [{ id, name, area_id }]
let difficulties = [];      // numbers available for selected area

let selectedArea    = null;
let selectedZoneKey = null;
let selectedDiff    = null;
let selectedRegion  = null;
let selectedGroup   = null;
let currentStageNum = null;
let currentStage    = null;
let tableView      = false;
let currentWaveMap = null;
let champDb        = null;
let champByIdMap   = new Map(); // hero_id (int) → champ row
let champByNameMap = new Map(); // name.toLowerCase() → champ row

// ── Zone nav cards ────────────────────────────────────────────────────────────
const ZONE_CARDS = [
  { key: 'Campaign',     label: 'Campaign',     matchNames: ['Campaign'],                        areaIds: [] },
  { key: 'Dungeons',     label: 'Dungeons',     matchNames: ['Dungeon'],                         areaIds: [] },
  { key: 'Faction Wars', label: 'Faction Wars', matchNames: ['Faction War'],                     areaIds: [] },
  { key: 'Clan Bosses',  label: 'Clan Bosses',  matchNames: ['Clan Boss', 'Hydra', 'Chimera'],   areaIds: [] },
  { key: 'Doom Tower',   label: 'Doom Tower',   matchNames: ['Doom Tower'],                      areaIds: [] },
  { key: 'Cursed City',  label: 'Cursed City',  matchNames: ['Cursed City'],                     areaIds: [] },
  { key: 'Grim Forest',  label: 'Grim Forest',  matchNames: ['Grim Forest'],                     areaIds: [] },
];

// ── Stat formula (source: GetConvertedStatValue from game code) ───────────────
// converted = baseStat * multi1 * Power(multi2, (Level-1) / (10*Grade-1))
// HP = Round(converted) * 15 — ATK/DEF = Round(converted)
const GRADE_MULTI1 = { 1: 1.0, 2: 1.60000002, 3: 2.43199992, 4: 3.5020796, 5: 4.76282883, 6: 6.47744703 };
const GRADE_MULTI2 = { 1: 2.0, 2: 1.89999998, 3: 1.79999995, 4: 1.70000005, 5: 1.70000005, 6: 1.70000005 };

function convertedStat(baseStat, level, grade) {
  const m1  = GRADE_MULTI1[grade] ?? 1;
  const m2  = GRADE_MULTI2[grade] ?? 2;
  const exp = (level - 1) / (10 * grade - 1);
  return baseStat * m1 * Math.pow(m2, exp);
}

function computeStats(hero, grade, level) {
  // Use pre-computed effective stats from DB when available (includes stage modifiers)
  if (hero.eff_hp != null) {
    return {
      hp:        hero.eff_hp,
      atk:       hero.eff_atk,
      def:       hero.eff_def,
      spd:       hero.eff_spd ?? hero.spd,
      crit_rate: hero.crit_rate,
      crit_dmg:  hero.crit_dmg,
      res:       hero.eff_res,
      acc:       hero.eff_acc,
    };
  }
  return {
    hp:        Math.round(convertedStat(hero.base_hp,  level, grade)) * 15,
    atk:       Math.round(convertedStat(hero.base_atk, level, grade)),
    def:       Math.round(convertedStat(hero.base_def, level, grade)),
    spd:       hero.spd,
    crit_rate: hero.crit_rate,
    crit_dmg:  hero.crit_dmg,
    res:       hero.res,
    acc:       hero.acc,
  };
}

// All grades now use the exact formula — no estimation
function isCalibrated(_grade) { return true; }

// ── Nav strip helpers (horizontal animated bars) ───────────────────────────────
// Toggle .strip-centered when content fits (scrollWidth ≤ clientWidth) — mobile centering
function snapCenter(el) {
  if (!el) return;
  el.classList.toggle('strip-centered', el.scrollWidth <= el.clientWidth);
}

function showStrip(id) {
  const el = document.getElementById(id);
  if (!el) return;
  // Double rAF ensures layout is ready before transition fires + centering check
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.classList.add('strip-visible');
    el.querySelectorAll('.strip-list, .strip-group-row, .strip-stage-row').forEach(snapCenter);
  }));
}

function hideStrip(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('strip-visible');
}

// Kept for compat — strips are always visible once shown (no pill collapse)
function sectionCollapse(_id, _pill, _cb) { /* no-op in horizontal layout */ }
function sectionExpand(id) { showStrip(id); }

function goBackToArea() {
  const zone = ZONE_CARDS.find(z => z.key === selectedZoneKey);
  hideStrip('diff-section');
  hideStrip('affinity-section');
  hideStrip('stage-section');
  clearStageView();
  selectedDiff = null; selectedRegion = null; selectedGroup = null; currentStageNum = null;

  if (zone && zone.areaIds.length > 1) {
    showStrip('sub-area-section');
    hideStrip('region-section');
  } else {
    renderRegionList(); // renderRegionList calls showStrip internally
  }
}

function goBackToSubArea() {
  showStrip('sub-area-section');
  hideStrip('region-section');
  hideStrip('diff-section');
  hideStrip('affinity-section');
  hideStrip('stage-section');
  clearStageView();
  selectedArea = null;
  selectedDiff = null; selectedRegion = null; selectedGroup = null; currentStageNum = null;
}

function goBackToDiff() {
  showStrip('diff-section');
  hideStrip('stage-section');
  clearStageView();
}

function goBackToRegion() {
  showStrip('region-section');
  hideStrip('diff-section');
  hideStrip('affinity-section');
  hideStrip('stage-section');
  clearStageView();
  selectedDiff = null; selectedRegion = null; selectedGroup = null; currentStageNum = null;
}


// ── DB helpers ────────────────────────────────────────────────────────────────
function query(sql, params = []) {
  const res = db.exec(sql, params);
  if (!res.length) return [];
  const { columns, values } = res[0];
  return values.map(row =>
    Object.fromEntries(columns.map((c, i) => [c, row[i]]))
  );
}

// ── Init ──────────────────────────────────────────────────────────────────────
initSqlJs({
  locateFile: f => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${f}`
}).then(SQL => {
  const stagesP = fetch(`/tools/stage-atlas/stages.db?v=${Date.now()}`)
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
    .then(buf => { db = new SQL.Database(new Uint8Array(buf)); });

  const champsP = fetch(`/tools/champions-index/champions.db?v=${Date.now()}`)
    .then(r => r.arrayBuffer())
    .then(buf => {
      champDb = new SQL.Database(new Uint8Array(buf));
      const res = champDb.exec(`SELECT * FROM champions`);
      if (res.length) {
        const cols = res[0].columns;
        for (const row of res[0].values) {
          const c = Object.fromEntries(cols.map((k, i) => [k, row[i]]));
          const hid = parseInt(c.IGid);
          if (hid && !champByIdMap.has(hid)) champByIdMap.set(hid, c);
          if (c.name) champByNameMap.set(c.name.toLowerCase().replace(/[\u2018\u2019]/g, "'"), c);
        }
      }
    })
    .catch(() => {});

  Promise.all([stagesP, champsP])
    .then(() => onDbReady())
    .catch(err => showError(err));
});

function showError(err) {
  document.getElementById('main-placeholder').innerHTML =
    `<div class="placeholder-icon"><i data-lucide="alert-triangle"></i></div>
     <div class="placeholder-text">Failed to load database.<br><small>${err}</small></div>`;
  if (window.lucide) lucide.createIcons();
}

function onDbReady() {
  // Distinct areas
  const AREA_NAME_OVERRIDES = { 14: 'Grim Forest' };
  areas = query(`SELECT DISTINCT area_id as id, area_name as name
                 FROM stages ORDER BY area_id`)
    .map(a => ({ ...a, name: AREA_NAME_OVERRIDES[a.id] ?? a.name }));
  // Distinct regions (with display name overrides)
  regions = query(`SELECT DISTINCT region_id as id, region_name as name, area_id
                   FROM stages ORDER BY area_id, region_id`)
    .map(r => ({ ...r, name: REGION_NAME_OVERRIDES[r.id] ?? r.name }));

  // Map DB areas to zone cards
  for (const area of areas) {
    for (const zone of ZONE_CARDS) {
      if (zone.matchNames.some(n => area.name.toLowerCase().includes(n.toLowerCase()))) {
        zone.areaIds.push(area.id);
        break;
      }
    }
  }

  // Clean up sub-area display names for multi-area zones (breadcrumb + sub-area buttons)
  const clanBossZone = ZONE_CARDS.find(z => z.key === 'Clan Bosses');
  if (clanBossZone) {
    for (const area of areas.filter(a => clanBossZone.areaIds.includes(a.id))) {
      const n = area.name.toLowerCase();
      if      (n.includes('hydra'))                          area.name = 'Hydra';
      else if (n.includes('chimera'))                        area.name = 'Chimera';
      else if (n.includes('clan boss') || n === 'clan boss') area.name = 'Demon Lord';
    }
  }

  // Remove "Act " prefix from Campaign region names
  const campaignZone = ZONE_CARDS.find(z => z.key === 'Campaign');
  if (campaignZone) {
    for (const r of regions.filter(r => campaignZone.areaIds.includes(r.area_id))) {
      r.name = r.name.replace(/^Act\s+/i, '').trim();
    }
  }

  renderZoneNav();
  updateFavCount();
  if (window.lucide) lucide.createIcons();
  restoreFromUrl();

  // Re-check centering on every resize (strips that fitted may now overflow, or vice-versa)
  window.addEventListener('resize', () => {
    document.querySelectorAll('.strip-list, .strip-group-row, .strip-stage-row').forEach(snapCenter);
  });


  // Enemy card click → modal; wave label click → collapse
  document.getElementById('waves-container').addEventListener('click', e => {
    const toggle = e.target.closest('.wave-toggle, .wave-label');
    if (toggle) {
      toggle.closest('.wave-block').classList.toggle('collapsed');
      return;
    }
    const card = e.target.closest('.enemy-card');
    if (!card || !card.dataset.heroId) return;
    openEnemyModal(card.dataset);
  });

  // Modal close handlers
  document.getElementById('enemy-modal-close').addEventListener('click', closeEnemyModal);
  document.getElementById('enemy-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeEnemyModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeEnemyModal();
  });

  // Drag-to-scroll for horizontal nav strips (works on dynamically created rows too)
  {
    const DRAG_SELECTOR = '.strip-list, .strip-group-row, .strip-stage-row, #zone-nav';
    let dragEl = null, startX = 0, startScroll = 0, hasDragged = false;

    // Use capture so we intercept mousedown before buttons handle it
    document.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      const target = e.target.closest(DRAG_SELECTOR);
      if (!target) return;
      dragEl      = target;
      startX      = e.pageX;
      startScroll = dragEl.scrollLeft;
      hasDragged  = false;
      dragEl.style.userSelect = 'none';
    }, true);

    document.addEventListener('mousemove', e => {
      if (!dragEl) return;
      const dx = e.pageX - startX;
      if (Math.abs(dx) > 4) hasDragged = true;
      if (hasDragged) dragEl.scrollLeft = startScroll - dx;
    });

    document.addEventListener('mouseup', () => {
      if (dragEl) { dragEl.style.userSelect = ''; dragEl = null; }
    });

    // Swallow click after a drag so buttons don't fire
    document.addEventListener('click', e => {
      if (hasDragged) { e.stopPropagation(); e.preventDefault(); hasDragged = false; }
    }, true);
  }
}

// ── URL state (deep linking) ──────────────────────────────────────────────────
function updateUrl(stageId) {
  const url = new URL(location.href);
  url.searchParams.set('stage', stageId);
  history.replaceState(null, '', url);
}

function groupForRegion(regionId) {
  for (const [key, g] of Object.entries(REGION_GROUPS)) {
    if (g.regions.some(r => r.id === regionId)) return key;
  }
  return null;
}

function restoreFromUrl() {
  const stageId = +new URL(location.href).searchParams.get('stage');
  if (stageId) restoreStage(stageId);
}

function restoreStage(stageId) {
  const [stage] = query('SELECT * FROM stages WHERE id=?', [stageId]);
  if (!stage) return;

  const { region_id, difficulty, area_id } = stage;
  const zone = ZONE_CARDS.find(z => z.areaIds.includes(area_id));
  if (!zone) return;

  // 1. Activate zone button visually
  document.querySelectorAll('.zone-card').forEach(b =>
    b.classList.toggle('active', b.dataset.zone === zone.key)
  );
  selectedZoneKey = zone.key;
  selectedArea = null; selectedDiff = null; selectedRegion = null;
  selectedGroup = null; currentStageNum = null;
  hideStrip('diff-section'); hideStrip('affinity-section');
  hideStrip('stage-section'); clearStageView();

  // 2. Multi-area zones (Clan Bosses): render sub-area strip and activate
  if (zone.areaIds.length > 1) {
    renderSubAreaSection(zone);
    showStrip('sub-area-section');
    const subBtn = document.querySelector(`.sub-area-btn[data-area="${area_id}"]`);
    if (subBtn) {
      document.querySelectorAll('.sub-area-btn').forEach(b => b.classList.toggle('active', b === subBtn));
      slideIndicator(document.getElementById('sub-area-list'), subBtn, '#d4af37', 'rgba(212,175,55,.1)');
    }
  } else {
    hideStrip('sub-area-section');
  }

  // 3. Select area (renders region list, resets diff — we'll set it after)
  selectedArea = area_id;
  renderRegionList();

  // 4. Handle affinity groups (Iron Twins, Potion Keeps)
  const groupKey = groupForRegion(region_id);
  if (groupKey) openGroup(groupKey);

  // 5–7. Suppress animations during restore, then select region + load stage
  document.body.classList.add('no-anim');
  selectedDiff = difficulty;
  selectRegion(region_id);
  loadStage(stageId);
  // slideIndicator uses triple-rAF internally → need quad-rAF to remove no-anim after pills are placed
  requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => {
    document.body.classList.remove('no-anim');
  }))));
}

// ── Share button ──────────────────────────────────────────────────────────────
document.getElementById('share-btn').addEventListener('click', () => {
  navigator.clipboard.writeText(location.href).then(() => {
    const btn = document.getElementById('share-btn');
    btn.querySelector('.action-label').textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.querySelector('.action-label').textContent = 'Copy link'; btn.classList.remove('copied'); }, 2000);
  });
});

// ── Favorites ─────────────────────────────────────────────────────────────────
const FAV_KEY = 'rsl-atlas-favorites';

function getFavorites() {
  try { return JSON.parse(localStorage.getItem(FAV_KEY)) || []; } catch { return []; }
}
function saveFavorites(favs) {
  localStorage.setItem(FAV_KEY, JSON.stringify(favs));
}
function isFavorite(stageId) {
  return getFavorites().some(f => f.id === stageId);
}
function toggleFavorite(stageId) {
  const favs = getFavorites();
  const idx  = favs.findIndex(f => f.id === stageId);
  if (idx >= 0) {
    favs.splice(idx, 1);
  } else {
    favs.unshift({ id: stageId, label: buildFavLabel(stageId), ts: Date.now() });
  }
  saveFavorites(favs);
  updateFavUI(stageId);
}
function buildFavLabel(stageId) {
  const [s] = query('SELECT region_id, difficulty, diff_name, stage_num, area_id FROM stages WHERE id=?', [stageId]);
  if (!s) return `#${stageId}`;
  const zone   = ZONE_CARDS.find(z => z.areaIds.includes(s.area_id));
  const region = regions.find(r => r.id === s.region_id);
  let zonePart = zone?.key || '';
  let regionPart = region?.name || '';
  if (s.region_id === 401)                   { zonePart = 'Clan Bosses'; regionPart = 'Demon Lord'; }
  else if (HYDRA_REGIONS.has(s.region_id))   { zonePart = 'Hydra';   regionPart = `Rotation ${s.region_id - 800}`; }
  else if (CHIMERA_REGIONS.has(s.region_id)) { zonePart = 'Chimera'; regionPart = `Rotation ${s.region_id - 1300}`; }
  // CB encodes difficulty in stage_num (Easy/Normal/Hard/…) — diff_name is the same for all CB stages
  const diffPart  = s.region_id === 401 ? '' : (s.diff_name || '');
  const lbl       = stageLabel(s.stage_num, s.region_id);
  // Hydra/Chimera: rotation already in regionPart, nothing to add; CB: stageLabel = difficulty name
  const noStage   = HYDRA_REGIONS.has(s.region_id) || CHIMERA_REGIONS.has(s.region_id);
  const stagePart = noStage ? '' : (/^\d+$/.test(lbl) ? `Stage ${lbl}` : lbl);
  return [zonePart, regionPart, diffPart, stagePart].filter(Boolean).join(' · ');
}
function updateFavUI(stageId) {
  const active = isFavorite(stageId);
  const btn    = document.getElementById('fav-stage-btn');
  if (btn) {
    btn.classList.toggle('fav-active', active);
    btn.querySelector('.action-label').textContent = active ? 'Saved' : 'Add to favorites';
  }
  updateFavCount();
  if (document.getElementById('fav-modal').style.display !== 'none') renderFavList();
}
function updateFavCount() {
  const n    = getFavorites().length;
  const el   = document.getElementById('fav-count');
  el.textContent    = n;
  el.style.display  = n ? '' : 'none';
}
function openFavModal() {
  renderFavList();
  document.getElementById('fav-modal').style.display = '';
  if (window.lucide) lucide.createIcons();
}
function closeFavModal() {
  document.getElementById('fav-modal').style.display = 'none';
}
function renderFavList() {
  const favs = getFavorites();
  const list = document.getElementById('fav-list');
  if (!favs.length) {
    list.innerHTML = '<div class="fav-empty">No favorites yet.<br>Browse a stage and click the ★ to save it.</div>';
    return;
  }
  list.innerHTML = favs.map(f => `
    <div class="fav-item" data-id="${f.id}">
      <span class="fav-item-star"><i data-lucide="star"></i></span>
      <span class="fav-item-label">${f.label}</span>
      <button class="fav-item-remove" data-remove="${f.id}" title="Remove"><i data-lucide="x"></i></button>
    </div>`).join('');
  if (window.lucide) lucide.createIcons({ nodes: [list] });
}

// Favorites event listeners
document.getElementById('fav-fab').addEventListener('click', openFavModal);
document.getElementById('fav-modal-close').addEventListener('click', closeFavModal);
document.getElementById('fav-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeFavModal();
  const removeBtn = e.target.closest('[data-remove]');
  if (removeBtn) {
    e.stopPropagation();
    const id = +removeBtn.dataset.remove;
    const favs = getFavorites().filter(f => f.id !== id);
    saveFavorites(favs);
    updateFavUI(id);
    renderFavList();
    if (window.lucide) lucide.createIcons();
    return;
  }
  const item = e.target.closest('.fav-item');
  if (item && !e.target.closest('[data-remove]')) {
    const id = +item.dataset.id;
    closeFavModal();
    restoreStage(id);
  }
});
document.getElementById('fav-stage-btn').addEventListener('click', () => {
  if (currentStage) toggleFavorite(currentStage.id);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('fav-modal').style.display !== 'none') closeFavModal();
});

// ── Area tabs ─────────────────────────────────────────────────────────────────
function renderZoneNav() {
  const nav = document.getElementById('zone-nav');
  nav.innerHTML = ZONE_CARDS
    .filter(z => z.areaIds.length > 0)
    .map(z => {
      const enc  = z.key.replace(/ /g, '%20');
      const bg   = `/tools/stage-atlas/img/region/${enc}.webp`;
      const logo = `/tools/stage-atlas/img/region/logo/${enc}.webp`;
      return `
        <button class="zone-card" data-zone="${z.key}">
          <div class="zone-card-bg" style="background-image:url('${bg}')"></div>
          <img class="zone-card-logo" src="${logo}" alt="" onerror="this.style.display='none'">
          <span class="zone-card-label">${z.label}</span>
        </button>`;
    }).join('');
  nav.querySelectorAll('.zone-card').forEach(btn =>
    btn.addEventListener('click', () => {
      const nav = document.getElementById('zone-nav');
      if (btn.dataset.zone === selectedZoneKey && nav.classList.contains('compact')) {
        // Re-click active zone → expand back to big cards
        nav.classList.remove('compact');
        return;
      }
      nav.classList.add('compact');
      selectZone(btn.dataset.zone);
    })
  );
}

function selectZone(key) {
  selectedZoneKey = key;
  selectedArea    = null;
  selectedDiff    = null;
  selectedRegion  = null;
  selectedGroup   = null;
  currentStageNum = null;

  const nameDisplay = document.getElementById('region-name-display');
  if (nameDisplay) nameDisplay.textContent = '';

  document.querySelectorAll('.zone-card').forEach(b =>
    b.classList.toggle('active', b.dataset.zone === key)
  );
  hideStrip('diff-section');
  hideStrip('affinity-section');
  hideStrip('stage-section');
  clearStageView();

  const zone = ZONE_CARDS.find(z => z.key === key);
  if (!zone) return;

  if (zone.areaIds.length === 1) {
    hideStrip('sub-area-section');
    selectArea(zone.areaIds[0]);
  } else {
    hideStrip('region-section');
    renderSubAreaSection(zone);
    showStrip('sub-area-section');
  }
}

const AREA_DISPLAY_NAMES = { 'Clan Boss': 'Demon Lord' };

function renderSubAreaSection(zone) {
  const el = document.getElementById('sub-area-list');
  const matchingAreas = areas.filter(a => zone.areaIds.includes(a.id));
  el.innerHTML = matchingAreas.map(a =>
    `<button class="region-btn sub-area-btn" data-area="${a.id}">${AREA_DISPLAY_NAMES[a.name] ?? a.name}</button>`
  ).join('');
  el.querySelectorAll('.sub-area-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      el.querySelectorAll('.sub-area-btn').forEach(b => b.classList.toggle('active', b === btn));
      slideIndicator(el, btn, '#d4af37', 'rgba(212,175,55,.1)');
      selectArea(+btn.dataset.area);
    })
  );
}

function selectArea(areaId) {
  selectedArea    = areaId;
  selectedDiff    = null;
  selectedRegion  = null;
  selectedGroup   = null;
  currentStageNum = null;

  hideStrip('affinity-section');
  hideStrip('diff-section');
  hideStrip('stage-section');
  // Don't showStrip here — let renderRegionList decide (avoids showing stale content)
  renderRegionList();
}

// Dungeon regular regions in game order
const DUNGEON_ORDER = [210, 207, 209, 206, 208, 216, 217];

// Regions grouped under a single button with affinity sub-selection
const REGION_GROUPS = {
  potionKeeps: {
    label: 'Potion Keeps',
    noIcon: true,
    stayVisible: true,
    regions: [
      { id: 202, affinity: 'Spirit' },
      { id: 205, affinity: 'Arcane' },
      { id: 203, affinity: 'Magic'  },
      { id: 201, affinity: 'Void'   },
      { id: 204, affinity: 'Force'  },
    ]
  },
  ironTwins: {
    label: 'Iron Twins',
    noIcon: true,
    stayVisible: true,
    regions: [
      { id: 211, affinity: 'Void'   },
      { id: 212, affinity: 'Spirit' },
      { id: 213, affinity: 'Magic'  },
      { id: 214, affinity: 'Force'  },
    ]
  }
};


const GROUPED_IDS      = new Set(Object.values(REGION_GROUPS).flatMap(g => g.regions.map(r => r.id)));
const REGION_TO_GROUP  = Object.fromEntries(Object.entries(REGION_GROUPS).flatMap(([k, g]) => g.regions.map(r => [r.id, k])));

// Dungeons that have Normal + Hard
const MULTI_DIFF_DUNGEONS = new Set([206, 207, 208, 209]);

// ── Region name overrides (applied after DB load) ─────────────────────────────
const HERO_NAME_OVERRIDES = {
  1060: 'Rockbeast',
  1066: 'Rockbeast',
  6550: 'Aleksandr the Sharpshooter',
  7366: 'Ronda',
  6553: 'Aleksandr the Sharpshooter',
  6555: 'Aleksandr the Sharpshooter',
  6556: 'Aleksandr the Sharpshooter',
  6981: 'Cagebound',
  8686: 'Acelin the Stalwart',
  2580: 'Jotunn',
  2585: 'Jotunn',
  2586: 'Jotunn',
  25310: 'The Disruptor Minion',
  25320: 'The Disruptor Minion',
  25330: 'The Mirrorer Minion',
  25340: 'The Mirrorer Minion',
  25350: 'The Protector Minion',
  25360: 'The Protector Minion',
  25370: 'The Incinerator Minion',
  25380: 'The Incinerator Minion',
  25660: 'Tainted Protector Minion',
  25670: 'Tainted Protector Minion',
  25680: 'Tainted Disruptor Minion',
  25690: 'Tainted Disruptor Minion',
  25700: 'Tainted Mirrorer Minion',
  25710: 'Tainted Mirrorer Minion',
  25720: 'Tainted Incinerator Minion',
  25730: 'Tainted Incinerator Minion',
  22840: 'Klyssus Minion',
  22850: 'Klyssus Minion',
  25210: 'Klyssus Minion',
  25220: 'Klyssus Minion',
  22770: 'Tainted Klyssus Minion',
  22780: 'Tainted Klyssus Minion',
  23030: 'Tainted Klyssus Minion',
  23040: 'Tainted Klyssus Minion',
  23220: 'Tainted Klyssus Minion',
  23230: 'Tainted Klyssus Minion',
  25640: 'Tainted Klyssus Minion',
  25650: 'Tainted Klyssus Minion',
  25270: 'Small Minotaur',
  25300: 'Small Minotaur',
  25010: 'Arcane Guardian Minion',
  25020: 'Arcane Guardian Minion',
  25030: 'Arcane Guardian Minion',
  25040: 'Arcane Guardian Minion',
  25050: 'Force Guardian Minion',
  25060: 'Force Guardian Minion',
  25070: 'Force Guardian Minion',
  25080: 'Force Guardian Minion',
  25090: 'Void Guardian Minion',
  25100: 'Void Guardian Minion',
  25110: 'Void Guardian Minion',
  25120: 'Void Guardian Minion',
  25130: 'Magic Guardian Minion',
  25140: 'Magic Guardian Minion',
  25150: 'Magic Guardian Minion',
  25160: 'Magic Guardian Minion',
  25170: 'Spirit Guardian Minion',
  25180: 'Spirit Guardian Minion',
  25190: 'Spirit Guardian Minion',
  25200: 'Spirit Guardian Minion',
};

const REGION_NAME_OVERRIDES = {
  // Dungeons
  206: 'Dragon',      207: 'Ice Golem', 208: 'Fire Knight',
  209: 'Spider',      210: 'Minotaur',  216: 'Sand Devil',  217: 'Shogun',
  // Clan Boss
  401: 'Demon Lord',
  // Doom Tower rotations
  701: 'Rotation 1 – Sorath',
  702: 'Rotation 2 – Iragoth',
  703: 'Rotation 3 – Astranyx',
  // Hydra rotations
  801: 'Rotation 1', 802: 'Rotation 2', 803: 'Rotation 3',
  804: 'Rotation 4', 805: 'Rotation 5', 806: 'Rotation 6',
  // Cursed City districts
  1001: 'Cobblemarket', 1002: 'Deadrise', 1003: 'Plagueholme',
  1004: 'Soulcross',   1005: 'Amius',
  // Chimera rotations
  1301: 'Rotation 1', 1302: 'Rotation 2', 1303: 'Rotation 3', 1304: 'Rotation 4',
  // Grim Forest rotations
  1401: 'Easy', 1402: 'Medium', 1403: 'Hard', 1404: 'Extra Hard',
};

// ── Special stage regions ─────────────────────────────────────────────────────
// Clan Boss: Void stages only, labeled by difficulty
const CB_VOID_STAGES = new Map([
  [1,'Easy'], [5,'Normal'], [9,'Hard'], [13,'Brutal'], [17,'Nightmare'], [21,'Ultra-Nightmare'],
]);
const CB_DIFF_CLASS     = { 1:'easy', 5:'normal', 9:'hard', 13:'brutal', 17:'nightmare', 21:'nightmare' };
const HYDRA_DIFF_CLASS  = { 1:'normal', 2:'hard', 3:'brutal', 4:'nightmare' };
const CHIMERA_DIFF_CLASS = { 1:'easy', 2:'normal', 3:'hard', 4:'brutal', 5:'nightmare', 6:'nightmare' };

// Hydra: 4 stages = difficulties
const HYDRA_REGIONS      = new Set([801, 802, 803, 804, 805, 806]);
const HYDRA_STAGE_LABELS = { 1:'Normal', 2:'Hard', 3:'Brutal', 4:'Nightmare' };

// Chimera: 6 stages = difficulties, 4 rotations = region_ids
const CHIMERA_REGIONS      = new Set([1301, 1302, 1303, 1304]);
const CHIMERA_STAGE_LABELS = { 1:'Easy', 2:'Normal', 3:'Hard', 4:'Brutal', 5:'Nightmare', 6:'Ultra-Nightmare' };
// Per-rotation affinities: { ultimate, forms (Ram/Lion/Viper share same aff) }
const CHIMERA_ROTATIONS = {
  1301: { ultimate:'void',   forms:'force'  },
  1302: { ultimate:'force',  forms:'magic'  },
  1303: { ultimate:'magic',  forms:'spirit' },
  1304: { ultimate:'spirit', forms:'void'   },
};

const HYDRA_STATS = {
  1: [
    {name:'Head of Decay',    hp:1010467, atk:5589,  def:2528,  spd:190, res:120, acc:190, cr:15, cd:50},
    {name:'Head of Torment',  hp:686120,  atk:7685,  def:1597,  spd:160, res:80,  acc:150, cr:15, cd:50},
    {name:'Head of Mischief', hp:611270,  atk:6786,  def:1464,  spd:210, res:60,  acc:250, cr:15, cd:50},
    {name:'Head of Wrath',    hp:923143,  atk:5389,  def:2195,  spd:140, res:110, acc:210, cr:15, cd:50},
    {name:'Head of Suffering',hp:1372239, atk:4691,  def:6853,  spd:100, res:140, acc:90,  cr:15, cd:50},
    {name:'Head of Blight',   hp:848293,  atk:6387,  def:1996,  spd:180, res:100, acc:220, cr:15, cd:50},
  ],
  2: [
    {name:'Head of Decay',    hp:2030922, atk:6690,  def:3743,  spd:200, res:170, acc:220, cr:15, cd:50},
    {name:'Head of Torment',  hp:1493325, atk:9199,  def:2150,  spd:170, res:130, acc:180, cr:15, cd:50},
    {name:'Head of Mischief', hp:1194660, atk:8124,  def:2071,  spd:220, res:110, acc:310, cr:15, cd:50},
    {name:'Head of Wrath',    hp:1836790, atk:6451,  def:3186,  spd:150, res:160, acc:240, cr:15, cd:50},
    {name:'Head of Suffering',hp:2717852, atk:5615,  def:8442,  spd:110, res:190, acc:120, cr:15, cd:50},
    {name:'Head of Blight',   hp:1687457, atk:7646,  def:2787,  spd:190, res:150, acc:250, cr:15, cd:50},
  ],
  3: [
    {name:'Head of Decay',    hp:3059128, atk:7520,  def:4649,  spd:210, res:235, acc:265, cr:15, cd:50},
    {name:'Head of Torment',  hp:2255893, atk:10527, def:3099,  spd:180, res:195, acc:225, cr:15, cd:50},
    {name:'Head of Mischief', hp:1845731, atk:9297,  def:2735,  spd:230, res:175, acc:345, cr:15, cd:50},
    {name:'Head of Wrath',    hp:2734416, atk:7383,  def:4011,  spd:160, res:225, acc:285, cr:15, cd:50},
    {name:'Head of Suffering',hp:4152894, atk:6426,  def:9571,  spd:120, res:255, acc:165, cr:15, cd:50},
    {name:'Head of Blight',   hp:2546425, atk:8750,  def:3828,  spd:200, res:215, acc:295, cr:15, cd:50},
  ],
  4: [
    {name:'Head of Decay',    hp:3813873, atk:8606,  def:6259,  spd:220, res:315, acc:300, cr:15, cd:50},
    {name:'Head of Torment',  hp:2992428, atk:11892, def:3964,  spd:190, res:275, acc:255, cr:15, cd:50},
    {name:'Head of Mischief', hp:2483910, atk:10640, def:3547,  spd:250, res:255, acc:350, cr:15, cd:50},
    {name:'Head of Wrath',    hp:3579178, atk:8449,  def:5007,  spd:170, res:305, acc:320, cr:15, cd:50},
    {name:'Head of Suffering',hp:5143846, atk:7354,  def:11057, spd:140, res:335, acc:200, cr:15, cd:50},
    {name:'Head of Blight',   hp:3481386, atk:10014, def:5320,  spd:210, res:295, acc:330, cr:15, cd:50},
  ],
};

const HYDRA_ROTATIONS = {
  801: [
    {name:'Head of Decay',    aff:'force'},
    {name:'Head of Torment',  aff:'magic'},
    {name:'Head of Suffering',aff:'spirit'},
    {name:'Head of Mischief', aff:'spirit'},
    {name:'Head of Blight',   aff:'magic',  extra:true},
    {name:'Head of Wrath',    aff:'force',  extra:true},
  ],
  802: [
    {name:'Head of Blight',   aff:'force'},
    {name:'Head of Torment',  aff:'spirit'},
    {name:'Head of Mischief', aff:'force'},
    {name:'Head of Wrath',    aff:'magic'},
    {name:'Head of Decay',    aff:'magic',  extra:true},
    {name:'Head of Suffering',aff:'force',  extra:true},
  ],
  803: [
    {name:'Head of Decay',    aff:'spirit'},
    {name:'Head of Blight',   aff:'magic'},
    {name:'Head of Suffering',aff:'magic'},
    {name:'Head of Wrath',    aff:'spirit'},
    {name:'Head of Torment',  aff:'force',  extra:true},
    {name:'Head of Mischief', aff:'force',  extra:true},
  ],
  804: [
    {name:'Head of Decay',    aff:'force'},
    {name:'Head of Blight',   aff:'magic'},
    {name:'Head of Mischief', aff:'spirit'},
    {name:'Head of Wrath',    aff:'magic'},
    {name:'Head of Torment',  aff:'spirit', extra:true},
    {name:'Head of Suffering',aff:'force',  extra:true},
  ],
  805: [
    {name:'Head of Decay',    aff:'magic'},
    {name:'Head of Blight',   aff:'force'},
    {name:'Head of Suffering',aff:'force'},
    {name:'Head of Mischief', aff:'spirit'},
    {name:'Head of Torment',  aff:'magic',  extra:true},
    {name:'Head of Wrath',    aff:'spirit', extra:true},
  ],
  806: [
    {name:'Head of Decay',    aff:'spirit'},
    {name:'Head of Torment',  aff:'force'},
    {name:'Head of Mischief', aff:'magic'},
    {name:'Head of Wrath',    aff:'force'},
    {name:'Head of Suffering',aff:'spirit', extra:true},
    {name:'Head of Blight',   aff:'magic',  extra:true},
  ],
};

const CHIMERA_FORMS = {
  1: {
    ultimate: {atk:1578,  def:1216, res:100, acc:100},
    ram:      {atk:1894,  def:1475, res:150, acc:200},
    lion:     {atk:3156,  def:868,  cr:45,   res:100, acc:125},
    viper:    {atk:2210,  def:1042, res:125, acc:150},
  },
  2: {
    ultimate: {atk:2474,  def:1905, res:150, acc:150},
    ram:      {atk:2968,  def:2313, res:200, acc:250},
    lion:     {atk:4948,  def:1361, cr:45,   res:150, acc:175},
    viper:    {atk:3464,  def:1632, res:175, acc:200},
  },
  3: {
    ultimate: {atk:3878,  def:2987, res:200, acc:200},
    ram:      {atk:4654,  def:3627, res:250, acc:300},
    lion:     {atk:7758,  def:2133, cr:45,   res:200, acc:225},
    viper:    {atk:5430,  def:2560, res:225, acc:250},
  },
  4: {
    ultimate: {atk:6082,  def:4683, res:250, acc:250},
    ram:      {atk:7298,  def:5686, res:300, acc:350},
    lion:     {atk:12162, def:3345, cr:45,   res:250, acc:275},
    viper:    {atk:8514,  def:4014, res:275, acc:300},
  },
  5: {
    ultimate: {atk:8960,  def:6411, res:350, acc:350},
    ram:      {atk:10753, def:7786, res:400, acc:450},
    lion:     {atk:17919, def:4579, cr:45,   res:350, acc:375},
    viper:    {atk:12544, def:5496, res:375, acc:400},
  },
  6: {
    ultimate: {atk:11918, def:8009, res:400, acc:400},
    ram:      {atk:14300, def:9725, res:450, acc:500},
    lion:     {atk:23835, def:5720, cr:45,   res:400, acc:425},
    viper:    {atk:16685, def:6864, res:425, acc:450},
  },
};

const CLAN_BOSS_STATS = {
  1:  {asc:'0/2', lvl:60,  hp:19021215,   atk:1350, def:294,  spd:90,  res:30,  acc:0},
  5:  {asc:'1/3', lvl:90,  hp:60616860,   atk:1699, def:369,  spd:120, res:50,  acc:30},
  9:  {asc:'2/4', lvl:120, hp:194130195,  atk:2033, def:442,  spd:140, res:75,  acc:40},
  13: {asc:'3/5', lvl:150, hp:361551060,  atk:2750, def:598,  spd:160, res:100, acc:75},
  17: {asc:'6/6', lvl:185, hp:652752210,  atk:3898, def:847,  spd:170, res:150, acc:150},
  21: {asc:'6/6', lvl:250, hp:1171204605, atk:6993, def:1520, spd:190, res:225, acc:225},
};

const CB_REWARDS = {
  1:  [{tier:'Novice',      range:'286K – 381K'},    {tier:'Novice',      range:'381K – 761K'},    {tier:'Adept',        range:'761K – 1.15M'},    {tier:'Warrior',      range:'Over 1.15M'}],
  5:  [{tier:'Adept',       range:'810K – 1.22M'},   {tier:'Adept',       range:'1.22M – 2.43M'},  {tier:'Warrior',      range:'2.43M – 3.64M'},   {tier:'Knight',       range:'Over 3.64M'}],
  9:  [{tier:'Warrior',     range:'2.92M – 3.89M'},  {tier:'Warrior',     range:'3.89M – 7.77M'},  {tier:'Knight',       range:'7.77M – 11.65M'},  {tier:'Guardian',     range:'Over 11.65M'}],
  13: [{tier:'Knight',      range:'5.43M – 7.24M'},  {tier:'Guardian',    range:'7.24M – 14.47M'}, {tier:'Master',       range:'14.47M – 21.70M'}, {tier:'Grandmaster',  range:'Over 21.70M'}],
  17: [{tier:'Guardian',    range:'9.80M – 13.06M'}, {tier:'Master',      range:'13.06M – 26.12M'},{tier:'Grandmaster',  range:'26.12M – 39.17M'},{tier:'Ultimate',     range:'Over 39.17M'}],
  21: [{tier:'Mythical',    range:'17.57M – 23.43M'},{tier:'Divine',      range:'23.43M – 46.85M'},{tier:'Celestial',    range:'46.85M – 70.28M'},{tier:'Transcendent', range:'Over 70.28M'}],
};
const HYDRA_REWARDS = {
  1: [{tier:'Novice',   range:'1.67M – 2.22M'},{tier:'Novice',  range:'2.22M – 4.44M'},{tier:'Adept',    range:'4.44M – 6.66M'},{tier:'Warrior',      range:'6.66M+'}],
  2: [{tier:'Adept',    range:'5.10M – 6.80M'},{tier:'Adept',   range:'6.80M – 13.60M'},{tier:'Warrior', range:'13.60M – 20.40M'},{tier:'Knight',      range:'20.40M+'}],
  3: [{tier:'Warrior',  range:'7.35M – 9.80M'},{tier:'Warrior', range:'9.80M – 19.60M'},{tier:'Knight',  range:'19.60M – 29.40M'},{tier:'Guardian',    range:'29.40M+'}],
  4: [{tier:'Knight',   range:'9.15M – 12.20M'},{tier:'Guardian',range:'12.20M – 24.40M'},{tier:'Master',range:'24.40M – 36.60M'},{tier:'Grandmaster', range:'36.60M+'}],
};
const CHIMERA_REWARDS = {
  1: [{tier:'Novice',   range:'900K – 1.50M'},  {tier:'Novice',  range:'1.50M – 3.00M'}, {tier:'Adept',    range:'3.00M – 4.15M'},    {tier:'Warrior',      range:'4.15M+'}],
  2: [{tier:'Adept',    range:'2.10M – 3.50M'}, {tier:'Adept',   range:'3.50M – 7.00M'}, {tier:'Warrior',  range:'7.00M – 9.75M'},    {tier:'Knight',       range:'9.75M+'}],
  3: [{tier:'Warrior',  range:'4.40M – 7.25M'}, {tier:'Warrior', range:'7.25M – 14.60M'},{tier:'Knight',   range:'14.60M – 20.50M'},{tier:'Guardian',     range:'20.50M+'}],
  4: [{tier:'Knight',   range:'7.70M – 12.80M'},{tier:'Knight',  range:'12.80M – 25.65M'},{tier:'Guardian',range:'25.65M – 36.00M'},{tier:'Master',       range:'36.00M+'}],
  5: [{tier:'Knight',   range:'18.00M – 30.00M'},{tier:'Guardian',range:'30.00M – 60.00M'},{tier:'Master', range:'60.00M – 84.00M'},{tier:'Grandmaster',  range:'84.00M+'}],
  6: [{tier:'Guardian', range:'24.10M – 40.00M'},{tier:'Master', range:'40.00M – 80.40M'},{tier:'Grandmaster',range:'80.40M – 112.50M'},{tier:'Ultimate',  range:'112.50M+'}],
};

// Doom Tower: collapsible groups of 10 + Secret Rooms (121-132)
const DT_REGIONS = new Set([701, 702, 703]);

// Secret Room champion conditions: [regionId][difficulty 1=Normal 2=Hard][SR index 0–11]
const DT_SR_CONDITIONS = {
  701: { // Rotation 1
    1: [ // Normal
      'Rare Champions',
      'Banner Lords',
      'Attack Champions',
      'Magic Affinity',
      'Epic Champions',
      'Spirit Affinity',
      'Skinwalkers',
      'HP Champions',
      'Dwarves',
      'Force Affinity',
      'Sacred Order',
      'Void Affinity',
    ],
    2: [ // Hard
      'Epic Champions',
      'Dark Elves',
      'Defense Champions',
      'Epic Lizardmen',
      'Rare Attack',
      'Support Champions',
      'High Elves',
      'Epic Spirit Champions',
      'Demonspawn',
      'HP Champions',
      'Epic Undead Hordes',
      'Void Affinity',
    ],
  },
  702: { // Rotation 2
    1: [ // Normal
      'Rare Champions',
      'Force Affinity',
      'Attack Champions',
      'Barbarians',
      'Rare Void Affinity',
      'Defense Champions',
      'Epic Champions',
      'Epic Orcs',
      'Epic Spirit Affinity',
      'Support Champions',
      'Void Affinity',
      'Epic Magic',
    ],
    2: [ // Hard
      'Epic Champions',
      'HP Champions',
      'Force Attack Champions',
      'Rare Spirit Affinity',
      'Ogryn Tribes',
      'Epic Void Affinity',
      'Magic Affinity Support',
      'Epic Defense Champions',
      'Rare Attack Champions',
      'Epic Knights Revenant',
      '6 Star Void Affinity',
      'Rare Magic Champions',
    ],
  },
  703: { // Rotation 3
    1: [ // Normal
      'Rare Champions',
      'HP Champions',
      'Spirit Affinity',
      'Telerian Factions',
      'Defense Champions',
      'Magic Champions',
      'Epic Attack Champions',
      'Force Champions',
      'Gaellen Pact Factions',
      'Support Champions',
      '6 Star Champions',
      'Rare Void Champions',
    ],
    2: [ // Hard
      'Epic Champions',
      '6 Star Attack Champions',
      'Epic Spirit Affinity',
      'Corrupted Factions',
      'Force Defense Champions',
      'Magic Support Champions',
      'Rare HP Champions',
      'Force HP Champions',
      'Void Support Champions',
      'Nyseran Union Factions',
      'Epic Magic Affinity',
      '6 Star Void Attack Champions',
    ],
  },
};

// Grim Forest: 4 rotations, grouped by enemy level + special types
const GF_REGIONS = new Set([1401, 1402, 1403, 1404]);
// Boss names per stage_num (only rotation 2 / region 1402 has boss stages)
const GF_BOSS_NAMES = {
  127: 'Leshun', 128: 'Isheth', 129: 'Tauraze', 130: 'Maximoz', 131: 'Draugnell'
};

// Faction Wars: collapsible groups of 7 (boss on stage 7/14/21)
const FW_REGIONS = new Set([501,502,503,505,506,507,508,509,510,511,512,513,514,515,516]);

// Hard 3★ challenge per stage (index 0 = stage 1), keyed by region_id
const FW_HARD_3STAR = {
  501: [ // Banner Lords
    'Reduce 6+ enemies\' HP by 50% with one skill',
    'Place 10+ Provoke debuffs',
    'Place 10+ Stun debuffs',
    'Manipulate buff or debuff duration 20+ times',
    'Land 40+ hits on enemies while they are under Leech debuffs',
    'Manipulate Turn Meters 40+ times',
    'Clear the Stage in 100 turns',
    'Reduce 9+ enemies\' HP by 50% with one skill',
    'Place 15+ Provoke debuffs',
    'Use at least 3 Epic Champions',
    'Defeat all enemies when they have no buffs on them',
    'Place 15+ Stun debuffs',
    'Do not receive more than 10 debuffs',
    'Clear the Stage in 150 turns',
    'Beat the Stage with all Champions alive at all times',
    'Defeat 3+ enemies using Ally Attack skills or counterattacks',
    'Don\'t land any weak hits',
    'Defeat 4+ enemies before they take a turn',
    'Get an Extra Turn 5+ times',
    'Keep all your Champion\'s HP above 75%',
    'Clear the Stage in 200 turns',
  ],
  502: [ // High Elves
    'Heal your Champions\' HP by 500,000+',
    'Place 10+ Freeze debuffs',
    'Place 10+ Stun debuffs',
    'Reduce 6+ enemies\' HP by 50% with one skill',
    'Manipulate buff or debuff duration 20+ times',
    'Manipulate Turn Meters 40+ times',
    'Clear the Stage in 100 turns',
    'Heal your Champions\' HP by 1,000,000+',
    'Place 15+ Freeze debuffs',
    'Use at least 3 Epic Champions',
    'Place 15+ Stun debuffs',
    'Defeat all enemies when they have no buffs on them',
    'Reduce 9+ enemies\' HP by 50% with one skill',
    'Clear the Stage in 150 turns',
    'Beat the Stage with all Champions alive at all times',
    'Get an Extra Turn 5+ times',
    'Don\'t land any weak hits',
    'Defeat 4+ enemies before they take a turn',
    'Defeat 3+ enemies using Ally Attack skills or counterattacks',
    'Defeat 3+ enemies while your Champions are under 7 or more buffs',
    'Clear the Stage in 200 turns',
  ],
  503: [ // Sacred Order
    'Place 10+ Provoke debuffs',
    'Place 20+ Poison debuffs',
    'Place 10+ Stun debuffs',
    'Reduce 6+ enemies\' HP by 50% with one skill',
    'Place 10+ HP Burn debuffs',
    'Manipulate Turn Meters 40+ times',
    'Clear the Stage in 100 turns',
    'Place 15+ Provoke debuffs',
    'Defeat 3+ enemies using Ally Attack skills or counterattacks',
    'Use at least 3 Epic Champions',
    'Reduce 9+ enemies\' HP by 50% with one skill',
    'Defeat all enemies when they have no buffs on them',
    'Place 15+ HP Burn debuffs',
    'Clear the Stage in 150 turns',
    'Beat the Stage with all Champions alive at all times',
    'Get an Extra Turn 5+ times',
    'Don\'t land any weak hits',
    'Defeat 4+ enemies before they take a turn',
    'Defeat 3+ enemies while they\'re under 10 debuffs',
    'Keep all your Champion\'s HP above 75%',
    'Clear the Stage in 200 turns',
  ],
  505: [ // Ogryn Tribes
    'Place 20+ Poison debuffs',
    'Place 10+ Stun debuffs',
    'Place 10+ Provoke debuffs',
    'Manipulate buff or debuff duration 20+ times',
    'Land 40+ hits on enemies while they are under Leech debuffs',
    'Manipulate Turn Meters 40+ times',
    'Clear the Stage in 100 turns',
    'Place 15+ Stun debuffs',
    'Place 15+ Provoke debuffs',
    'Use at least 3 Epic Champions',
    'Defeat 10+ enemies using Bomb debuffs',
    'Place 15+ HP Burn debuffs',
    'Defeat all enemies when they have no buffs on them',
    'Clear the Stage in 150 turns',
    'Beat the Stage with all Champions alive at all times',
    'Get an Extra Turn 5+ times',
    'Don\'t land any weak hits',
    'Defeat 3+ enemies while your Champions are under 7 or more buffs',
    'Defeat 3+ enemies while they\'re under 10 debuffs',
    'Keep all your Champion\'s HP above 75%',
    'Clear the Stage in 200 turns',
  ],
  506: [ // Lizardmen
    'Heal your Champions\' HP by 500,000+',
    'Place 10+ Stun debuffs',
    'Place 20+ Poison debuffs',
    'Place 10+ Provoke debuffs',
    'Reduce 6+ enemies\' HP by 50% with one skill',
    'Manipulate Turn Meters 40+ times',
    'Clear the Stage in 100 turns',
    'Heal your Champions\' HP by 1,000,000+',
    'Place 15+ Stun debuffs',
    'Use at least 3 Epic Champions',
    'Place 15+ Provoke debuffs',
    'Defeat all enemies when they have no buffs on them',
    'Reduce 9+ enemies\' HP by 50% with one skill',
    'Clear the Stage in 150 turns',
    'Beat the Stage with all Champions alive at all times',
    'Get an Extra Turn 5+ times',
    'Don\'t land any weak hits',
    'Defeat 4+ enemies before they take a turn',
    'Defeat 3+ enemies while they\'re under 10 debuffs',
    'Keep all your Champion\'s HP above 75%',
    'Clear the Stage in 200 turns',
  ],
  507: [ // Skinwalkers
    'Place 20+ Poison debuffs',
    'Place 10+ Stun debuffs',
    'Manipulate buff or debuff duration 20+ times',
    'Place 10+ Provoke debuffs',
    'Reduce 6+ enemies\' HP by 50% with one skill',
    'Manipulate Turn Meters 40+ times',
    'Clear the Stage in 100 turns',
    'Place 15+ Stun debuffs',
    'Place 15+ Provoke debuffs',
    'Use at least 3 Epic Champions',
    'Manipulate buff or debuff duration 30+ times',
    'Defeat all enemies when they have no buffs on them',
    'Defeat 3+ enemies using Ally Attack skills or counterattacks',
    'Clear the Stage in 150 turns',
    'Beat the Stage with all Champions alive at all times',
    'Get an Extra Turn 5+ times',
    'Don\'t land any weak hits',
    'Defeat 3+ enemies while your Champions are under 7 or more buffs',
    'Don\'t let your enemies use any active skills',
    'Defeat 3+ enemies while they\'re under 10 debuffs',
    'Clear the Stage in 200 turns',
  ],
  508: [ // Orcs
    'Place 10+ Provoke debuffs',
    'Place 10+ Stun debuffs',
    'Reduce 6+ enemies\' HP by 50% with one skill',
    'Manipulate skill cooldowns 10+ times',
    'Place 10+ HP Burn debuffs',
    'Manipulate Turn Meters 40+ times',
    'Clear the Stage in 100 turns',
    'Place 15+ Provoke debuffs',
    'Place 15+ Stun debuffs',
    'Use at least 3 Epic Champions',
    'Defeat all enemies when they have no buffs on them',
    'Manipulate buff or debuff duration 30+ times',
    'Defeat 3+ enemies using Ally Attack skills or counterattacks',
    'Clear the Stage in 150 turns',
    'Beat the Stage with all Champions alive at all times',
    'Defeat 4+ enemies before they take a turn',
    'Don\'t land any weak hits',
    'Defeat 3+ enemies while your Champions are under 7 or more buffs',
    'Don\'t let your enemies use any active skills',
    'Keep all your Champion\'s HP above 75%',
    'Clear the Stage in 200 turns',
  ],
  509: [ // Demonspawn
    'Place 10+ HP Burn debuffs',
    'Place 10+ Provoke debuffs',
    'Place 20+ Poison debuffs',
    'Defeat 5+ enemies using Bomb debuffs',
    'Place 10+ Stun debuffs',
    'Manipulate Turn Meters 40+ times',
    'Clear the Stage in 100 turns',
    'Place 15+ HP Burn debuffs',
    'Defeat 10+ enemies using Bomb debuffs',
    'Use at least 3 Epic Champions',
    'Defeat all enemies when they have no buffs on them',
    'Place 15+ Provoke debuffs',
    'Place 15+ Stun debuffs',
    'Clear the Stage in 150 turns',
    'Beat the Stage with all Champions alive at all times',
    'Don\'t let your enemies use any active skills',
    'Don\'t land any weak hits',
    'Defeat 10+ enemies while your Champions are under Perfect Veil',
    'Place 10+ Block Revive debuffs',
    'Defeat 4+ enemies before they take a turn',
    'Clear the Stage in 200 turns',
  ],
  510: [ // Undead Hordes
    'Place 20+ Poison debuffs',
    'Land 40+ hits on enemies while they are under Leech debuffs',
    'Place 10+ Stun debuffs',
    'Place 10+ Provoke debuffs',
    'Place 10+ Sleep debuffs',
    'Manipulate Turn Meters 40+ times',
    'Clear the Stage in 100 turns',
    'Land 60+ hits on enemies while they are under Leech debuffs',
    'Defeat all enemies when they have no buffs on them',
    'Use at least 3 Epic Champions',
    'Place 15+ Stun debuffs',
    'Place 15+ Provoke debuffs',
    'Place 15+ Sleep debuffs',
    'Clear the Stage in 150 turns',
    'Beat the Stage with all Champions alive at all times',
    'Defeat 3+ enemies using Ally Attack skills or counterattacks',
    'Don\'t land any weak hits',
    'Defeat 10+ enemies while they are under Fear/True Fear debuffs',
    'Don\'t let your enemies use any active skills',
    'Don\'t let your enemies heal',
    'Clear the Stage in 200 turns',
  ],
  511: [ // Dark Elves
    'Place 20+ Poison debuffs',
    'Place 10+ Freeze debuffs',
    'Place 10+ Provoke debuffs',
    'Place 10+ Sleep debuffs',
    'Defeat 6+ enemies while they\'re under Hex debuffs',
    'Manipulate Turn Meters 40+ times',
    'Clear the Stage in 100 turns',
    'Defeat all enemies when they have no buffs on them',
    'Place 15+ Freeze debuffs',
    'Use at least 3 Epic Champions',
    'Place 15+ Provoke debuffs',
    'Manipulate skill cooldowns 15+ times',
    'Do not receive more than 10 debuffs',
    'Clear the Stage in 150 turns',
    'Beat the Stage with all Champions alive at all times',
    'Place 10+ Block Revive debuffs',
    'Don\'t land any weak hits',
    'Defeat 10+ enemies while your Champions are under Perfect Veil',
    'Defeat 3+ enemies while they\'re under 10 debuffs',
    'Don\'t let your enemies heal',
    'Clear the Stage in 200 turns',
  ],
  512: [ // Knights Revenant
    'Place 20+ Poison debuffs',
    'Place 10+ Stun debuffs',
    'Place 10+ Provoke debuffs',
    'Manipulate skill cooldowns 10+ times',
    'Defeat 6+ enemies while they\'re under Hex debuffs',
    'Manipulate Turn Meters 40+ times',
    'Clear the Stage in 100 turns',
    'Place 15+ Provoke debuffs',
    'Manipulate skill cooldowns 15+ times',
    'Use at least 3 Epic Champions',
    'Defeat all enemies when they have no buffs on them',
    'Place 15+ Stun debuffs',
    'Manipulate buff or debuff duration 30+ times',
    'Clear the Stage in 150 turns',
    'Beat the Stage with all Champions alive at all times',
    'Defeat 10+ enemies while they are under Fear/True Fear debuffs',
    'Don\'t land any weak hits',
    'Defeat 3+ enemies while they\'re under 10 debuffs',
    'Get an Extra Turn 5+ times',
    'Defeat 4+ enemies before they take a turn',
    'Clear the Stage in 200 turns',
  ],
  513: [ // Barbarians
    'Place 10+ Stun debuffs',
    'Place 10+ Provoke debuffs',
    'Place 10+ Freeze debuffs',
    'Place 5+ HP Burn debuffs',
    'Manipulate skill cooldowns 10+ times',
    'Manipulate Turn Meters 40+ times',
    'Clear the Stage in 100 turns',
    'Place 10+ HP Burn debuffs',
    'Place 15+ Stun debuffs',
    'Use at least 3 Epic Champions',
    'Place 15+ Provoke debuffs',
    'Defeat 3+ enemies using Ally Attack skills or counterattacks',
    'Do not receive more than 10 debuffs',
    'Clear the Stage in 150 turns',
    'Beat the Stage with all Champions alive at all times',
    'Don\'t let your enemies use any active skills',
    'Don\'t land any weak hits',
    'Get an Extra Turn 5+ times',
    'Defeat 4+ enemies before they take a turn',
    'Keep all your Champion\'s HP above 75%',
    'Clear the Stage in 200 turns',
  ],
  514: [ // Sylvan Watchers
    'Heal your Champions\' HP by 500,000+',
    'Place 10+ Freeze debuffs',
    'Place 10+ Decrease SPD debuffs',
    'Manipulate buff or debuff duration 20+ times',
    'Manipulate skill cooldowns 10+ times',
    'Manipulate Turn Meters 40+ times',
    'Clear the Stage in 100 turns',
    'Heal your Champions\' HP by 1,000,000+',
    'Place 15+ Freeze debuffs',
    'Use at least 3 Epic Champions',
    'Manipulate Turn Meters 60+ times',
    'Manipulate skill cooldowns 15+ times',
    'Manipulate buff or debuff duration 30+ times',
    'Clear the Stage in 150 turns',
    'Beat the Stage with all Champions alive at all times',
    'Defeat 3+ enemies using Ally Attack skills or counterattacks',
    'Don\'t land any weak hits',
    'Place 4+ Taunt buffs',
    'Defeat 3+ enemies while your Champions are under 7 or more buffs',
    'Keep all your Champion\'s HP above 75%',
    'Clear the Stage in 200 turns',
  ],
  515: [ // Shadowkin
    'Place 10+ Stun debuffs',
    'Place 10+ Provoke debuffs',
    'Place 10+ HP Burn debuffs',
    'Manipulate skill cooldowns 10+ times',
    'Land 40+ hits on enemies while they are under Leech debuffs',
    'Manipulate Turn Meters 40+ times',
    'Clear the Stage in 100 turns',
    'Place 15+ Stun debuffs',
    'Place 15+ Provoke debuffs',
    'Use at least 3 Epic Champions',
    'Land 60+ hits on enemies while they are under Leech debuffs',
    'Manipulate skill cooldowns 15+ times',
    'Defeat all enemies when they have no buffs on them',
    'Clear the Stage in 150 turns',
    'Beat the Stage with all Champions alive at all times',
    'Defeat 10+ enemies while your Champions are under Perfect Veil',
    'Don\'t land any weak hits',
    'Defeat 4+ enemies before they take a turn',
    'Defeat 3+ enemies while they\'re under 10 debuffs',
    'Don\'t let your enemies use any active skills',
    'Clear the Stage in 200 turns',
  ],
  516: [ // Dwarves
    'Place 10+ HP Burn debuffs',
    'Place 10+ Stun debuffs',
    'Place 10+ Provoke debuffs',
    'Place 10+ Freeze debuffs',
    'Reduce 6+ enemies\' HP by 50% with one skill',
    'Manipulate Turn Meters 40+ times',
    'Clear the Stage in 100 turns',
    'Place 15+ HP Burn debuffs',
    'Place 15+ Stun debuffs',
    'Use at least 3 Epic Champions',
    'Place 15+ Provoke debuffs',
    'Defeat all enemies when they have no buffs on them',
    'Manipulate skill cooldowns 15+ times',
    'Clear the Stage in 150 turns',
    'Beat the Stage with all Champions alive at all times',
    'Defeat 3+ enemies using Ally Attack skills or counterattacks',
    'Don\'t land any weak hits',
    'Get an Extra Turn 5+ times',
    'Defeat 3+ enemies while your Champions are under 7 or more buffs',
    'Keep all your Champion\'s HP above 75%',
    'Clear the Stage in 200 turns',
  ],
};

function stageLabel(stageNum, regionId) {
  if (regionId === 401)           return CB_VOID_STAGES.get(stageNum)        ?? `${stageNum}`;
  if (HYDRA_REGIONS.has(regionId))   return HYDRA_STAGE_LABELS[stageNum]   ?? `${stageNum}`;
  if (CHIMERA_REGIONS.has(regionId)) return CHIMERA_STAGE_LABELS[stageNum] ?? `${stageNum}`;
  if (DT_REGIONS.has(regionId))   return stageNum >= 121 ? `SR ${stageNum - 120}` : `Floor ${stageNum}`;
  if (GF_REGIONS.has(regionId) && GF_BOSS_NAMES[stageNum]) return GF_BOSS_NAMES[stageNum];
  return `${stageNum}`;
}

// ── Generic collapsible stage group renderer ──────────────────────────────────
// ── Horizontal 2-row stage group renderers ────────────────────────────────────
function renderGroupedStages(allStages, list, groupSize) {
  const groups = new Map();
  for (const s of allStages) {
    const key = Math.floor((s.stage_num - 1) / groupSize) * groupSize + 1;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  renderHorizontalGroups(groups, list,
    (_key, s) => `${s.stage_num}`,
    (key)    => `${key}–${key + groupSize - 1}`
  );
}

function renderHorizontalGroups(groups, list, stageLabel, groupLabel) {
  // Normalise keys to strings so data-key attributes always match (supports both numeric and string keys)
  const strGroups = new Map([...groups.entries()].map(([k, v]) => [String(k), v]));

  list.classList.add('stage-list--grouped');
  document.getElementById('stage-section')?.classList.add('strip--grouped');
  const groupRow = document.createElement('div');
  groupRow.className = 'strip-group-row';
  const stageRow = document.createElement('div');
  stageRow.className = 'strip-stage-row';

  function showGroup(key) {
    const skey = String(key);
    groupRow.querySelectorAll('.stage-group-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.key === skey)
    );
    const activeGroupBtn = groupRow.querySelector('.stage-group-btn.active');
    if (activeGroupBtn) slideIndicator(groupRow, activeGroupBtn, '#d4af37', 'rgba(212,175,55,.1)');
    stageRow.innerHTML = (strGroups.get(skey) || []).map(s =>
      `<button class="stage-btn" data-stage="${s.id}">${stageLabel(skey, s)}</button>`
    ).join('');
    stageRow.querySelectorAll('.stage-btn').forEach(b =>
      b.addEventListener('click', () => loadStage(+b.dataset.stage))
    );
    requestAnimationFrame(() => requestAnimationFrame(() => { snapCenter(groupRow); snapCenter(stageRow); }));
  }

  groupRow.innerHTML = [...strGroups.keys()].map(key =>
    `<button class="stage-group-btn" data-key="${key}">${groupLabel(key)}</button>`
  ).join('');
  groupRow.querySelectorAll('.stage-group-btn').forEach(btn =>
    btn.addEventListener('click', () => showGroup(btn.dataset.key))
  );

  list.innerHTML = '';
  list.appendChild(groupRow);
  list.appendChild(stageRow);

  // Auto-show first group — suppress indicator animation during initial render
  const firstKey = [...groups.keys()][0];
  if (firstKey !== undefined) {
    document.body.classList.add('no-anim');
    showGroup(firstKey);
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => {
      document.body.classList.remove('no-anim');
    }))));
  }
}

// ── Difficulty buttons ────────────────────────────────────────────────────────
const DIFF_COLORS = { 1:'normal', 2:'hard', 3:'brutal', 4:'nightmare' };
// Diff pill: background only (no border — button already has its own colored border)
const DIFF_IND = {
  easy:      { bg: 'rgba(158,158,158,.18)' },
  normal:    { bg: 'rgba(76,175,80,.18)'   },
  hard:      { bg: 'rgba(33,150,243,.18)'  },
  brutal:    { bg: 'rgba(255,152,0,.18)'   },
  nightmare: { bg: 'rgba(244,67,54,.18)'   },
};

function renderDiffButtons(diffs, autoSelect = true) {
  const el = document.getElementById('diff-buttons');
  el.innerHTML = diffs.map(d =>
    `<button class="diff-btn diff-${DIFF_COLORS[d.difficulty] ?? 'normal'}"
             data-diff="${d.difficulty}">${d.diff_name}</button>`
  ).join('');
  el.querySelectorAll('.diff-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      sectionCollapse('diff-section', btn.textContent.trim(), goBackToDiff);
      selectDiff(+btn.dataset.diff);
    })
  );
  if (autoSelect && diffs.length) selectDiff(diffs[0].difficulty);
}

function selectDiff(diff) {
  const prevRegion = selectedRegion;
  selectedDiff     = diff;
  selectedRegion   = null;
  document.querySelectorAll('.diff-btn').forEach(b =>
    b.classList.toggle('active', +b.dataset.diff === diff)
  );
  const activeDiffBtn = document.querySelector('.diff-btn.active');
  if (activeDiffBtn) {
    const cls = [...activeDiffBtn.classList].find(c => c.startsWith('diff-') && c !== 'diff-btn');
    const ind = DIFF_IND[cls?.replace('diff-', '')] ?? { bg: 'rgba(212,175,55,.15)' };
    slideIndicator(document.getElementById('diff-buttons'), activeDiffBtn, null, ind.bg);
  }

  if (prevRegion) {
    // Region already selected (dungeon flow or re-selecting diff in campaign)
    selectedRegion = prevRegion;
    renderStageList(prevRegion);
  } else {
    renderRegionList();
  }
}

// ── Region list ───────────────────────────────────────────────────────────────
function renderRegionList(autoRegion = null) {
  const areaRegions = regions.filter(r => r.area_id === selectedArea);

  // Skip region strip when there's only one ungrouped region (e.g. Clan Boss)
  const hasGroups = areaRegions.some(r => GROUPED_IDS.has(r.id));
  if (areaRegions.length === 1 && !hasGroups) {
    hideStrip('region-section');
    selectRegion(areaRegions[0].id);
    return;
  }

  const el = document.getElementById('region-list');
  const isCampaign = selectedZoneKey === 'Campaign';

  // Collect which groups are present in this area
  const presentGroups = new Set();
  const regularRegions = [];
  for (const r of areaRegions) {
    if (GROUPED_IDS.has(r.id)) presentGroups.add(REGION_TO_GROUP[r.id]);
    else regularRegions.push(r);
  }

  let html;
  if (isCampaign) {
    // Numbered buttons — name shown in display below, not inside button (avoids width-change bug)
    html = regularRegions.map((r, i) => {
      const subName = r.name.replace(/^\d+\s*[-–\.]\s*/, '').trim() || r.name;
      return `<button class="region-btn region-btn--numbered" data-region="${r.id}" data-name="${subName}">${i + 1}</button>`;
    }).join('');
    document.getElementById('region-name-display').textContent = '';
  } else if (selectedZoneKey === 'Dungeons') {
    // Iron Twins → Potion Keeps (group btns) → dungeons in game order
    html  = `<button class="region-btn group-btn" data-group="ironTwins">${REGION_GROUPS.ironTwins.label}</button>`;
    html += `<button class="region-btn group-btn" data-group="potionKeeps">${REGION_GROUPS.potionKeeps.label}</button>`;
    html += DUNGEON_ORDER.map(id => {
      const r = regularRegions.find(rr => rr.id === id);
      return r ? `<button class="region-btn" data-region="${r.id}">${r.name}</button>` : '';
    }).join('');
  } else {
    html = regularRegions.map(r =>
      `<button class="region-btn" data-region="${r.id}">${r.name}</button>`
    ).join('');
    for (const key of presentGroups) {
      html += `<button class="region-btn group-btn" data-group="${key}">${REGION_GROUPS[key].label}</button>`;
    }
  }

  el.innerHTML = html;
  showStrip('region-section'); // content is ready, now animate in

  el.querySelectorAll('.region-btn:not(.group-btn)').forEach(btn =>
    btn.addEventListener('click', () => {
      hideStrip('affinity-section');
      if (isCampaign && btn.dataset.name) {
        document.getElementById('region-name-display').textContent = btn.dataset.name;
      }
      selectRegion(+btn.dataset.region);
    })
  );
  el.querySelectorAll('.group-btn').forEach(btn =>
    btn.addEventListener('click', () => openGroup(btn.dataset.group))
  );

  // Auto-reselect
  if (autoRegion && areaRegions.some(r => r.id === autoRegion)) {
    if (GROUPED_IDS.has(autoRegion)) {
      const key = REGION_TO_GROUP[autoRegion];
      el.querySelectorAll('.group-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.group === key)
      );
      openGroup(key, autoRegion);
    } else {
      if (isCampaign) {
        const btn = el.querySelector(`[data-region="${autoRegion}"]`);
        if (btn?.dataset.name) document.getElementById('region-name-display').textContent = btn.dataset.name;
      }
      selectRegion(autoRegion);
    }
  } else {
    hideStrip('affinity-section');
    hideStrip('stage-section');
    clearStageView();
  }
}

function openGroup(key, autoSelectId = null) {
  selectedGroup = key;
  const group   = REGION_GROUPS[key];

  document.querySelectorAll('.group-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.group === key)
  );

  document.getElementById('affinity-label').textContent = group.label;
  const affList = document.getElementById('affinity-list');

  affList.innerHTML = group.regions.map(r => {
    const aff = r.affinity?.toLowerCase();
    const icon = (!group.noIcon && r.affinity)
      ? `<img src="/tools/champions-index/img/affinity/${r.affinity}.webp" class="it-aff-icon" alt="">`
      : '';
    return `<button class="region-btn${aff ? ` it-btn it-${aff}` : ''}" data-region="${r.id}">${icon}${r.affinity || r.label || 'Arcane'}</button>`;
  }).join('');

  affList.querySelectorAll('.region-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      if (!group.stayVisible) hideStrip('affinity-section');
      selectRegion(+btn.dataset.region);
    })
  );

  showStrip('affinity-section');

  if (autoSelectId) selectRegion(autoSelectId);
}

function selectRegion(regionId) {
  selectedRegion = regionId;

  document.querySelectorAll('#region-list .region-btn').forEach(b =>
    b.classList.toggle('active', +b.dataset.region === regionId)
  );
  document.querySelectorAll('#affinity-list .region-btn').forEach(b =>
    b.classList.toggle('active', +b.dataset.region === regionId)
  );
  const activeRegionBtn = document.querySelector('#region-list .region-btn.active')
                       || document.querySelector('#affinity-list .region-btn.active');
  if (activeRegionBtn) {
    const affCls = [...activeRegionBtn.classList].find(c => /^it-/.test(c));
    const border = affCls ? null : '#d4af37';
    const bg     = affCls ? 'rgba(212,175,55,.08)' : 'rgba(212,175,55,.1)';
    slideIndicator(activeRegionBtn.closest('.strip-list'), activeRegionBtn, border, bg);
  }

  const diffs = query(
    `SELECT DISTINCT difficulty, diff_name FROM stages WHERE region_id=? ORDER BY CASE difficulty WHEN 9 THEN 1 ELSE difficulty END`,
    [regionId]
  );
  if (!diffs.length) return;

  // If a stage was previously viewed, pick the best diff to keep the same stage_num
  if (currentStageNum && diffs.length > 1) {
    const hasCurrent = selectedDiff != null
      && diffs.some(d => d.difficulty === selectedDiff)
      && query(`SELECT 1 FROM stages WHERE region_id=? AND difficulty=? AND stage_num=? LIMIT 1`,
               [regionId, selectedDiff, currentStageNum]).length > 0;
    if (!hasCurrent) {
      const best = diffs.find(d =>
        query(`SELECT 1 FROM stages WHERE region_id=? AND difficulty=? AND stage_num=? LIMIT 1`,
              [regionId, d.difficulty, currentStageNum]).length > 0
      );
      if (best) selectedDiff = best.difficulty;
    }
  }

  // Ensure selectedDiff is valid for this region
  if (selectedDiff == null || !diffs.some(d => d.difficulty === selectedDiff)) {
    selectedDiff = diffs[0].difficulty;
  }

  if (diffs.length > 1) {
    showStrip('diff-section');
    renderDiffButtons(diffs, false);
    document.querySelectorAll('.diff-btn').forEach(b =>
      b.classList.toggle('active', +b.dataset.diff === selectedDiff)
    );
    const activeDiffBtn = document.querySelector('.diff-btn.active');
    if (activeDiffBtn) {
      const cls = [...activeDiffBtn.classList].find(c => c.startsWith('diff-') && c !== 'diff-btn');
      const ind = DIFF_IND[cls?.replace('diff-', '')] ?? { border: '#d4af37', bg: 'rgba(212,175,55,.1)' };
      slideIndicator(document.getElementById('diff-buttons'), activeDiffBtn, ind.border, ind.bg);
    }
  } else {
    hideStrip('diff-section');
    selectedDiff = diffs[0].difficulty;
  }

  renderStageList(regionId);
}

// ── Stage list ────────────────────────────────────────────────────────────────
function renderStageList(regionId) {
  const allStages = query(
    `SELECT id, stage_num FROM stages WHERE region_id=? AND difficulty=? ORDER BY stage_num`,
    [regionId, selectedDiff]
  );

  const section = document.getElementById('stage-section');
  const label   = document.getElementById('stage-section-label');
  const list    = document.getElementById('stage-list');

  if (!allStages.length) { hideStrip('stage-section'); return; }
  showStrip('stage-section');
  list.classList.remove('diff-mode', 'fw-list', 'stage-list--center', 'stage-list--grouped');
  document.getElementById('stage-section')?.classList.remove('strip--grouped');
  list.style.gridAutoColumns = '';
  list.style.width = '';

  // ── Clan Boss: Void stages only ───────────────────────────────────────────
  if (regionId === 401) {
    const stages = allStages.filter(s => CB_VOID_STAGES.has(s.stage_num));
    label.textContent = 'Difficulty';
    list.classList.add('diff-mode');
    list.innerHTML = stages.map(s =>
      `<button class="diff-btn diff-${CB_DIFF_CLASS[s.stage_num] ?? 'normal'}" data-stage="${s.id}">${CB_VOID_STAGES.get(s.stage_num)}</button>`
    ).join('');
    list.querySelectorAll('[data-stage]').forEach(b => b.addEventListener('click', () => loadStage(+b.dataset.stage)));
    fitDiffModeButtons(list);
    const target = currentStageNum && stages.find(s => s.stage_num === currentStageNum);
    if (target) loadStage(target.id); else clearStageView();
    return;
  }

  // ── Hydra ─────────────────────────────────────────────────────────────────
  if (HYDRA_REGIONS.has(regionId)) {
    label.textContent = 'Difficulty';
    list.classList.add('diff-mode');
    list.innerHTML = allStages.map(s =>
      `<button class="diff-btn diff-${HYDRA_DIFF_CLASS[s.stage_num] ?? 'normal'}" data-stage="${s.id}">${HYDRA_STAGE_LABELS[s.stage_num] ?? s.stage_num}</button>`
    ).join('');
    list.querySelectorAll('[data-stage]').forEach(b => b.addEventListener('click', () => loadStage(+b.dataset.stage)));
    fitDiffModeButtons(list);
    const target = currentStageNum && allStages.find(s => s.stage_num === currentStageNum);
    if (target) loadStage(target.id); else clearStageView();
    return;
  }

  // ── Chimera ───────────────────────────────────────────────────────────────
  if (CHIMERA_REGIONS.has(regionId)) {
    label.textContent = 'Difficulty';
    list.classList.add('diff-mode');
    list.innerHTML = allStages.map(s =>
      `<button class="diff-btn diff-${CHIMERA_DIFF_CLASS[s.stage_num] ?? 'normal'}" data-stage="${s.id}">${CHIMERA_STAGE_LABELS[s.stage_num] ?? s.stage_num}</button>`
    ).join('');
    list.querySelectorAll('[data-stage]').forEach(b => b.addEventListener('click', () => loadStage(+b.dataset.stage)));
    fitDiffModeButtons(list);
    const target = currentStageNum && allStages.find(s => s.stage_num === currentStageNum);
    if (target) loadStage(target.id); else clearStageView();
    return;
  }

  // ── Faction Wars: flat list (no wrapping – scroll horizontally) ──────────
  if (FW_REGIONS.has(regionId)) {
    list.classList.add('fw-list');
    label.textContent = `Stages (${allStages.length})`;
    list.innerHTML = allStages.map(s =>
      `<button class="stage-btn" data-stage="${s.id}">${s.stage_num}</button>`
    ).join('');
    list.querySelectorAll('.stage-btn').forEach(b => b.addEventListener('click', () => loadStage(+b.dataset.stage)));
    const target = currentStageNum && allStages.find(s => s.stage_num === currentStageNum);
    if (target) loadStage(target.id); else clearStageView();
    return;
  }

  // ── Doom Tower: horizontal 2-row groups of 10 + Secret Rooms ─────────────
  if (DT_REGIONS.has(regionId)) {
    label.textContent = `Stages`;
    const groups = new Map();
    for (const s of allStages) {
      const key = s.stage_num >= 121 ? 121 : (Math.floor((s.stage_num - 1) / 10) * 10 + 1);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    }
    renderHorizontalGroups(groups, list,
      (key, s) => key === 121 ? `${s.stage_num - 120}` : `${s.stage_num}`,
      (key)    => key === 121 ? 'Secret Rooms' : `${key}–${key + 9}`
    );
    const target = currentStageNum && allStages.find(s => s.stage_num === currentStageNum);
    if (target) {
      const key = target.stage_num >= 121 ? 121 : (Math.floor((target.stage_num - 1) / 10) * 10 + 1);
      list.querySelector(`.stage-group-btn[data-key="${key}"]`)?.click();
      loadStage(target.id);
    } else clearStageView();
    return;
  }

  // ── Grim Forest: groups by enemy level + Phrygius / Mimic / Bosses ──────
  if (GF_REGIONS.has(regionId)) {
    const gfStages = query(`
      SELECT s.id, s.stage_num,
             MAX(w.level) as lv,
             MAX(CASE WHEN h.name = 'Mimic' THEN 1 ELSE 0 END) as is_mimic,
             MAX(CASE WHEN h.name LIKE '%Phrygius%' THEN 1 ELSE 0 END) as is_phrygius,
             MAX(CASE WHEN h.name IN (
               'Leshun the Entangled One','Isheth the Crimson Siren',
               'Tauraze the Bestial Flame','Maximoz the Weeping Blade',
               'Draugnell the Eternal Gatherer'
             ) THEN 1 ELSE 0 END) as is_boss
      FROM stages s
      JOIN waves w ON w.stage_id = s.id
      LEFT JOIN heroes h ON h.id = w.hero_id
      WHERE s.region_id = ? AND s.difficulty = ?
      GROUP BY s.id, s.stage_num
      ORDER BY s.stage_num
    `, [regionId, selectedDiff]);
    if (!gfStages.length) { hideStrip('stage-section'); return; }

    // Classify into raw groups
    const rawGroups = new Map();
    for (const s of gfStages) {
      const key = s.is_boss ? 'BOSSES' : s.is_phrygius ? 'PHRYGIUS' : s.is_mimic ? 'MIMIC' : `LV ${s.lv}`;
      if (!rawGroups.has(key)) rawGroups.set(key, []);
      rawGroups.get(key).push(s);
    }
    // Order: regular levels ascending, then PHRYGIUS, MIMIC, BOSSES
    const groups = new Map();
    [...rawGroups.keys()]
      .filter(k => k.startsWith('LV '))
      .sort((a, b) => parseInt(a.slice(3)) - parseInt(b.slice(3)))
      .forEach(k => groups.set(k, rawGroups.get(k)));
    if (rawGroups.has('PHRYGIUS')) groups.set('PHRYGIUS', rawGroups.get('PHRYGIUS'));
    if (rawGroups.has('MIMIC'))    groups.set('MIMIC',    rawGroups.get('MIMIC'));
    if (rawGroups.has('BOSSES'))   groups.set('BOSSES',   rawGroups.get('BOSSES'));

    // Build 1-based index per stage within its group
    const stageIndex = new Map();
    for (const stages of groups.values()) stages.forEach((s, i) => stageIndex.set(s.id, i + 1));

    label.textContent = 'Stages';
    renderHorizontalGroups(groups, list,
      (key, s) => key === 'BOSSES' ? (GF_BOSS_NAMES[s.stage_num] ?? `${stageIndex.get(s.id)}`) : `${stageIndex.get(s.id)}`,
      k => k
    );
    if (currentStageNum) {
      const target = gfStages.find(s => s.stage_num === currentStageNum);
      if (target) {
        const key = target.is_boss ? 'BOSSES' : target.is_phrygius ? 'PHRYGIUS' : target.is_mimic ? 'MIMIC' : `LV ${target.lv}`;
        list.querySelector(`.stage-group-btn[data-key="${key}"]`)?.click();
        loadStage(target.id);
      } else clearStageView();
    } else clearStageView();
    return;
  }

  // ── Default ───────────────────────────────────────────────────────────────
  label.textContent = `Stages (${allStages.length})`;
  if (allStages.length <= 10) list.classList.add('stage-list--center');
  list.innerHTML = allStages.map(s =>
    `<button class="stage-btn" data-stage="${s.id}">${s.stage_num}</button>`
  ).join('');
  list.querySelectorAll('.stage-btn').forEach(b => b.addEventListener('click', () => loadStage(+b.dataset.stage)));
  const target = currentStageNum && allStages.find(s => s.stage_num === currentStageNum);
  if (target) loadStage(target.id); else clearStageView();
}

// Make all diff-mode buttons the same width (= widest button), shrink container
function fitDiffModeButtons(list) {
  // Set to max-content immediately so buttons render at their natural size
  list.style.gridAutoColumns = 'max-content';
  list.style.width = '';         // stay at 100% so parent doesn't clip
  // Then measure and equalize after render
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const btns = [...list.querySelectorAll('.diff-btn')];
    if (!btns.length) return;
    const maxW = Math.ceil(Math.max(...btns.map(b => b.getBoundingClientRect().width)));
    list.style.gridAutoColumns = maxW + 'px';
  }));
}

// ── Sliding button indicator ───────────────────────────────────────────────────
function slideIndicator(container, activeBtn, borderColor, bgColor) {
  if (!container || !activeBtn) return;
  // Triple-rAF: showStrip (double-rAF) adds strip-visible + snapCenter at T+2,
  // we measure at T+3 so centering is already applied before we read rects.
  requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => {
    let pill = container.querySelector(':scope > .btn-indicator');
    const isNew = !pill;
    if (isNew) {
      pill = document.createElement('div');
      pill.className = 'btn-indicator';
      pill.style.transition = 'none';
      container.prepend(pill);
    }
    const cr = container.getBoundingClientRect();
    const br = activeBtn.getBoundingClientRect();
    pill.style.width       = br.width  + 'px';
    pill.style.height      = br.height + 'px';
    pill.style.top         = (br.top  - cr.top  + container.scrollTop)  + 'px';
    pill.style.transform   = `translateX(${br.left - cr.left + container.scrollLeft}px)`;
    pill.style.borderColor = borderColor || 'transparent';
    pill.style.background  = bgColor     || 'transparent';
    if (isNew) {
      void pill.offsetWidth; // force reflow: commit position before re-enabling transition
      pill.style.transition = '';
    }
  })));
}

// ── Stage view transitions ─────────────────────────────────────────────────────
function animateStageView(dir) {
  const cls = dir === 'right' ? 'sv-from-right' : dir === 'left' ? 'sv-from-left' : 'sv-fade';
  for (const id of ['stage-req', 'waves-container']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.classList.remove('sv-from-left', 'sv-from-right', 'sv-fade');
    void el.offsetWidth;
    el.classList.add(cls);
  }
}

// ── Stage view ────────────────────────────────────────────────────────────────
function clearStageView() {
  document.getElementById('main-placeholder').style.display = '';
  document.getElementById('stage-view').style.display       = 'none';
}

function loadStage(stageId) {
  // Determine slide direction before clearing active states
  const oldBtn = document.querySelector('[data-stage].active');
  const newBtn = document.querySelector(`[data-stage="${stageId}"]`);
  let dir = 'fade';
  if (oldBtn && newBtn && oldBtn !== newBtn) {
    dir = newBtn.getBoundingClientRect().left > oldBtn.getBoundingClientRect().left ? 'right' : 'left';
  }

  document.querySelectorAll('[data-stage]').forEach(b =>
    b.classList.toggle('active', +b.dataset.stage === stageId)
  );
  const activeStageBtn = document.querySelector('[data-stage].active');
  if (activeStageBtn) {
    const isDiff = activeStageBtn.classList.contains('diff-btn');
    const cls    = isDiff && [...activeStageBtn.classList].find(c => c.startsWith('diff-') && c !== 'diff-btn');
    const bg     = isDiff ? (DIFF_IND[cls?.replace('diff-', '')]?.bg ?? 'rgba(212,175,55,.15)') : 'rgba(212,175,55,.1)';
    slideIndicator(activeStageBtn.closest('.strip-list, .strip-stage-row, .diff-buttons'), activeStageBtn,
      isDiff ? null : '#d4af37', bg);
  }

  // Stage meta
  const [stage] = query('SELECT * FROM stages WHERE id=?', [stageId]);
  if (!stage) return;
  currentStage    = stage;
  currentStageNum = stage.stage_num;

  // For Hydra and Chimera: render custom views (stats are hard-coded, not from DB)
  if (HYDRA_REGIONS.has(stage.region_id)) {
    renderHydraView(stage);
    document.getElementById('main-placeholder').style.display = 'none';
    document.getElementById('stage-view').style.display = '';
    animateStageView(dir);
    updateUrl(stageId); updateFavUI(stageId);
    if (window.lucide) lucide.createIcons();
    return;
  }
  if (CHIMERA_REGIONS.has(stage.region_id)) {
    renderChimeraView(stage);
    document.getElementById('main-placeholder').style.display = 'none';
    document.getElementById('stage-view').style.display = '';
    animateStageView(dir);
    updateUrl(stageId); updateFavUI(stageId);
    if (window.lucide) lucide.createIcons();
    return;
  }

  // Wave data with hero info
  const waveRows = query(
    `SELECT w.wave, w.slot, w.hero_id, w.grade, w.level,
            w.eff_hp, w.eff_atk, w.eff_def, w.eff_spd, w.eff_res, w.eff_acc,
            h.name, h.base_hp, h.base_atk, h.base_def,
            h.spd, h.crit_rate, h.crit_dmg, h.res, h.acc,
            h.affinity, h.rarity
     FROM waves w
     LEFT JOIN heroes h ON h.id = w.hero_id
     WHERE w.stage_id = ?
     ORDER BY w.wave, w.slot`,
    [stageId]
  );

  // Apply hero name overrides
  waveRows.forEach(e => { if (HERO_NAME_OVERRIDES[e.hero_id]) e.name = HERO_NAME_OVERRIDES[e.hero_id]; });

  // Group by wave
  const waveMap = {};
  for (const row of waveRows) {
    if (!waveMap[row.wave]) waveMap[row.wave] = [];
    waveMap[row.wave].push(row);
  }

  // Stage requirements bar — max RES, ACC & SPD across all enemies
  let maxRes = 0, maxAcc = 0, maxSpd = 0;
  for (const row of waveRows) {
    const s = computeStats(row, row.grade, row.level);
    if (s.res > maxRes) maxRes = s.res;
    if (s.acc > maxAcc) maxAcc = s.acc;
    if (s.spd > maxSpd) maxSpd = s.spd;
  }
  document.getElementById('stage-req').innerHTML =
    `<div class="req-pill req-acc" title="Enemy max RES: ${maxRes}">
       <span class="req-label">ACC for 95% debuff</span>
       <span class="req-value">${maxRes + 25}</span>
     </div>
     <div class="req-pill req-res" title="Enemy max ACC: ${maxAcc}">
       <span class="req-label">RES for 90% resist</span>
       <span class="req-value">${maxAcc + 105}</span>
     </div>
     <div class="req-pill req-spd" title="Enemy max SPD: ${maxSpd}">
       <span class="req-label">SPD to go first</span>
       <span class="req-value">${maxSpd + 1}</span>
     </div>`;

  // For Clan Boss: override req bar with real stats
  if (stage.region_id === 401) {
    const cbStat = CLAN_BOSS_STATS[stage.stage_num];
    if (cbStat) {
      document.getElementById('stage-req').innerHTML = `
        <div class="req-pill req-acc" title="RES ${cbStat.res}">
          <span class="req-label">ACC for 95% debuff</span>
          <span class="req-value">${cbStat.res + 25}</span>
        </div>
        <div class="req-pill req-res" title="ACC ${cbStat.acc}">
          <span class="req-label">RES for 90% resist</span>
          <span class="req-value">${cbStat.acc + 105}</span>
        </div>
        <div class="req-pill req-spd" title="SPD ${cbStat.spd}">
          <span class="req-label">SPD to go first</span>
          <span class="req-value">${cbStat.spd + 1}</span>
        </div>`;
    }
  }

  currentWaveMap  = waveMap;
  renderCurrentWaves();

  // Prepend rewards section for CB (before wave blocks)
  if (stage.region_id === 401 && CB_REWARDS[stage.stage_num]) {
    document.getElementById('waves-container').insertAdjacentHTML('afterbegin',
      renderRewardsSection(CB_REWARDS[stage.stage_num]));
  }

  // Prepend star conditions for Faction Wars
  if (FW_REGIONS.has(stage.region_id)) {
    document.getElementById('waves-container').insertAdjacentHTML('afterbegin',
      renderStarConditions(stage.stage_num, stage.region_id, stage.difficulty));
  }

  // Prepend champion conditions for DT Secret Rooms (stage_num >= 121)
  if (DT_REGIONS.has(stage.region_id) && stage.stage_num >= 121) {
    document.getElementById('waves-container').insertAdjacentHTML('afterbegin',
      renderChampionsConditions(stage.stage_num, stage.region_id, stage.difficulty));
  }

  document.getElementById('main-placeholder').style.display = 'none';
  document.getElementById('stage-view').style.display       = '';
  animateStageView(dir);
  updateUrl(stageId);
  updateFavUI(stageId);

  if (window.lucide) lucide.createIcons();
}

function renderRewardsSection(tiers) {
  const tiersHtml = tiers.map(t =>
    `<div class="reward-tier"><span class="reward-tier-name">${t.tier}</span><span class="reward-tier-range">${t.range}</span></div>`
  ).join('');
  return `
    <div class="wave-block collapsed">
      <div class="wave-label">
        Chest Rewards
        <button class="wave-toggle" aria-label="Toggle rewards"><i data-lucide="chevron-down"></i></button>
      </div>
      <div class="wave-cards"><div class="rewards-tiers">${tiersHtml}</div></div>
    </div>`;
}

function renderStarConditions(stageNum, regionId, difficulty) {
  // difficulty: 9 = Normal, 2 = Hard
  const isHard = difficulty === 2;
  const hard3star = isHard ? (FW_HARD_3STAR[regionId]?.[stageNum - 1] ?? null) : null;

  const star2 = isHard ? '5 Champions, no losses' : '3-4 Champions, no losses';
  const star3 = isHard ? (hard3star ?? '5 Champions, no losses') : '5 Champions, no losses';

  return `
    <div class="wave-block collapsed">
      <div class="wave-label">
        Stars Conditions
        <button class="wave-toggle" aria-label="Toggle star conditions"><i data-lucide="chevron-down"></i></button>
      </div>
      <div class="wave-cards">
        <div class="star-conditions">
          <div class="star-row"><span class="star-icons">★</span><span class="star-text">Beat the Stage</span></div>
          <div class="star-row"><span class="star-icons">★★</span><span class="star-text">${star2}</span></div>
          <div class="star-row"><span class="star-icons">★★★</span><span class="star-text">${star3}</span></div>
        </div>
      </div>
    </div>`;
}

function renderChampionsConditions(stageNum, regionId, difficulty) {
  const srIndex = stageNum - 121; // 0–11
  const condition = DT_SR_CONDITIONS[regionId]?.[difficulty]?.[srIndex] ?? null;
  if (!condition) return '';
  return `
    <div class="champ-condition-bar">
      <span class="champ-condition-label">Champions Conditions :</span>
      <span class="champ-condition-value">${condition}</span>
    </div>`;
}

function renderHydraView(stage) {
  const diffNum = stage.stage_num;
  const heads = HYDRA_STATS[diffNum] ?? HYDRA_STATS[1];
  const rotation = HYDRA_ROTATIONS[stage.region_id];

  const maxRes = Math.max(...heads.map(h => h.res));
  const maxAcc = Math.max(...heads.map(h => h.acc));
  const maxSpd = Math.max(...heads.map(h => h.spd));
  document.getElementById('stage-req').innerHTML = `
    <div class="req-pill req-acc"><span class="req-label">ACC for 95% debuff</span><span class="req-value">${maxRes + 25}</span></div>
    <div class="req-pill req-res"><span class="req-label">RES for 90% resist</span><span class="req-value">${maxAcc + 105}</span></div>
    <div class="req-pill req-spd"><span class="req-label">SPD to go first</span><span class="req-value">${maxSpd + 1}</span></div>`;

  const [dbWave] = query(`SELECT w.level FROM waves w WHERE w.stage_id=? LIMIT 1`, [stage.id]);
  const level = dbWave?.level ?? 1;

  const statByName = Object.fromEntries(heads.map(h => [h.name, h]));
  const orderedHeads = rotation
    ? rotation.map(r => ({ ...statByName[r.name], extra: r.extra, aff: r.aff }))
    : heads.map(h => ({ ...h, extra: false, aff: 'void' }));

  const initialHeads     = orderedHeads.filter(h => !h.extra);
  const replacementHeads = orderedHeads.filter(h =>  h.extra);

  function makeHeadEntity(h) {
    return {
      name: h.name, hero_id: 0, grade: 6, level,
      rarity: 'Legendary', affinity: h.aff || 'void',
      eff_hp: h.hp, eff_atk: h.atk, eff_def: h.def,
      eff_spd: h.spd, eff_res: h.res, eff_acc: h.acc,
      crit_rate: h.cr, crit_dmg: h.cd,
    };
  }

  const initialCards     = initialHeads.map(h => renderEnemyCard(makeHeadEntity(h))).join('');
  const replacementCards = replacementHeads.map(h => renderEnemyCard(makeHeadEntity(h))).join('');

  const rewards = HYDRA_REWARDS[diffNum];
  document.getElementById('waves-container').innerHTML = `
    ${rewards ? renderRewardsSection(rewards) : ''}
    <div class="wave-block">
      <div class="wave-label">Initial Heads <button class="wave-toggle" aria-label="Toggle"><i data-lucide="chevron-down"></i></button></div>
      <div class="wave-cards">${initialCards}</div>
    </div>
    <div class="wave-block">
      <div class="wave-label">Replacement Heads <button class="wave-toggle" aria-label="Toggle"><i data-lucide="chevron-down"></i></button></div>
      <div class="wave-cards">${replacementCards}</div>
    </div>`;
}

function renderChimeraView(stage) {
  const diffNum = stage.stage_num;
  const forms = CHIMERA_FORMS[diffNum];
  if (!forms) return;

  const [dbStage] = query(`SELECT w.eff_hp, w.eff_spd, w.level FROM waves w WHERE w.stage_id=? LIMIT 1`, [stage.id]);
  const hp    = dbStage?.eff_hp  ?? 0;
  const spd   = dbStage?.eff_spd ?? 0;
  const level = dbStage?.level   ?? 1;

  const maxRes = Math.max(forms.ultimate.res, forms.ram.res, forms.lion.res, forms.viper.res);
  const maxAcc = Math.max(forms.ultimate.acc, forms.ram.acc, forms.lion.acc, forms.viper.acc);
  document.getElementById('stage-req').innerHTML = `
    <div class="req-pill req-acc"><span class="req-label">ACC for 95% debuff</span><span class="req-value">${maxRes + 25}</span></div>
    <div class="req-pill req-res"><span class="req-label">RES for 90% resist</span><span class="req-value">${maxAcc + 105}</span></div>
    <div class="req-pill req-spd"><span class="req-label">SPD to go first</span><span class="req-value">${spd + 1}</span></div>`;

  const rotation = CHIMERA_ROTATIONS[stage.region_id] ?? { ultimate:'void', forms:'void' };

  const formDefs = [
    {key:'ultimate', name:'Ultimate', image:'Chimera',      aff: rotation.ultimate},
    {key:'ram',      name:'Ram',      image:'ChimeraRam',   aff: rotation.forms},
    {key:'lion',     name:'Lion',     image:'ChimeraLion',  aff: rotation.forms},
    {key:'viper',    name:'Viper',    image:'ChimeraViper', aff: rotation.forms},
  ];

  const formCards = formDefs.map(fd => {
    const f = forms[fd.key];
    const entity = {
      name: fd.name, image: fd.image, hero_id: 0, grade: 6, level,
      rarity: 'Legendary', affinity: fd.aff,
      eff_hp: hp, eff_atk: f.atk, eff_def: f.def,
      eff_spd: spd, eff_res: f.res, eff_acc: f.acc,
      crit_rate: f.cr ?? 15, crit_dmg: 50,
    };
    return renderEnemyCard(entity);
  }).join('');

  const rewards = CHIMERA_REWARDS[diffNum];
  document.getElementById('waves-container').innerHTML = `
    ${rewards ? renderRewardsSection(rewards) : ''}
    <div class="wave-block">
      <div class="wave-label">Forms <button class="wave-toggle" aria-label="Toggle"><i data-lucide="chevron-down"></i></button></div>
      <div class="wave-cards">${formCards}</div>
    </div>`;
}

function renderCurrentWaves() {
  const container = document.getElementById('waves-container');
  if (!currentWaveMap) return;
  if (tableView) {
    container.innerHTML = Object.entries(currentWaveMap).map(([waveNum, enemies]) =>
      renderWaveTable(+waveNum, enemies)
    ).join('');
  } else {
    container.innerHTML = Object.entries(currentWaveMap).map(([waveNum, enemies]) =>
      renderWave(+waveNum, enemies)
    ).join('');
    if (window.lucide) lucide.createIcons();
  }
}

// ── Wave rendering ────────────────────────────────────────────────────────────
function renderWaveTable(waveNum, enemies) {
  const rows = enemies.map(e => {
    if (!e.name) return `
      <tr class="table-unknown">
        <td>Wave ${waveNum}</td><td colspan="10">Unknown #${e.hero_id} — Grade ${e.grade} Lv ${e.level}</td>
      </tr>`;
    const s = computeStats(e, e.grade, e.level);
    const rarClass = GRADE_TO_RARITY[e.grade] ?? 'common';
    return `
      <tr class="table-row ${rarClass}">
        <td class="tcell-name">${e.name}</td>
        <td class="tcell-num">${e.grade}★</td>
        <td class="tcell-num">${e.level}</td>
        <td class="tcell-num">${fmt(s.hp)}</td>
        <td class="tcell-num">${fmt(s.atk)}</td>
        <td class="tcell-num">${fmt(s.def)}</td>
        <td class="tcell-num">${s.spd}</td>
        <td class="tcell-num">${s.crit_rate}%</td>
        <td class="tcell-num">${s.crit_dmg}%</td>
        <td class="tcell-num stat-res">${s.res} <span class="stat-acc">(${s.res + 25})</span></td>
        <td class="tcell-num stat-acc">${s.acc} <span class="stat-res">(${s.acc + 105})</span></td>
      </tr>`;
  }).join('');

  return `
    <div class="wave-block">
      <div class="wave-label">Wave ${waveNum}</div>
      <table class="wave-table">
        <thead>
          <tr>
            <th>Name</th><th>Grade</th><th>Lv</th>
            <th>HP</th><th>ATK</th><th>DEF</th><th>SPD</th>
            <th>C.Rate</th><th>C.Dmg</th><th>RES</th><th>ACC</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderWave(waveNum, enemies) {
  const cards = enemies.map(e => renderEnemyCard(e)).join('');
  return `
    <div class="wave-block">
      <div class="wave-label">
        Wave ${waveNum}
        <button class="wave-toggle" aria-label="Toggle wave"><i data-lucide="chevron-down"></i></button>
      </div>
      <div class="wave-cards">${cards}</div>
    </div>`;
}

function fmt(n) {
  return n == null ? '?' : n.toLocaleString();
}

// Grade → rarity class for frame/gradient
const GRADE_TO_RARITY = {
  1: 'common', 2: 'uncommon', 3: 'rare',
  4: 'epic',   5: 'legendary', 6: 'mythical',
};


function renderEnemyCard(e) {
  const calibrated = isCalibrated(e.grade);

  // Unknown hero (not in DB)
  if (!e.name) {
    return `
      <div class="enemy-card unknown">
        <div class="card-portrait card-portrait--placeholder"></div>
        <div class="enemy-footer">
          <div class="enemy-name">Unknown #${e.hero_id}</div>
          <div class="enemy-sub">⭐×${e.grade} · Lv ${e.level}</div>
        </div>
      </div>`;
  }

  const s          = computeStats(e, e.grade, e.level);
  const rarClass   = GRADE_TO_RARITY[e.grade] ?? 'common';
  const rarity     = e.rarity || rarClass.charAt(0).toUpperCase() + rarClass.slice(1);
  const affinity   = e.affinity || '';
  const affKey     = affinity ? affinity.charAt(0).toUpperCase() + affinity.slice(1).toLowerCase() : '';
  const imgFile    = e.image || queryChamp(e.hero_id, e.name)?.image || e.name.replace(/\s+/g, '');
  const imgSrc     = `/tools/champions-index/img/champions/${imgFile}.webp`;
  const frameSrc   = `/tools/champions-index/img/rarity/${rarity}.webp`;
  const affSrc     = affKey ? `/tools/champions-index/img/affinity/${affKey}.webp` : '';

  return `
    <div class="enemy-card ${calibrated ? '' : 'estimated'}"
         data-hero-id="${e.hero_id}" data-grade="${e.grade}" data-level="${e.level}"
         data-name="${e.name}" data-affinity="${affinity}" data-rarity="${rarity}"
         data-hp="${s.hp}" data-atk="${s.atk}" data-def="${s.def}" data-spd="${s.spd}"
         data-crit-rate="${s.crit_rate}" data-crit-dmg="${s.crit_dmg}" data-res="${s.res}" data-acc="${s.acc}"
         style="cursor:pointer">

      <div class="card-portrait ${rarClass}">
        <img class="portrait-img"
             src="${imgSrc}"
             alt="${e.name}"
             loading="lazy"
             onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <div class="portrait-fallback" style="display:none">${e.name.split(' ').map(w=>w[0]).join('').slice(0,3)}</div>
        <img class="portrait-frame" src="${frameSrc}" alt="" onerror="this.style.display='none'">
        ${affSrc ? `<img class="portrait-affinity" src="${affSrc}" alt="${affinity}">` : ''}
      </div>

      <div class="enemy-footer">
        <div class="enemy-name">${e.name}</div>
        <div class="enemy-sub">
          ${affinity ? `<img src="${affSrc}" class="sub-affinity-icon" alt="${affinity}">` : ''}
          Lv ${e.level}
          ${!calibrated ? '<span class="estimated-tag">est.</span>' : ''}
        </div>
        <div class="enemy-stats">
          <div class="stat-row"><span class="stat-label">HP</span><span class="stat-value hp">${fmt(s.hp)}</span></div>
          <div class="stat-row"><span class="stat-label">ATK</span><span class="stat-value">${fmt(s.atk)}</span></div>
          <div class="stat-row"><span class="stat-label">DEF</span><span class="stat-value">${fmt(s.def)}</span></div>
          <div class="stat-row"><span class="stat-label">SPD</span><span class="stat-value">${fmt(s.spd)}</span></div>
          <div class="stat-row"><span class="stat-label">C.RATE</span><span class="stat-value">${s.crit_rate}%</span></div>
          <div class="stat-row"><span class="stat-label">C.DMG</span><span class="stat-value">${s.crit_dmg}%</span></div>
          <div class="stat-row" title="${s.res + 25} ACC needed to land debuffs at a 95% success rate"><span class="stat-label">RES</span><span class="stat-value stat-res">${fmt(s.res)} <span class="stat-raw">(${s.res + 25})</span></span></div>
          <div class="stat-row" title="${s.acc + 105} RES needed to resist debuffs at a 90% rate"><span class="stat-label">ACC</span><span class="stat-value stat-acc">${fmt(s.acc)} <span class="stat-raw">(${s.acc + 105})</span></span></div>
        </div>
      </div>

    </div>`;
}

// ── Enemy Modal ────────────────────────────────────────────────────────────────
function queryChamp(heroId, name) {
  return champByIdMap.get(heroId)
      || (name && champByNameMap.get(name.toLowerCase().replace(/[\u2018\u2019]/g, "'")))
      || null;
}

function openEnemyModal(ds) {
  const heroId   = +ds.heroId;
  const grade    = +ds.grade;
  const level    = +ds.level;
  const name     = HERO_NAME_OVERRIDES[heroId] ?? ds.name;
  const affinity = ds.affinity;
  const rarity   = ds.rarity;
  const rarClass = GRADE_TO_RARITY[grade] ?? 'common';

  // Look up champion in champDb to get the image filename
  const champ    = queryChamp(heroId, name);
  const imgFile  = champ?.image || name.replace(/\s+/g, '');

  // Portrait
  const portrait  = document.getElementById('em-portrait');
  portrait.className = `card-portrait ${rarClass}`;

  const imgEl      = document.getElementById('em-img');
  const fallbackEl = document.getElementById('em-fallback');
  imgEl.src        = `/tools/champions-index/img/champions/${imgFile}.webp`;
  imgEl.style.display      = '';
  fallbackEl.style.display = 'none';
  imgEl.onerror = () => {
    imgEl.style.display      = 'none';
    fallbackEl.style.display = 'flex';
    fallbackEl.textContent   = name.split(' ').map(w => w[0]).join('').slice(0, 3);
  };

  const frameEl = document.getElementById('em-frame');
  frameEl.src   = `/tools/champions-index/img/rarity/${rarity}.webp`;
  frameEl.style.display = '';

  const affEl = document.getElementById('em-affinity');
  if (affinity) {
    const affKeyModal = affinity.charAt(0).toUpperCase() + affinity.slice(1).toLowerCase();
    affEl.src = `/tools/champions-index/img/affinity/${affKeyModal}.webp`;
    affEl.style.display = '';
  } else {
    affEl.style.display = 'none';
  }

  // Name / meta
  document.getElementById('em-name').textContent = name;
  document.getElementById('em-meta').textContent =
    [affinity, rarity].filter(Boolean).join(' · ');

  // Stats header
  document.getElementById('em-stats-title').textContent =
    `Stage Stats — Grade ${grade} · Lv ${level}`;

  // Stats values
  document.getElementById('em-hp').textContent    = (+ds.hp).toLocaleString();
  document.getElementById('em-atk').textContent   = (+ds.atk).toLocaleString();
  document.getElementById('em-def').textContent   = (+ds.def).toLocaleString();
  document.getElementById('em-spd').textContent   = (+ds.spd).toLocaleString();
  document.getElementById('em-crate').textContent = ds.critRate + '%';
  document.getElementById('em-cdmg').textContent  = ds.critDmg + '%';
  const emRes = document.getElementById('em-res');
  emRes.innerHTML = `${(+ds.res).toLocaleString()} <span class="em-acc">(${+ds.res + 25})</span>`;
  emRes.title = `Need ${+ds.res + 25} Accuracy for 95% debuff chance`;
  const emAcc = document.getElementById('em-acc');
  emAcc.innerHTML = `${(+ds.acc).toLocaleString()} <span class="em-res">(${+ds.acc + 105})</span>`;
  emAcc.title = `Need ${+ds.acc + 105} Resistance to resist 90% of debuffs`;

  // Skills: champDb first (playable heroes), fall back to stages.db (boss enemies)
  if (champ) {
    renderEnemyModalSkills(champ);
  } else {
    const skillResult = db.exec(
      `SELECT id, name, description, multiplier, cooldown, is_passive, sort_order
       FROM skills WHERE hero_id = ? ORDER BY sort_order`,
      [heroId]
    );
    const dbSkills = (skillResult[0]?.values ?? []).map(r => ({
      id: r[0], name: r[1], description: r[2], multiplier: r[3],
      cooldown: r[4], is_passive: r[5], sort_order: r[6]
    }));
    renderSkillsFromDB(dbSkills, heroId);
  }

  // Show
  document.getElementById('enemy-modal').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeEnemyModal() {
  document.getElementById('enemy-modal').classList.remove('active');
  document.body.style.overflow = '';
}

function renderSkillsFromDB(skills, heroId) {
  const container = document.getElementById('em-skills');
  container.innerHTML = '';

  if (!skills.length) {
    container.innerHTML = '<div class="em-no-skills">No skill data available.</div>';
    return;
  }

  for (const sk of skills) {
    const isPassive = sk.is_passive === 1;
    const imgIdx    = sk.sort_order + 1;
    const imgSrc    = `/tools/champions-index/img/skills/${heroId}_s${imgIdx}.webp`;

    let descParts = [];
    if (sk.cooldown > 0) descParts.push(`⟳ ${sk.cooldown} Turns`);
    if (sk.description)  descParts.push(sk.description);

    let formattedDesc = descParts.join('\n\n')
      .replace(/\|(.*?)\|/g, '<span class="em-bracket">$1</span>')
      .replace(/\[(.*?)\]/g, '<span class="em-bracket">[$1]</span>')
      .replace(/\n/g, '<br>');
    if (sk.multiplier) {
      formattedDesc += (formattedDesc ? '<br><br>' : '') +
        `<span class="em-mult">Multiplier:</span> ${sk.multiplier}`;
    }

    container.insertAdjacentHTML('beforeend', `
      <div class="em-skill-entry">
        <div class="em-skill-icon-wrapper${isPassive ? ' passive' : ''}">
          ${isPassive ? '<div class="em-passive-stroke"></div><div class="em-passive-glow"></div>' : ''}
          <img class="em-skill-icon" src="${imgSrc}" onerror="this.style.opacity='.25'">
        </div>
        <div class="em-skill-info">
          <div class="em-skill-title">${sk.name || ''}</div>
          <div class="em-skill-desc">${formattedDesc || '<span style="color:#444;font-style:italic">No description</span>'}</div>
        </div>
      </div>`);
  }
}

function renderEnemyModalSkills(champ) {
  const container = document.getElementById('em-skills');
  container.innerHTML = '';

  if (!champ) {
    container.innerHTML = '<div class="em-no-skills">No skill data found for this champion.</div>';
    return;
  }

  const gid = champ.IGid || champ.image;

  // Active skills s1-s4
  let activeCount = 0;
  for (let i = 1; i <= 4; i++) {
    const raw = champ[`s${i}`];
    if (!raw) continue;
    activeCount++;
    const [title, ...descLines] = raw.split('\n');
    const formattedDesc = descLines.join('\n')
      .replace(/\[(.*?)\]/g, '<span class="em-bracket">[$1]</span>')
      .replace(/(.*?)(Multiplier:)/g, '$1<span class="em-mult">$2</span>')
      .replace(/\n/g, '<br>');
    container.insertAdjacentHTML('beforeend', `
      <div class="em-skill-entry">
        <div class="em-skill-icon-wrapper">
          <img class="em-skill-icon" src="/tools/champions-index/img/skills/${gid}_s${i}.webp" onerror="this.style.opacity='.25'">
        </div>
        <div class="em-skill-info">
          <div class="em-skill-title">${title}</div>
          <div class="em-skill-desc">${formattedDesc}</div>
        </div>
      </div>`);
  }

  // Passives p1-p2
  for (let p = 1; p <= 2; p++) {
    const raw = champ[`p${p}`];
    if (!raw) continue;
    const imgIdx = activeCount + p;
    const [title, ...descLines] = raw.split('\n');
    const formattedDesc = descLines.join('\n')
      .replace(/\[(.*?)\]/g, '<span class="em-bracket">[$1]</span>')
      .replace(/(.*?)(Multiplier:)/g, '$1<span class="em-mult">$2</span>')
      .replace(/\n/g, '<br>');
    container.insertAdjacentHTML('beforeend', `
      <div class="em-skill-entry">
        <div class="em-skill-icon-wrapper passive">
          <div class="em-passive-stroke"></div>
          <div class="em-passive-glow"></div>
          <img class="em-skill-icon" src="/tools/champions-index/img/skills/${gid}_s${imgIdx}.webp" onerror="this.style.opacity='.25'">
        </div>
        <div class="em-skill-info">
          <div class="em-skill-title">${title}</div>
          <div class="em-skill-desc">${formattedDesc}</div>
        </div>
      </div>`);
  }

  if (!activeCount && !container.innerHTML) {
    container.innerHTML = '<div class="em-no-skills">No skills in database.</div>';
  }
}
