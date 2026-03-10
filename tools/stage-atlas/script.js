'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let db           = null;
let areas        = [];      // [{ id, name }]
let regions      = [];      // [{ id, name, area_id }]
let difficulties = [];      // numbers available for selected area

let selectedArea    = null;
let selectedDiff    = null;
let selectedRegion  = null;
let selectedGroup   = null;
let currentStageNum = null;
let tableView      = false;
let currentWaveMap = null;
let champDb        = null;
let champByIdMap   = new Map(); // hero_id (int) → champ row
let champByNameMap = new Map(); // name.toLowerCase() → champ row

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

// ── Accordion helpers ──────────────────────────────────────────────────────────
function sectionCollapse(sectionId, pillText, onPillClick) {
  const sec = document.getElementById(sectionId);
  if (!sec) return;
  sec.querySelector('.sidebar-section-body').style.display = 'none';
  let pill = sec.querySelector('.sidebar-pill');
  if (!pill) {
    pill = document.createElement('button');
    pill.className = 'sidebar-pill';
    sec.appendChild(pill);
  }
  pill.textContent = pillText;
  pill.style.display = '';
  pill.onclick = onPillClick;
}

function sectionExpand(sectionId) {
  const sec = document.getElementById(sectionId);
  if (!sec) return;
  sec.querySelector('.sidebar-section-body').style.display = '';
  const pill = sec.querySelector('.sidebar-pill');
  if (pill) pill.style.display = 'none';
}

function goBackToArea() {
  sectionExpand('area-section');
  document.getElementById('diff-section').style.display    = 'none';
  document.getElementById('region-section').style.display  = 'none';
  document.getElementById('affinity-section').style.display = 'none';
  document.getElementById('stage-section').style.display   = 'none';
  clearStageView();
  selectedDiff = null; selectedRegion = null; selectedGroup = null; currentStageNum = null;
}

function goBackToDiff() {
  sectionExpand('diff-section');
  document.getElementById('stage-section').style.display = 'none';
  clearStageView();
}

function goBackToRegion() {
  sectionExpand('region-section');
  document.getElementById('diff-section').style.display    = 'none';
  document.getElementById('affinity-section').style.display = 'none';
  document.getElementById('stage-section').style.display   = 'none';
  clearStageView();
  selectedDiff = null; selectedRegion = null; selectedGroup = null; currentStageNum = null;
}

// ── Breadcrumb dropdown ───────────────────────────────────────────────────────
function openBcDropdown(anchorEl, items) {
  const dd   = document.getElementById('bc-dropdown');
  const list = document.getElementById('bc-dropdown-list');
  list.innerHTML = items.map((it, i) =>
    `<button class="bc-dropdown-item${it.active ? ' active' : ''}" data-idx="${i}">${it.label}</button>`
  ).join('');
  list.querySelectorAll('.bc-dropdown-item').forEach(btn =>
    btn.addEventListener('click', () => {
      closeBcDropdown();
      items[+btn.dataset.idx].onSelect();
    })
  );
  const rect = anchorEl.getBoundingClientRect();
  dd.style.left = rect.left + 'px';
  dd.style.top  = (rect.bottom + 6) + 'px';
  dd.style.display = '';
}

function closeBcDropdown() {
  document.getElementById('bc-dropdown').style.display = 'none';
}

// Build region item list for dropdown (handles groups)
function buildRegionDropdownItems(areaRegions, activeRegionId) {
  const seen = new Set();
  const items = [];
  for (const r of areaRegions) {
    const groupKey = REGION_TO_GROUP[r.id];
    if (groupKey) {
      if (!seen.has(groupKey)) {
        seen.add(groupKey);
        // Expand group: add each affinity sub-region
        for (const gr of REGION_GROUPS[groupKey].regions) {
          const label = gr.affinity
            ? `${REGION_GROUPS[groupKey].label} (${gr.affinity})`
            : (gr.label || REGION_GROUPS[groupKey].label);
          items.push({ label, active: gr.id === activeRegionId,
            onSelect: () => bcSelectRegion(gr.id, REGION_GROUPS[groupKey].label) });
        }
      }
    } else {
      items.push({ label: r.name, active: r.id === activeRegionId,
        onSelect: () => bcSelectRegion(r.id, r.name) });
    }
  }
  return items;
}

