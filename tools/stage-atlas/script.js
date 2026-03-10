'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let db           = null;
let areas        = [];      // [{ id, name }]
let regions      = [];      // [{ id, name, area_id }]
let difficulties = [];      // numbers available for selected area

let selectedArea   = null;
let selectedDiff   = null;
let selectedRegion = null;
let champDb        = null;
let champByIdMap   = new Map(); // hero_id (int) → champ row
let champByNameMap = new Map(); // name.toLowerCase() → champ row

// ── Stat formula ──────────────────────────────────────────────────────────────
/**
 * Grade multipliers calibrated from in-game confirmed data.
 *
 * Grades 3 & 4:  linear formula, calibrated on Act 1 Hard stage 3.
 *   mult(G, L) = MULT_BASE[G] + (L-1) * 0.07852
 *   Error: ATK/DEF ±1, HP ±7.
 *
 * Grade 6, levels 220-230:  calibrated from Act 12 Nightmare stage 6 screenshots.
 *   mult_DEF(6, L) = 23.213 + (L-220) * 0.2185
 *   NOTE: base_hp and base_atk stored in the DB (Forms[0]) appear to be ½ the
 *   effective value for grade-6 enemies → HP_ATK_FACTOR = 2 applied below.
 *   This may be a Forms[0] vs Forms[1] issue to investigate.
 *
 * Grades 1, 2, 5: not yet calibrated (marked as estimated in UI).
 */
const MULT_BASE = {
  1: 1.0,      // TODO calibrate
  2: 1.5,      // TODO calibrate
  3: 2.0796,   // confirmed
  4: 3.0792,   // confirmed
  5: 5.15,     // TODO calibrate
  // 6: handled specially
};
const MULT_INC_STD = 0.07852;  // per-level increment (grades 3-4)

// Grade-6 anchor (from Act 12 Nightmare, DEF stat)
const G6_ANCHOR_LEVEL = 220;
const G6_ANCHOR_MULT  = 23.213;
const G6_INC          = 0.2185;  // per level at high levels

function getMult(grade, level) {
  if (grade === 6) {
    return G6_ANCHOR_MULT + (level - G6_ANCHOR_LEVEL) * G6_INC;
  }
  const base = MULT_BASE[grade] ?? 1.0;
  return base + (level - 1) * MULT_INC_STD;
}

function computeStats(hero, grade, level) {
  const m = getMult(grade, level);
  // Grade-6 correction: base_hp / base_atk in Forms[0] are ½ the effective value.
  const hpAtkFactor = grade === 6 ? 2 : 1;
  return {
    hp:  Math.round(hero.base_hp  * hpAtkFactor * 15 * m),
    atk: Math.round(hero.base_atk * hpAtkFactor * m),
    def: Math.round(hero.base_def * m),
    spd: hero.spd,
    crit_rate: hero.crit_rate,
    crit_dmg:  hero.crit_dmg,
    res: hero.res,
    acc: hero.acc,
  };
}

// Whether the stat formula is considered calibrated for this grade
function isCalibrated(grade) {
  return grade === 3 || grade === 4 || grade === 6;
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
  areas = query(`SELECT DISTINCT area_id as id, area_name as name
                 FROM stages ORDER BY area_id`);
  // Distinct regions
  regions = query(`SELECT DISTINCT region_id as id, region_name as name, area_id
                   FROM stages ORDER BY area_id, region_id`);

  renderAreaTabs();
  if (window.lucide) lucide.createIcons();

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
    btn.addEventListener('click', () => selectArea(+btn.dataset.area))
  );
  // Auto-select first area
  if (areas.length) selectArea(areas[0].id);
}

function selectArea(areaId) {
  selectedArea   = areaId;
  selectedDiff   = null;
  selectedRegion = null;

  document.querySelectorAll('.area-tab').forEach(b =>
    b.classList.toggle('active', +b.dataset.area === areaId)
  );

  // Available difficulties for this area
  const rows = query(
    `SELECT DISTINCT difficulty, diff_name FROM stages
     WHERE area_id=? ORDER BY difficulty`, [areaId]
  );
  difficulties = rows;
  renderDiffButtons(rows);
}

