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
function showStrip(id) {
  const el = document.getElementById(id);
  if (!el) return;
  // Double rAF ensures the element is rendered before the class transition fires
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('strip-visible')));
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
          if (c.name) champByNameMap.set(c.name.toLowerCase(), c);
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
  if (window.lucide) lucide.createIcons();


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
}

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

// Chimera: 6 stages = difficulties
const CHIMERA_REGIONS      = new Set([1301, 1302, 1303, 1304]);
const CHIMERA_STAGE_LABELS = { 1:'Easy', 2:'Normal', 3:'Hard', 4:'Brutal', 5:'Nightmare', 6:'Ultra-Nightmare' };

// Doom Tower: collapsible groups of 10 + Secret Rooms (121-132)
const DT_REGIONS = new Set([701, 702, 703]);

// Faction Wars: collapsible groups of 7 (boss on stage 7/14/21)
const FW_REGIONS = new Set([501,502,503,505,506,507,508,509,510,511,512,513,514,515,516]);

function stageLabel(stageNum, regionId) {
  if (regionId === 401)           return CB_VOID_STAGES.get(stageNum)        ?? `${stageNum}`;
  if (HYDRA_REGIONS.has(regionId))   return HYDRA_STAGE_LABELS[stageNum]   ?? `${stageNum}`;
  if (CHIMERA_REGIONS.has(regionId)) return CHIMERA_STAGE_LABELS[stageNum] ?? `${stageNum}`;
  if (DT_REGIONS.has(regionId))   return stageNum >= 121 ? `SR ${stageNum - 120}` : `Floor ${stageNum}`;
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
  const groupRow = document.createElement('div');
  groupRow.className = 'strip-group-row';
  const stageRow = document.createElement('div');
  stageRow.className = 'strip-stage-row';

  function showGroup(key) {
    groupRow.querySelectorAll('.stage-group-btn').forEach(b =>
      b.classList.toggle('active', +b.dataset.key === key)
    );
    const activeGroupBtn = groupRow.querySelector('.stage-group-btn.active');
    if (activeGroupBtn) slideIndicator(groupRow, activeGroupBtn, '#d4af37', 'rgba(212,175,55,.1)');
    stageRow.innerHTML = (groups.get(key) || []).map(s =>
      `<button class="stage-btn" data-stage="${s.id}">${stageLabel(key, s)}</button>`
    ).join('');
    stageRow.querySelectorAll('.stage-btn').forEach(b =>
      b.addEventListener('click', () => loadStage(+b.dataset.stage))
    );
  }

  groupRow.innerHTML = [...groups.keys()].map(key =>
    `<button class="stage-group-btn" data-key="${key}">${groupLabel(key)}</button>`
  ).join('');
  groupRow.querySelectorAll('.stage-group-btn').forEach(btn =>
    btn.addEventListener('click', () => showGroup(+btn.dataset.key))
  );

  list.innerHTML = '';
  list.appendChild(groupRow);
  list.appendChild(stageRow);

  // Auto-show first group
  const firstKey = [...groups.keys()][0];
  if (firstKey !== undefined) showGroup(firstKey);
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
  list.classList.remove('diff-mode', 'fw-list');

  // ── Clan Boss: Void stages only ───────────────────────────────────────────
  if (regionId === 401) {
    const stages = allStages.filter(s => CB_VOID_STAGES.has(s.stage_num));
    label.textContent = 'Difficulty';
    list.classList.add('diff-mode');
    list.innerHTML = stages.map(s =>
      `<button class="diff-btn diff-${CB_DIFF_CLASS[s.stage_num] ?? 'normal'}" data-stage="${s.id}">${CB_VOID_STAGES.get(s.stage_num)}</button>`
    ).join('');
    list.querySelectorAll('[data-stage]').forEach(b => b.addEventListener('click', () => loadStage(+b.dataset.stage)));
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

  // ── Default ───────────────────────────────────────────────────────────────
  label.textContent = `Stages (${allStages.length})`;
  list.innerHTML = allStages.map(s =>
    `<button class="stage-btn" data-stage="${s.id}">${s.stage_num}</button>`
  ).join('');
  list.querySelectorAll('.stage-btn').forEach(b => b.addEventListener('click', () => loadStage(+b.dataset.stage)));
  const target = currentStageNum && allStages.find(s => s.stage_num === currentStageNum);
  if (target) loadStage(target.id); else clearStageView();
}

// ── Sliding button indicator ───────────────────────────────────────────────────
function slideIndicator(container, activeBtn, borderColor, bgColor) {
  if (!container || !activeBtn) return;
  // Defer so rects are valid after strip becomes visible (double-rAF like showStrip)
  requestAnimationFrame(() => requestAnimationFrame(() => {
    let pill = container.querySelector(':scope > .btn-indicator');
    const isNew = !pill;
    if (isNew) {
      pill = document.createElement('div');
      pill.className = 'btn-indicator';
      pill.style.transition = 'none';
      container.appendChild(pill);
    }
    const cr = container.getBoundingClientRect();
    const br = activeBtn.getBoundingClientRect();
    pill.style.width     = br.width  + 'px';
    pill.style.height    = br.height + 'px';
    pill.style.top       = (br.top  - cr.top  + container.scrollTop)  + 'px';
    pill.style.transform = `translateX(${br.left - cr.left + container.scrollLeft}px)`;
    pill.style.borderColor = borderColor || 'transparent';
    pill.style.background  = bgColor     || 'transparent';
    if (isNew) requestAnimationFrame(() => { pill.style.transition = ''; });
  }));
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

  // Stage requirements bar — max RES & ACC across all enemies
  let maxRes = 0, maxAcc = 0;
  for (const row of waveRows) {
    const s = computeStats(row, row.grade, row.level);
    if (s.res > maxRes) maxRes = s.res;
    if (s.acc > maxAcc) maxAcc = s.acc;
  }
  document.getElementById('stage-req').innerHTML =
    `<div class="req-pill req-acc" title="Enemy max RES: ${maxRes}">
       <span class="req-label">ACC for 95% debuff</span>
       <span class="req-value">${maxRes + 25}</span>
     </div>
     <div class="req-pill req-res" title="Enemy max ACC: ${maxAcc}">
       <span class="req-label">RES for 90% resist</span>
       <span class="req-value">${maxAcc + 105}</span>
     </div>`;

  currentStageNum = stage.stage_num;
  currentWaveMap  = waveMap;
  renderCurrentWaves();

  document.getElementById('main-placeholder').style.display = 'none';
  document.getElementById('stage-view').style.display       = '';
  animateStageView(dir);

  if (window.lucide) lucide.createIcons();
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
  const imgFile    = queryChamp(e.hero_id, e.name)?.image || e.name.replace(/\s+/g, '');
  const imgSrc     = `/tools/champions-index/img/champions/${imgFile}.webp`;
  const frameSrc   = `/tools/champions-index/img/rarity/${rarity}.webp`;
  const affSrc     = affinity ? `/tools/champions-index/img/affinity/${affinity}.webp` : '';

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
          <div class="stat-row"><span class="stat-label">C.Rate</span><span class="stat-value">${s.crit_rate}%</span></div>
          <div class="stat-row"><span class="stat-label">C.Dmg</span><span class="stat-value">${s.crit_dmg}%</span></div>
          <div class="stat-row" title="${s.res + 25} ACC needed to land debuffs at a 95% success rate"><span class="stat-label">RES</span><span class="stat-value stat-res">${fmt(s.res)} <span class="stat-raw">(${s.res + 25})</span></span></div>
          <div class="stat-row" title="${s.acc + 105} RES needed to resist debuffs at a 90% rate"><span class="stat-label">ACC</span><span class="stat-value stat-acc">${fmt(s.acc)} <span class="stat-raw">(${s.acc + 105})</span></span></div>
        </div>
      </div>

    </div>`;
}

// ── Enemy Modal ────────────────────────────────────────────────────────────────
function queryChamp(heroId, name) {
  return champByIdMap.get(heroId)
      || (name && champByNameMap.get(name.toLowerCase()))
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
    affEl.src = `/tools/champions-index/img/affinity/${affinity}.webp`;
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