// Breadcrumb navigation helpers
function bcSelectArea(areaId, areaName) {
  sectionCollapse('area-section', areaName, goBackToArea);
  selectArea(areaId);
}

function bcSelectRegion(regionId, regionName) {
  const groupKey  = REGION_TO_GROUP[regionId];
  const pillLabel = groupKey ? REGION_GROUPS[groupKey].label : regionName;

  sectionCollapse('region-section', pillLabel, goBackToRegion);
  document.getElementById('affinity-section').style.display = 'none';
  document.getElementById('diff-section').style.display    = 'none';
  document.getElementById('stage-section').style.display   = 'none';
  clearStageView();
  if (groupKey) selectedGroup = groupKey;
  selectedRegion = regionId;

  const DLABELS = { 1:'Normal', 2:'Hard', 3:'Brutal', 4:'Nightmare', 9:'Normal' };
  const diffs = query(
    `SELECT DISTINCT difficulty, diff_name FROM stages WHERE region_id=? ORDER BY CASE difficulty WHEN 9 THEN 1 ELSE difficulty END`,
    [regionId]
  );
  if (!diffs.length) return;

  if (diffs.length > 1) {
    document.getElementById('diff-section').style.display = '';
    renderDiffButtons(diffs, false);
    const fd = diffs[0];
    document.querySelectorAll('.diff-btn').forEach(b =>
      b.classList.toggle('active', +b.dataset.diff === fd.difficulty)
    );
    selectedDiff = fd.difficulty;
    sectionCollapse('diff-section', DLABELS[fd.difficulty] ?? fd.diff_name, goBackToDiff);
  } else {
    selectedDiff = diffs[0].difficulty;
  }

  const firstStage = query(
    `SELECT id FROM stages WHERE region_id=? AND difficulty=? ORDER BY stage_num LIMIT 1`,
    [regionId, selectedDiff]
  )[0];
  if (firstStage) loadStage(firstStage.id);
}