// ── Difficulty buttons ────────────────────────────────────────────────────────
const DIFF_COLORS = { 1:'normal', 2:'hard', 3:'brutal', 4:'nightmare' };

function renderDiffButtons(diffs) {
  const el = document.getElementById('diff-buttons');
  el.innerHTML = diffs.map(d =>
    `<button class="diff-btn diff-${DIFF_COLORS[d.difficulty] ?? 'normal'}"
             data-diff="${d.difficulty}">${d.diff_name}</button>`
  ).join('');
  el.querySelectorAll('.diff-btn').forEach(btn =>
    btn.addEventListener('click', () => selectDiff(+btn.dataset.diff))
  );
  if (diffs.length) selectDiff(diffs[0].difficulty);
}

function selectDiff(diff) {
  selectedDiff   = diff;
  selectedRegion = null;

  document.querySelectorAll('.diff-btn').forEach(b =>
    b.classList.toggle('active', +b.dataset.diff === diff)
  );
  renderRegionList();
}

// ── Region list ───────────────────────────────────────────────────────────────
function renderRegionList() {
  const areaRegions = regions.filter(r => r.area_id === selectedArea);
  const el = document.getElementById('region-list');

  el.innerHTML = areaRegions.map(r =>
    `<button class="region-btn" data-region="${r.id}">${r.name}</button>`
  ).join('');

  el.querySelectorAll('.region-btn').forEach(btn =>
    btn.addEventListener('click', () => selectRegion(+btn.dataset.region))
  );

  // Hide stage panel until region chosen
  document.getElementById('stage-section').style.display = 'none';
  clearStageView();
}

function selectRegion(regionId) {
  selectedRegion = regionId;

  document.querySelectorAll('.region-btn').forEach(b =>
    b.classList.toggle('active', +b.dataset.region === regionId)
  );

  renderStageList(regionId);
}

// ── Stage list ────────────────────────────────────────────────────────────────
function renderStageList(regionId) {
  const stages = query(
    `SELECT id, stage_num FROM stages
     WHERE region_id=? AND difficulty=? ORDER BY stage_num`,
    [regionId, selectedDiff]
  );

  const section = document.getElementById('stage-section');
  const label   = document.getElementById('stage-section-label');
  const list    = document.getElementById('stage-list');

  if (!stages.length) {
    section.style.display = 'none';
    return;
  }

  label.textContent = `Stages (${stages.length})`;
  section.style.display = '';

  list.innerHTML = stages.map(s =>
    `<button class="stage-btn" data-stage="${s.id}">Stage ${s.stage_num}</button>`
  ).join('');

  list.querySelectorAll('.stage-btn').forEach(btn =>
    btn.addEventListener('click', () => loadStage(+btn.dataset.stage))
  );
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

  // Group by wave
  const waveMap = {};
  for (const row of waveRows) {
    if (!waveMap[row.wave]) waveMap[row.wave] = [];
    waveMap[row.wave].push(row);
  }

  // Breadcrumb
  const diffLabel = { 1:'Normal', 2:'Hard', 3:'Brutal', 4:'Nightmare' };
  document.getElementById('stage-breadcrumb').textContent =
    `${stage.area_name}  ›  ${stage.region_name}  ›  ${diffLabel[stage.difficulty] ?? stage.diff_name}  ›  Stage ${stage.stage_num}`;

  // Render waves
  const container = document.getElementById('waves-container');
  container.innerHTML = Object.entries(waveMap).map(([waveNum, enemies]) =>
    renderWave(+waveNum, enemies)
  ).join('');

  document.getElementById('main-placeholder').style.display = 'none';
  document.getElementById('stage-view').style.display       = '';

  if (window.lucide) lucide.createIcons();
}

// ── Wave rendering ────────────────────────────────────────────────────────────
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
  const name     = ds.name;
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