function bcSelectDiff(diff, diffName) {
  sectionCollapse('diff-section', diffName, goBackToDiff);
  document.getElementById('stage-section').style.display = 'none';
  clearStageView();
  selectDiff(diff);
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

  renderAreaTabs();
  if (window.lucide) lucide.createIcons();

  // Close breadcrumb dropdown on outside click
  document.addEventListener('click', e => {
    const dd = document.getElementById('bc-dropdown');
    if (dd.style.display === 'none') return;
    if (!dd.contains(e.target) && !e.target.closest('.bc-seg[data-action]')) closeBcDropdown();
  });

  // View toggle (cards ↔ table)
  document.getElementById('view-toggle').addEventListener('click', () => {
    tableView = !tableView;
    document.getElementById('view-toggle').textContent = tableView ? '⊟ Cards' : '⊞ Table';
    renderCurrentWaves();
  });

  // Enemy card click → modal (single delegate listener)
  document.getElementById('waves-container').addEventListener('click', e => {
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
function renderAreaTabs() {
  const el = document.getElementById('area-tabs');
  el.innerHTML = areas.map(a =>
    `<button class="area-tab" data-area="${a.id}">${a.name}</button>`
  ).join('');
  el.querySelectorAll('.area-tab').forEach(btn =>
    btn.addEventListener('click', () => {
      const areaName = areas.find(a => a.id === +btn.dataset.area)?.name || '';
      sectionCollapse('area-section', areaName, goBackToArea);
      selectArea(+btn.dataset.area);
    })
  );
  // Auto-select first area
  if (areas.length) selectArea(areas[0].id);
}

function selectArea(areaId) {
  selectedArea    = areaId;
  selectedDiff    = null;
  selectedRegion  = null;
  selectedGroup   = null;
  currentStageNum = null;

  document.querySelectorAll('.area-tab').forEach(b =>
    b.classList.toggle('active', +b.dataset.area === areaId)
  );

  document.getElementById('affinity-section').style.display = 'none';
  document.getElementById('diff-section').style.display   = 'none';
  document.getElementById('stage-section').style.display   = 'none';
  document.getElementById('region-section').style.display  = '';
  sectionExpand('region-section');
  renderRegionList();
}

// Regions grouped under a single button with affinity sub-selection
const REGION_GROUPS = {
  potionKeeps: {
    label: 'Potion Keeps',
    regions: [
      { id: 201, affinity: 'Void'   },
      { id: 202, affinity: 'Spirit' },
      { id: 203, affinity: 'Magic'  },
      { id: 204, affinity: 'Force'  },
      { id: 205, affinity: null, label: 'Arcane' },
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
  8686: 'Acelin the Stalwart',
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
  25210: 'Klyssus Minion',
  25220: 'Klyssus Minion',
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
  if (regionId === 401)           return CB_VOID_STAGES.get(stageNum)        ?? `Stage ${stageNum}`;
  if (HYDRA_REGIONS.has(regionId))   return HYDRA_STAGE_LABELS[stageNum]   ?? `Stage ${stageNum}`;
  if (CHIMERA_REGIONS.has(regionId)) return CHIMERA_STAGE_LABELS[stageNum] ?? `Stage ${stageNum}`;
  if (DT_REGIONS.has(regionId))   return stageNum >= 121 ? `SR ${stageNum - 120}` : `Floor ${stageNum}`;
  return `Stage ${stageNum}`;
}

// ── Generic collapsible stage group renderer ──────────────────────────────────
function renderGroupedStages(allStages, list, groupSize) {
  const groups = new Map();
  for (const s of allStages) {
    const key = Math.floor((s.stage_num - 1) / groupSize) * groupSize + 1;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  list.innerHTML = [...groups.entries()].map(([key, stages]) =>
    `<div class="stage-group">
      <button class="stage-group-btn" data-key="${key}">${key} – ${key + groupSize - 1}</button>
      <div class="stage-group-body" style="display:none">
        ${stages.map(s => `<button class="stage-btn" data-stage="${s.id}">Stage ${s.stage_num}</button>`).join('')}
      </div>
    </div>`
  ).join('');
  list.querySelectorAll('.stage-group-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      const body = btn.nextElementSibling;
      const isOpen = body.style.display !== 'none';
      list.querySelectorAll('.stage-group-body').forEach(b => b.style.display = 'none');
      list.querySelectorAll('.stage-group-btn').forEach(b => b.classList.remove('active'));
      if (!isOpen) { body.style.display = ''; btn.classList.add('active'); }
    })
  );
  list.querySelectorAll('.stage-btn').forEach(b => b.addEventListener('click', () => loadStage(+b.dataset.stage)));
}

// ── Difficulty buttons ────────────────────────────────────────────────────────
const DIFF_COLORS = { 1:'normal', 2:'hard', 3:'brutal', 4:'nightmare' };

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
  const el = document.getElementById('region-list');

  // Collect which groups are present in this area
  const presentGroups = new Set();
  const regularRegions = [];
  for (const r of areaRegions) {
    if (GROUPED_IDS.has(r.id)) presentGroups.add(REGION_TO_GROUP[r.id]);
    else regularRegions.push(r);
  }

  let html = regularRegions.map(r =>
    `<button class="region-btn" data-region="${r.id}">${r.name}</button>`
  ).join('');

  for (const key of presentGroups) {
    html += `<button class="region-btn group-btn" data-group="${key}">${REGION_GROUPS[key].label}</button>`;
  }

  el.innerHTML = html;

  el.querySelectorAll('.region-btn:not(.group-btn)').forEach(btn =>
    btn.addEventListener('click', () => {
      sectionCollapse('region-section', btn.textContent.trim(), goBackToRegion);
      document.getElementById('affinity-section').style.display = 'none';
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
      selectRegion(autoRegion);
    }
  } else {
    document.getElementById('affinity-section').style.display = 'none';
    document.getElementById('stage-section').style.display = 'none';
    clearStageView();
  }
}

function openGroup(key, autoSelectId = null) {
  selectedGroup = key;
  const group   = REGION_GROUPS[key];

  document.querySelectorAll('.group-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.group === key)
  );

  const affSection = document.getElementById('affinity-section');
  document.getElementById('affinity-label').textContent = group.label;
  const affList = document.getElementById('affinity-list');

  affList.innerHTML = group.regions.map(r => {
    const aff = r.affinity?.toLowerCase();
    return `<button class="region-btn${aff ? ` it-btn it-${aff}` : ''}" data-region="${r.id}">
      ${r.affinity ? `<img src="/tools/champions-index/img/affinity/${r.affinity}.webp" class="it-aff-icon" alt="">` : ''}
      ${r.affinity || r.label || 'Arcane'}
    </button>`;
  }).join('');

  affList.querySelectorAll('.region-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      sectionCollapse('region-section', group.label, goBackToRegion);
      document.getElementById('affinity-section').style.display = 'none';
      selectRegion(+btn.dataset.region);
    })
  );

  affSection.style.display = '';

  if (autoSelectId) selectRegion(autoSelectId);
}

function selectRegion(regionId) {
  selectedRegion = regionId;

  // Highlight in region-list, affinity-list, group-btn
  document.querySelectorAll('#region-list .region-btn').forEach(b =>
    b.classList.toggle('active', +b.dataset.region === regionId)
  );
  document.querySelectorAll('#affinity-list .region-btn').forEach(b =>
    b.classList.toggle('active', +b.dataset.region === regionId)
  );

  const diffs = query(
    `SELECT DISTINCT difficulty, diff_name FROM stages WHERE region_id=? ORDER BY CASE difficulty WHEN 9 THEN 1 ELSE difficulty END`,
    [regionId]
  );
  if (diffs.length > 1) {
    document.getElementById('diff-section').style.display = '';
    sectionExpand('diff-section');
    renderDiffButtons(diffs, false); // user must click diff explicitly
  } else {
    document.getElementById('diff-section').style.display = 'none';
    if (diffs.length) { selectedDiff = diffs[0].difficulty; renderStageList(regionId); }
  }
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

  if (!allStages.length) { section.style.display = 'none'; return; }
  section.style.display = '';

  // ── Clan Boss: Void stages only, labeled by difficulty ───────────────────
  if (regionId === 401) {
    const stages = allStages.filter(s => CB_VOID_STAGES.has(s.stage_num));
    label.textContent = 'Difficulty';
    list.innerHTML = stages.map(s =>
      `<button class="stage-btn" data-stage="${s.id}">${CB_VOID_STAGES.get(s.stage_num)}</button>`
    ).join('');
    list.querySelectorAll('.stage-btn').forEach(b => b.addEventListener('click', () => loadStage(+b.dataset.stage)));
    const target = currentStageNum && stages.find(s => s.stage_num === currentStageNum);
    if (target) loadStage(target.id);
    return;
  }

  // ── Hydra: 4 stages = Normal / Hard / Brutal / Nightmare ─────────────────
  if (HYDRA_REGIONS.has(regionId)) {
    label.textContent = 'Difficulty';
    list.innerHTML = allStages.map(s =>
      `<button class="stage-btn" data-stage="${s.id}">${HYDRA_STAGE_LABELS[s.stage_num] ?? `Stage ${s.stage_num}`}</button>`
    ).join('');
    list.querySelectorAll('.stage-btn').forEach(b => b.addEventListener('click', () => loadStage(+b.dataset.stage)));
    const target = currentStageNum && allStages.find(s => s.stage_num === currentStageNum);
    if (target) loadStage(target.id);
    return;
  }

  // ── Chimera: 6 stages = Easy / Normal / Hard / Brutal / Nightmare / Ultra-Nightmare ──
  if (CHIMERA_REGIONS.has(regionId)) {
    label.textContent = 'Difficulty';
    list.innerHTML = allStages.map(s =>
      `<button class="stage-btn" data-stage="${s.id}">${CHIMERA_STAGE_LABELS[s.stage_num] ?? `Stage ${s.stage_num}`}</button>`
    ).join('');
    list.querySelectorAll('.stage-btn').forEach(b => b.addEventListener('click', () => loadStage(+b.dataset.stage)));
    const target = currentStageNum && allStages.find(s => s.stage_num === currentStageNum);
    if (target) loadStage(target.id);
    return;
  }

  // ── Faction Wars: collapsible groups of 7 (boss on stage 7/14/21) ────────
  if (FW_REGIONS.has(regionId)) {
    label.textContent = `Stages (${allStages.length})`;
    renderGroupedStages(allStages, list, 7);
    const target = currentStageNum && allStages.find(s => s.stage_num === currentStageNum);
    if (target) {
      const key = Math.floor((target.stage_num - 1) / 7) * 7 + 1;
      const btn = list.querySelector(`.stage-group-btn[data-key="${key}"]`);
      if (btn) { btn.nextElementSibling.style.display = ''; btn.classList.add('active'); }
      loadStage(target.id);
    }
    return;
  }

  // ── Doom Tower: collapsible groups of 10 floors + Secret Rooms ──────────
  if (DT_REGIONS.has(regionId)) {
    label.textContent = `Stages (${allStages.length})`;

    // Build groups: key = first floor of group (121 = secret rooms)
    const groups = new Map();
    for (const s of allStages) {
      const key = s.stage_num >= 121 ? 121 : (Math.floor((s.stage_num - 1) / 10) * 10 + 1);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    }

    list.innerHTML = [...groups.entries()].map(([key, stages]) => {
      const gLabel = key === 121 ? 'Secret Rooms' : `${key} – ${key + 9}`;
      const btns = stages.map(s =>
        `<button class="stage-btn" data-stage="${s.id}">${key === 121 ? `SR ${s.stage_num - 120}` : `Floor ${s.stage_num}`}</button>`
      ).join('');
      return `
        <div class="stage-group">
          <button class="stage-group-btn" data-key="${key}">${gLabel}</button>
          <div class="stage-group-body" style="display:none">${btns}</div>
        </div>`;
    }).join('');

    // Group toggle (accordion — only one open at a time)
    list.querySelectorAll('.stage-group-btn').forEach(btn =>
      btn.addEventListener('click', () => {
        const body = btn.nextElementSibling;
        const isOpen = body.style.display !== 'none';
        list.querySelectorAll('.stage-group-body').forEach(b => b.style.display = 'none');
        list.querySelectorAll('.stage-group-btn').forEach(b => b.classList.remove('active'));
        if (!isOpen) { body.style.display = ''; btn.classList.add('active'); }
      })
    );

    list.querySelectorAll('.stage-btn').forEach(b => b.addEventListener('click', () => loadStage(+b.dataset.stage)));

    // Auto-open the group of the current/target stage
    const target = currentStageNum && allStages.find(s => s.stage_num === currentStageNum);
    if (target) {
      const key = target.stage_num >= 121 ? 121 : (Math.floor((target.stage_num - 1) / 10) * 10 + 1);
      const groupBtn = list.querySelector(`.stage-group-btn[data-key="${key}"]`);
      if (groupBtn) { groupBtn.nextElementSibling.style.display = ''; groupBtn.classList.add('active'); }
      loadStage(target.id);
    }
    return;
  }

  // ── Default ───────────────────────────────────────────────────────────────
  label.textContent = `Stages (${allStages.length})`;
  list.innerHTML = allStages.map(s =>
    `<button class="stage-btn" data-stage="${s.id}">Stage ${s.stage_num}</button>`
  ).join('');
  list.querySelectorAll('.stage-btn').forEach(b => b.addEventListener('click', () => loadStage(+b.dataset.stage)));
  const target = currentStageNum && allStages.find(s => s.stage_num === currentStageNum);
  if (target) loadStage(target.id);
}

// ── Stage view ────────────────────────────────────────────────────────────────
function clearStageView() {
  document.getElementById('main-placeholder').style.display = '';
  document.getElementById('stage-view').style.display       = 'none';
}

function loadStage(stageId) {
  document.querySelectorAll('.stage-btn').forEach(b =>
    b.classList.toggle('active', +b.dataset.stage === stageId)
  );

  // Stage meta
  const [stage] = query('SELECT * FROM stages WHERE id=?', [stageId]);
  if (!stage) return;

  // Wave data with hero info
  const waveRows = query(
    `SELECT w.wave, w.slot, w.hero_id, w.grade, w.level,
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

  // Breadcrumb — dropdown per segment (Area › Region › [Diff] › Stage)
  const DIFF_LABELS = { 1:'Normal', 2:'Hard', 3:'Brutal', 4:'Nightmare', 9:'Normal' };
  const diffName    = DIFF_LABELS[stage.difficulty] ?? stage.diff_name;
  const diffCount   = query(`SELECT COUNT(DISTINCT difficulty) as n FROM stages WHERE region_id=?`,
                            [stage.region_id])[0]?.n ?? 1;
  const regionDisplayName = REGION_NAME_OVERRIDES[stage.region_id] ?? stage.region_name;
  const areaDisplayName   = areas.find(a => a.id === stage.area_id)?.name ?? stage.area_name;
  const segs = [
    { text: areaDisplayName,    action: 'area'   },
    { text: regionDisplayName,  action: 'region' },
  ];
  if (diffCount > 1) segs.push({ text: diffName, action: 'diff' });
  segs.push({ text: stageLabel(stage.stage_num, stage.region_id), action: 'stage' });

  const bcEl = document.getElementById('stage-breadcrumb');
  bcEl.innerHTML = segs.map(s =>
    `<button class="bc-seg${s.action === 'stage' ? ' bc-current' : ''}" data-action="${s.action}">${s.text}</button>`
  ).join('<span class="bc-sep"> › </span>');

  bcEl.querySelectorAll('.bc-seg[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      closeBcDropdown();
      const action = btn.dataset.action;
      if (action === 'area') {
        const items = areas.map(a => ({
          label: a.name, active: a.id === stage.area_id,
          onSelect: () => bcSelectArea(a.id, a.name)
        }));
        openBcDropdown(btn, items);

      } else if (action === 'region') {
        const areaRegions = regions.filter(r => r.area_id === selectedArea);
        openBcDropdown(btn, buildRegionDropdownItems(areaRegions, stage.region_id));

      } else if (action === 'diff') {
        const diffs = query(
          `SELECT DISTINCT difficulty, diff_name FROM stages WHERE region_id=? ORDER BY CASE difficulty WHEN 9 THEN 1 ELSE difficulty END`,
          [stage.region_id]
        );
        const items = diffs.map(d => ({
          label: DIFF_LABELS[d.difficulty] ?? d.diff_name,
          active: d.difficulty === stage.difficulty,
          onSelect: () => bcSelectDiff(d.difficulty, DIFF_LABELS[d.difficulty] ?? d.diff_name)
        }));
        openBcDropdown(btn, items);

      } else if (action === 'stage') {
        const stageList = query(
          `SELECT id, stage_num FROM stages WHERE region_id=? AND difficulty=? ORDER BY stage_num`,
          [stage.region_id, stage.difficulty]
        );
        // For Clan Boss only show Void stages
        const filtered = stage.region_id === 401
          ? stageList.filter(s => CB_VOID_STAGES.has(s.stage_num))
          : stageList;
        const items = filtered.map(s => ({
          label: stageLabel(s.stage_num, stage.region_id), active: s.id === stageId,
          onSelect: () => loadStage(s.id)
        }));
        openBcDropdown(btn, items);
      }
    });
  });

  currentStageNum = stage.stage_num;
  currentWaveMap  = waveMap;
  renderCurrentWaves();

  document.getElementById('main-placeholder').style.display = 'none';
  document.getElementById('stage-view').style.display       = '';

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
        <td class="tcell-num">${s.res}</td>
        <td class="tcell-num">${s.acc}</td>
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
      <div class="wave-label">Wave ${waveNum}</div>
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
          <div class="stat-row"><span class="stat-label">RES</span><span class="stat-value">${fmt(s.res)}</span></div>
          <div class="stat-row"><span class="stat-label">ACC</span><span class="stat-value">${fmt(s.acc)}</span></div>
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
  document.getElementById('em-res').textContent   = (+ds.res).toLocaleString();
  document.getElementById('em-acc').textContent   = (+ds.acc).toLocaleString();

  // Skills (champ already fetched above)
  renderEnemyModalSkills(champ);

  // Show
  document.getElementById('enemy-modal').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeEnemyModal() {
  document.getElementById('enemy-modal').classList.remove('active');
  document.body.style.overflow = '';
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
      .replace(/^.*?Multiplier:/gm, '<span class="em-mult">$&</span>')
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
      .replace(/^.*?Multiplier:/gm, '<span class="em-mult">$&</span>')
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
