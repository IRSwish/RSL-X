/* ============================================================
   MY BOX — script.js
   ============================================================ */

const DB_PATH     = '/tools/champions-index/champions.db';
const STORAGE_KEY = 'mybox_v1';

// BlessingID → Name (from rsl11.30.0.dat analysis)
const BLESSING_ID_MAP = {
  1101: 'Ward of the Fallen',    1102: 'Temporal Chains',
  1201: 'Lethal Dose',           1202: 'Cruelty',
  1301: 'Phantom Touch',         1302: 'Dark Resolve',
  2101: 'Lightning Cage',        2102: 'Intimidating Presence',
  2201: 'Heavencast',            2202: 'Iron Will',
  2301: 'Miracle Heal',          2302: 'Indomitable Spirit',
  3101: 'Soul Reap',             3102: 'Life Harvest',
  3201: 'Chainbreaker',          3202: 'Commanding Presence',
  3301: 'Faultless Defense',     3302: "Hero's Soul",
  4101: 'Brimstone',             4102: 'Polymorph',
  4201: 'Incinerate',            4202: 'Crushing Rend',
  4301: 'Survival Instinct',     4302: 'Emergency Heal',
  5101: "Nature's Bounty",       5102: 'Nourish',
  5201: "Nature's Wrath",        5202: 'Neutralize',
  5301: 'Harmonic Impulse',      5302: 'Cracking Roots',
};

const RARITY_ORDER   = ['Mythical', 'Legendary', 'Epic', 'Rare', 'Uncommon', 'Common'];
const AFFINITY_ORDER = ['Force', 'Magic', 'Spirit', 'Void'];
const RARITY_MIN_RANK = { Common: 1, Uncommon: 2, Rare: 3, Epic: 4, Legendary: 5, Mythical: 6 };

// ── State ──────────────────────────────────────────────────
let db              = null;
let championsMap    = {};   // name → {name, faction, rarity, affinity, type, image, aurastat, IGid, s1-s6, p1-p2}
let igidMap         = {};   // IGid → champion (for fast CSV lookup)
let blessingsMap    = {};   // name → {name, section, sectionID, rarity, image}
let blessingsBySection = []; // [{section, sectionID, blessings:[...]}]
let myBox           = [];   // tableau d'entrées {id, name, ...data} — supporte les doublons

let activeFilters = { search: '', rarities: [], affinities: [], factions: [], empowerments: [], pinnedOnly: false, duplicatesOnly: false, masteredOnly: false, partialMasteryOnly: false, noMasteries: false, fullBooks: false, partialBooks: false, noBooks: false };
let sortBy = 'default';

let _renderTimer = null;
function scheduleRender() {
  clearTimeout(_renderTimer);
  _renderTimer = setTimeout(renderGrid, 40);
}

// Per-edit state
let currentEditId     = null;   // id unique de l'entrée en cours d'édition
let currentEditChamp  = null;   // nom du champion (garde pour compatibilité)
let editBlessingName  = null;
let editBlessingLevel = 0;
let editEmpowerLevel  = 0;
let editRank          = 6;
let editAscension     = 0;


// ── Init ───────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  myBox = loadBox();

  const loadingEl = document.getElementById('myboxGrid');
  if (loadingEl) {
    loadingEl.innerHTML = '<div class="mybox-empty"><p>Loading champion database…</p></div>';
  }

  await loadDB();
  setupEventListeners();
  renderGrid();

  if (typeof lucide !== 'undefined') lucide.createIcons();
  else window.addEventListener('load', () => lucide && lucide.createIcons());
});


// ── Database ───────────────────────────────────────────────
async function loadDB() {
  const SQL = await initSqlJs({
    locateFile: f => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${f}`
  });

  const resp = await fetch(DB_PATH + '?v=1');
  const buf  = await resp.arrayBuffer();
  db         = new SQL.Database(new Uint8Array(buf));

  // Champions — SELECT * with positional index (matches champions-index column order)
  // r[0]=id, r[1]=name, r[2]=faction, r[3]=rarity, r[4]=affinity, r[5]=type,
  // r[6]=image, r[7]=invocable, r[8-15]=stats, r[16]=aurastat, r[17]=aura,
  // r[18]=s1, r[19]=s2, r[20]=s3, r[21]=s4, r[22]=p1, r[23]=p2, r[24]=effects, r[25]=IGid
  const cr = db.exec("SELECT * FROM champions");
  if (cr.length) {
    cr[0].values.forEach(r => {
      const name = r[1];
      championsMap[name] = {
        name,
        faction:  r[2]  || null,
        rarity:   r[3]  || null,
        affinity: r[4]  || null,
        type:     r[5]  || null,
        image:    r[6]  || null,
        aurastat: r[16] || null,
        s1: r[18] || null, s2: r[19] || null,
        s3: r[20] || null, s4: r[21] || null,
        p1: r[22] || null, p2: r[23] || null,
        IGid: r[25] || null,
      };
      if (r[25]) igidMap[r[25]] = championsMap[name];
    });
  }

  // Blessings
  try {
    const br = db.exec(
      "SELECT DISTINCT name, section, sectionID, rarity, image FROM blessings ORDER BY sectionID, name"
    );
    if (br.length) {
      const sectMap = {};
      br[0].values.forEach(([name, section, sectionID, rarity, image]) => {
        blessingsMap[name] = { name, section, sectionID, rarity, image };
        if (!sectMap[section]) sectMap[section] = { section, sectionID, blessings: [] };
        sectMap[section].blessings.push({ name, section, sectionID, rarity, image });
      });
      blessingsBySection = Object.values(sectMap).sort((a, b) => a.sectionID - b.sectionID);
    }
  } catch (e) {
    console.warn('Blessings table not found in champions.db:', e);
  }
}


// ── Helpers ────────────────────────────────────────────────
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── Local Storage ──────────────────────────────────────────
function loadBox() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    // Migration : ancien format objet → tableau avec IDs
    if (!Array.isArray(raw)) {
      return Object.entries(raw).map(([name, data]) => ({ id: genId(), name, ...data }));
    }
    return raw;
  } catch { return []; }
}

function saveBox() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(myBox));
}


// ── Book / Skill helpers ────────────────────────────────────
function countTomes(raw) {
  return raw ? (raw.match(/^Level\s+\d+:/gm) || []).length : 0;
}

function buildSkillsForChamp(champ) {
  const skills = [];
  let activeCount = 0;

  for (let i = 1; i <= 6; i++) {
    const raw = champ[`s${i}`];
    if (!raw) continue;
    const title = raw.split('\n')[0];
    const tomeCount = countTomes(raw);
    skills.push({ key: `s${i}`, raw, title, tomeCount, imgIndex: i, isPassive: false });
    activeCount++;
  }

  for (let p = 1; p <= 2; p++) {
    const raw = champ[`p${p}`];
    if (!raw) continue;
    const title = raw.split('\n')[0];
    const tomeCount = countTomes(raw);
    const imgIndex = activeCount + p;
    skills.push({ key: `p${p}`, raw, title, tomeCount, imgIndex, isPassive: true });
  }

  return skills;
}

function renderBooksSection(container, champ, data) {
  container.innerHTML = '';
  const skills = buildSkillsForChamp(champ);
  const upgradeable = skills.filter(s => s.tomeCount > 0);

  if (!upgradeable.length) {
    container.innerHTML = '<div class="no-books">No upgradeable skills</div>';
    return;
  }

  const savedBooks = data.books || {};
  const rarity = champ.rarity.toLowerCase();
  const gid    = champ.IGid;

  upgradeable.forEach(skill => {
    const current  = savedBooks[skill.key] || 0;
    const imgSrc   = `/tools/champions-index/img/skills/${gid}_s${skill.imgIndex}.webp`;
    const fallback = `/style/img/Misc/skill-tome-${rarity}.webp`;
    const descText = skill.raw.split('\n').slice(1).join('\n');

    const row = document.createElement('div');
    row.className = 'skill-book-row';
    row.innerHTML = `
      <div class="skill-book-icon">
        <img src="${imgSrc}" onerror="this.src='${fallback}'" alt=""
             title="${skill.title}&#10;${descText.replace(/"/g,'&quot;')}">
      </div>
      <div class="skill-book-info">
        <div class="skill-book-title">${skill.title}</div>
        <div class="skill-book-max">${skill.tomeCount} book${skill.tomeCount !== 1 ? 's' : ''}</div>
      </div>
      <input type="number" class="skill-book-input" data-key="${skill.key}"
             min="0" max="${skill.tomeCount}" value="${current}">
    `;
    container.appendChild(row);
  });
}


function getTotalBooksMax(champ) {
  if (!champ) return 0;
  return buildSkillsForChamp(champ).filter(s => s.tomeCount > 0).reduce((sum, s) => sum + s.tomeCount, 0);
}

function getTotalBooksApplied(data, champ) {
  if (!champ) return 0;
  const books = data.books || {};
  return buildSkillsForChamp(champ).filter(s => s.tomeCount > 0).reduce((sum, s) => sum + (books[s.key] || 0), 0);
}


// ── CSV Import ─────────────────────────────────────────────
// Parses a CSV line respecting quoted fields (handles names with commas)
function parseCSVLine(line) {
  const fields = [];
  let i = 0, field = '';
  while (i < line.length) {
    if (line[i] === '"') {
      i++;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { field += '"'; i += 2; }
        else if (line[i] === '"') { i++; break; }
        else { field += line[i++]; }
      }
    } else if (line[i] === ',') {
      fields.push(field); field = ''; i++;
    } else {
      field += line[i++];
    }
  }
  fields.push(field);
  return fields;
}

function importCSV(text) {
  // Strip UTF-8 BOM
  text = text.replace(/^\uFEFF/, '');

  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { imported: 0, notFound: [] };

  const headers = parseCSVLine(lines[0]).map(h => h.trim());
  const col = h => headers.indexOf(h);

  const iId        = col('id');
  const iName      = col('name');
  const iStars     = col('stars');
  const iEmpower   = col('empower_level');
  const iAscension = col('ascension');
  const iBlessRank = col('blessing_rank');
  const iBlessId   = col('blessing_id');
  const iSkill1    = col('skill_1');
  const iSkill2    = col('skill_2');
  const iSkill3    = col('skill_3');
  const iSkill4    = col('skill_4');
  const iScrollBr  = col('scrolls_bronze');
  const iScrollSi  = col('scrolls_silver');
  const iScrollGo  = col('scrolls_gold');
  const iMasteries = col('masteries');

  // Rebuild from scratch
  myBox = [];

  let imported = 0;
  const notFound = [];

  lines.slice(1).forEach(line => {
    if (!line.trim()) return;
    const cols = parseCSVLine(line);
    const raw  = i => (i >= 0 && i < cols.length ? cols[i] : '').trim();

    const name = raw(iName);
    if (!name) return;

    // Primary lookup: floor CSV id to nearest 10 → IGid
    const csvId = parseInt(raw(iId)) || 0;
    const igid  = Math.floor(csvId / 10) * 10;
    let champ = igidMap[igid];

    // Fallback: name-based matching
    if (!champ) {
      champ = championsMap[name];
      if (!champ) {
        const normalised = name.replace(/[''`]/g, "'");
        champ = championsMap[normalised] || Object.values(championsMap)
          .find(c => c.name.toLowerCase() === name.toLowerCase());
      }
    }
    if (!champ) { notFound.push(name); return; }

    const champName    = champ.name;
    const minR         = RARITY_MIN_RANK[champ.rarity] || 1;
    const rawStars     = parseInt(raw(iStars))     || 0;
    const rank         = rawStars > 0 ? Math.max(minR, rawStars) : 6;
    const ascension    = parseInt(raw(iAscension)) || 0;
    const empowerLevel = parseInt(raw(iEmpower))   || 0;
    const blessingLevel= parseInt(raw(iBlessRank)) || 0;
    const blessingId   = parseInt(raw(iBlessId))   || 0;
    const blessingName = BLESSING_ID_MAP[blessingId] || null;

    // Masteries
    const masteriesRaw = raw(iMasteries);
    const masteryNodes = masteriesRaw ? masteriesRaw.split(';').filter(Boolean) : [];
    const mastered     = masteryNodes.length >= 15;
    const t1Used       = parseInt(raw(iScrollBr)) || 0;
    const t2Used       = parseInt(raw(iScrollSi)) || 0;
    const t3Used       = parseInt(raw(iScrollGo)) || 0;

    // Books: skill_1/2/3/4 map sequentially to buildSkillsForChamp order
    // (handles s1/s2/s3/p1 etc. correctly)
    const csvBookCols = [iSkill1, iSkill2, iSkill3, iSkill4];
    const books = {};
    buildSkillsForChamp(champ).forEach((skill, idx) => {
      if (idx < csvBookCols.length) {
        const count = (parseInt(raw(csvBookCols[idx])) || 1) - 1;
        if (count > 0) books[skill.key] = count;
      }
    });

    myBox.push({
      id:           genId(),
      gameId:       raw(iId),
      name:         champName,
      rank, ascension, empowerLevel, blessingName, blessingLevel,
      t1Used, t2Used, t3Used,
      mastered,
      books,
      pinned:       false,
      note:         '',
      addedAt:      Date.now(),
    });
    imported++;
  });

  saveBox();
  return { imported, notFound };
}


// ── Render ─────────────────────────────────────────────────
function getFilteredSorted() {
  let entries = myBox
    .filter(entry => championsMap[entry.name])
    .map(entry => ({ id: entry.id, name: entry.name, data: entry, champ: championsMap[entry.name] }));

  const { search, rarities, affinities, factions, empowerments, pinnedOnly, duplicatesOnly, masteredOnly, partialMasteryOnly, noMasteries, fullBooks, partialBooks, noBooks } = activeFilters;

  if (search) {
    const q = search.toLowerCase();
    entries = entries.filter(e => e.name.toLowerCase().includes(q));
  }
  if (rarities.length)   entries = entries.filter(e => rarities.includes(e.champ.rarity));
  if (affinities.length) entries = entries.filter(e => affinities.includes(e.champ.affinity));
  if (factions.length)   entries = entries.filter(e => factions.includes(e.champ.faction));
  if (pinnedOnly)        entries = entries.filter(e => e.data.pinned);
  if (duplicatesOnly) {
    const nameCounts = {};
    myBox.forEach(e => { nameCounts[e.name] = (nameCounts[e.name] || 0) + 1; });
    entries = entries.filter(e => nameCounts[e.name] > 1);
  }
  if (masteredOnly)      entries = entries.filter(e => e.data.mastered);
  if (partialMasteryOnly) entries = entries.filter(e =>
    !e.data.mastered &&
    ((e.data.t1Used || 0) > 0 || (e.data.t2Used || 0) > 0 || (e.data.t3Used || 0) > 0)
  );
  if (noMasteries) entries = entries.filter(e =>
    (e.data.t1Used || 0) === 0 && (e.data.t2Used || 0) === 0 && (e.data.t3Used || 0) === 0
  );
  if (empowerments.length) entries = entries.filter(e => empowerments.includes(e.data.empowerLevel || 0));
  if (fullBooks || partialBooks || noBooks) {
    entries = entries.filter(e => {
      const max     = getTotalBooksMax(e.champ);
      const applied = getTotalBooksApplied(e.data, e.champ);
      if (fullBooks    && max > 0 && applied >= max) return true;
      if (partialBooks && applied > 0 && applied < max) return true;
      if (noBooks      && applied === 0) return true;
      return false;
    });
  }

  entries.sort((a, b) => {
    // Pinned always first
    if (a.data.pinned !== b.data.pinned) return a.data.pinned ? -1 : 1;
    // Duplicates filter: group by name
    if (duplicatesOnly) {
      const nameCmp = a.name.localeCompare(b.name);
      if (nameCmp !== 0) return nameCmp;
    }
    // Blessing sort mode: blessing first, then default criteria
    if (sortBy === 'blessing') {
      const blDiff = (b.data.blessingLevel || 0) - (a.data.blessingLevel || 0);
      if (blDiff !== 0) return blDiff;
    }
    // rank → rarity → empowerment → blessing → ascension → affinity
    const rkDiff = (b.data.rank || 0) - (a.data.rank || 0);
    if (rkDiff !== 0) return rkDiff;
    const rDiff = RARITY_ORDER.indexOf(a.champ.rarity) - RARITY_ORDER.indexOf(b.champ.rarity);
    if (rDiff !== 0) return rDiff;
    const eDiff = (b.data.empowerLevel || 0) - (a.data.empowerLevel || 0);
    if (eDiff !== 0) return eDiff;
    const blDiff2 = (b.data.blessingLevel || 0) - (a.data.blessingLevel || 0);
    if (blDiff2 !== 0) return blDiff2;
    const ascDiff = (b.data.ascension || 0) - (a.data.ascension || 0);
    if (ascDiff !== 0) return ascDiff;
    const afA = AFFINITY_ORDER.indexOf(a.champ.affinity);
    const afB = AFFINITY_ORDER.indexOf(b.champ.affinity);
    return (afA === -1 ? 99 : afA) - (afB === -1 ? 99 : afB);
  });

  return entries;
}

function renderGrid() {
  const grid    = document.getElementById('myboxGrid');
  const counter = document.getElementById('boxCounter');
  const entries = getFilteredSorted();
  const total   = myBox.length;

  counter.textContent = `${entries.length} / ${total} champion${total !== 1 ? 's' : ''}`;

  grid.innerHTML = '';

  if (!entries.length) {
    grid.innerHTML = total === 0
      ? '<div class="mybox-empty"><p>Your box is empty.</p><p>Import from RSL Helper or add a champion manually.</p></div>'
      : '<div class="mybox-empty"><p>No champions match your filters.</p></div>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }

  entries.forEach(({ id, name, champ, data }) => grid.appendChild(createCard(id, name, champ, data)));
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function createCard(id, name, champ, data) {
  const card = document.createElement('div');
  card.className = 'mybox-card' + (data.pinned ? ' pinned' : '');
  card.dataset.id   = id;
  card.dataset.name = name;

  const rank        = data.rank       || RARITY_MIN_RANK[champ.rarity] || 1;
  const ascension   = data.ascension  || 0;
  const blessLvl    = data.blessingLevel || 0;

  // Seulement les étoiles du rank — rien au-dessus (même pas transparent)
  // Rouge (blessing) → rose (ascension) → jaune (rank)
  // z-index croissant gauche→droite
  let starsHtml = '<div class="card-stars">';
  for (let i = 1; i <= rank; i++) {
    let src;
    if (i <= blessLvl) {
      src = '/tools/champions-index/img/stars/Star-Awaken.webp';  // rouge
    } else if (i <= ascension) {
      src = '/tools/champions-index/img/stars/Star-Ascend.webp';  // rose
    } else {
      src = '/tools/champions-index/img/stars/Star-Classic.webp'; // jaune
    }
    starsHtml += `<img class="card-star" src="${src}" alt="" style="z-index:${i}">`;
  }
  starsHtml += '</div>';

  // Aura icon — hors du portrait (pour ne pas être clippée par overflow:hidden)
  const auraHtml = champ.aurastat
    ? `<img class="card-aura" src="/tools/champions-index/img/aura/${champ.aurastat}.webp" onerror="this.style.display='none'" alt="">`
    : '';

  // Empower — bottom-right
  const empowerHtml = data.empowerLevel > 0
    ? `<span class="card-empower">+${data.empowerLevel}</span>`
    : '';

  // Blessing — bottom-center (icône uniquement, pas d'étoiles séparées)
  let blessingHtml = '';
  if (data.blessingName && blessingsMap[data.blessingName]) {
    const b = blessingsMap[data.blessingName];
    blessingHtml = `
      <div class="card-blessing">
        <div class="card-bless-wrap">
          <img class="card-bless-bg" src="/tools/champions-index/img/blessings/${b.rarity}.webp" onerror="this.style.display='none'" alt="">
          <img class="card-bless-icon" src="/tools/champions-index/img/blessings/icons/${b.image}.webp" onerror="this.style.display='none'" alt="" title="${data.blessingName}">
        </div>
      </div>`;
  }

  card.innerHTML = `
    <div class="card-portrait">
      <img class="champion-img"
           src="/tools/champions-index/img/champions/${champ.image}.webp"
           onerror="this.src=''" alt="${name}">
      <img class="rarity-frame"
           src="/tools/champions-index/img/rarity/${champ.rarity}.webp"
           onerror="this.style.display='none'" alt="">
      <img class="affinity-icon"
           src="/tools/champions-index/img/affinity/${champ.affinity}.webp" alt="${champ.affinity}">
      ${starsHtml}
      ${empowerHtml}
      ${blessingHtml}
      ${data.pinned ? '<div class="card-pin"><i data-lucide="pin"></i></div>' : ''}
      ${data.note   ? '<div class="card-note-dot"></div>' : ''}
    </div>
    ${auraHtml}
    <div class="mybox-card-name">${name}</div>
  `;

  card.addEventListener('click', () => openEditModal(id));
  return card;
}


// ── Edit Modal ─────────────────────────────────────────────
function updateRankStars(rank, minRank) {
  editRank = rank;
  document.querySelectorAll('.rank-star-btn').forEach((btn, i) => {
    const starN = i + 1;
    const img   = btn.querySelector('img');
    const below = minRank && starN < minRank;
    img.src = starN <= rank
      ? '/tools/champions-index/img/stars/Star-Classic.webp'
      : '/tools/champions-index/img/stars/Star-Classic.webp';
    img.style.opacity = starN <= rank ? '1' : '0.2';
    btn.disabled      = below;
    btn.style.cursor  = below ? 'default' : 'pointer';
  });
}

function updateAscensionStars(level) {
  editAscension = level;
  document.querySelectorAll('.ascension-star-btn').forEach((btn, i) => {
    const img = btn.querySelector('img');
    img.src = i < level
      ? '/tools/champions-index/img/stars/Star-Ascend.webp'
      : '/tools/champions-index/img/stars/Star-Ascend.webp';
    img.style.opacity = i < level ? '1' : '0.2';
  });
}

function openEditModal(id) {
  const entry       = myBox.find(e => e.id === id);
  if (!entry) return;
  currentEditId     = id;
  currentEditChamp  = entry.name;
  const name        = entry.name;
  const champ       = championsMap[name];
  const data        = entry;
  editBlessingName  = data.blessingName  || null;
  editBlessingLevel = data.blessingLevel || 0;
  editEmpowerLevel  = data.empowerLevel  || 0;
  const minRank     = RARITY_MIN_RANK[champ.rarity] || 1;
  editRank          = data.rank       || minRank;
  editAscension     = data.ascension  ?? 0;

  const modal = document.getElementById('editModal');

  modal.querySelector('.edit-champion-img').src = `/tools/champions-index/img/champions/${champ.image}.webp`;
  modal.querySelector('.edit-frame-img').src    = `/tools/champions-index/img/rarity/${champ.rarity}.webp`;
  modal.querySelector('.edit-affinity-img').src = `/tools/champions-index/img/affinity/${champ.affinity}.webp`;
  modal.querySelector('.edit-champ-name').textContent = name;
  modal.querySelector('.edit-champ-sub').textContent  = `${champ.rarity} · ${champ.affinity} · ${champ.faction}`;

  const minLabel = document.getElementById('rankMinLabel');
  if (minLabel) minLabel.textContent = minRank > 1 ? `(min ${minRank}★)` : '';

  updateRankStars(editRank, minRank);
  updateAscensionStars(editAscension);
  updateEmpowerButtons(editEmpowerLevel);
  updateBlessingDisplay();
  updateBlessingStars(editBlessingLevel);

  modal.querySelector('#editT1Used').value   = data.t1Used   || 0;
  modal.querySelector('#editT1Unused').value = data.t1Unused || 0;
  modal.querySelector('#editT2Used').value   = data.t2Used   || 0;
  modal.querySelector('#editT2Unused').value = data.t2Unused || 0;
  modal.querySelector('#editT3Used').value   = data.t3Used   || 0;
  modal.querySelector('#editT3Unused').value = data.t3Unused || 0;
  modal.querySelector('#editMastered').checked = data.mastered || false;

  // Dynamic books section
  renderBooksSection(modal.querySelector('#booksSection'), champ, data);

  modal.querySelector('#editNote').value   = data.note   || '';
  modal.querySelector('#editPinned').checked = data.pinned || false;

  modal.classList.add('active');
  document.body.classList.add('modal-open');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function closeEditModal() {
  document.getElementById('editModal').classList.remove('active');
  document.body.classList.remove('modal-open');
  currentEditId    = null;
  currentEditChamp = null;
}

function saveEditModal() {
  if (!currentEditId) return;
  const modal    = document.getElementById('editModal');
  const idx      = myBox.findIndex(e => e.id === currentEditId);
  if (idx < 0) return;
  const existing = myBox[idx];

  // Collect dynamic books
  const books = {};
  modal.querySelectorAll('.skill-book-input').forEach(input => {
    books[input.dataset.key] = parseInt(input.value) || 0;
  });

  myBox[idx] = {
    ...existing,
    rank:          editRank,
    ascension:     editAscension,
    empowerLevel:  editEmpowerLevel,
    blessingName:  editBlessingName,
    blessingLevel: editBlessingLevel,
    t1Used:   parseInt(modal.querySelector('#editT1Used').value)   || 0,
    t1Unused: parseInt(modal.querySelector('#editT1Unused').value) || 0,
    t2Used:   parseInt(modal.querySelector('#editT2Used').value)   || 0,
    t2Unused: parseInt(modal.querySelector('#editT2Unused').value) || 0,
    t3Used:   parseInt(modal.querySelector('#editT3Used').value)   || 0,
    t3Unused: parseInt(modal.querySelector('#editT3Unused').value) || 0,
    mastered: modal.querySelector('#editMastered').checked,
    books,
    note:   modal.querySelector('#editNote').value.trim(),
    pinned: modal.querySelector('#editPinned').checked,
    addedAt: existing.addedAt || Date.now(),
  };

  saveBox();
  closeEditModal();
  renderGrid();
}

function deleteChampion() {
  if (!currentEditId) return;
  if (!confirm(`Remove ${currentEditChamp} from your box?`)) return;
  myBox = myBox.filter(e => e.id !== currentEditId);
  saveBox();
  closeEditModal();
  renderGrid();
}

function updateEmpowerButtons(level) {
  editEmpowerLevel = level;
  document.querySelectorAll('.empower-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.level) === level);
  });
}

function updateBlessingDisplay() {
  const modal      = document.getElementById('editModal');
  const bgImg      = modal.querySelector('.edit-blessing-img');
  const iconImg    = modal.querySelector('.edit-blessing-icon-overlay');
  const nameEl     = modal.querySelector('.edit-blessing-name');
  const b          = editBlessingName ? blessingsMap[editBlessingName] : null;

  if (b) {
    bgImg.src          = `/tools/champions-index/img/blessings/${b.rarity}.webp`;
    bgImg.onerror      = () => { bgImg.src = '/tools/champions-index/img/blessings/Unselected.webp'; };
    iconImg.src        = `/tools/champions-index/img/blessings/icons/${b.image}.webp`;
    iconImg.style.display = '';
    nameEl.textContent = editBlessingName;
  } else {
    bgImg.src          = '/tools/champions-index/img/blessings/Unselected.webp';
    iconImg.style.display = 'none';
    nameEl.textContent = 'No blessing';
  }
}

function updateBlessingStars(level) {
  editBlessingLevel = level;
  document.querySelectorAll('.blessing-star-btn').forEach((btn, i) => {
    const img = btn.querySelector('img');
    img.src   = i < level
      ? '/tools/champions-index/img/stars/Star-Awaken.webp'
      : '/tools/champions-index/img/stars/Star-Ascend.webp';
  });
}


// ── Blessing Picker ────────────────────────────────────────
function openBlessingPicker() {
  const modal     = document.getElementById('blessingPickerModal');
  const container = modal.querySelector('.blessing-picker-content');
  container.innerHTML = '';

  const noneBtn = document.createElement('button');
  noneBtn.className   = 'blessing-none-btn';
  noneBtn.textContent = '✕ Remove blessing';
  noneBtn.addEventListener('click', () => {
    editBlessingName  = null;
    editBlessingLevel = 0;
    updateBlessingDisplay();
    updateBlessingStars(0);
    closeBlessingPicker();
  });
  container.appendChild(noneBtn);

  if (blessingsBySection.length === 0) {
    const fallbackSection = { section: 'All Blessings', blessings: Object.values(BLESSING_ID_MAP)
      .filter(Boolean)
      .map(name => ({ name, section: '', rarity: 'Legendary', image: name.replace(/[' ]/g,'_') }))
    };
    renderBlessingSection(container, fallbackSection);
  } else {
    blessingsBySection.forEach(sect => renderBlessingSection(container, sect));
  }

  modal.classList.add('active');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function renderBlessingSection(container, { section, blessings }) {
  const sectEl = document.createElement('div');
  sectEl.className = 'bpick-section';

  const title = document.createElement('div');
  title.className   = 'bpick-section-title';
  title.textContent = section;
  sectEl.appendChild(title);

  const grid = document.createElement('div');
  grid.className = 'bpick-grid';

  blessings.forEach(b => {
    const card = document.createElement('div');
    card.className = 'bpick-card' + (editBlessingName === b.name ? ' selected' : '');
    card.title     = b.name;
    card.innerHTML = `
      <div class="bpick-img-wrap">
        <img class="bpick-rarity-bg"
             src="/tools/champions-index/img/blessings/${b.rarity}.webp"
             onerror="this.src='/tools/champions-index/img/blessings/Unselected.webp'">
        <img class="bpick-icon"
             src="/tools/champions-index/img/blessings/icons/${b.image}.webp"
             onerror="this.style.display='none'">
      </div>
      <div class="bpick-name">${b.name}</div>
    `;
    card.addEventListener('click', () => {
      editBlessingName = b.name;
      updateBlessingDisplay();
      closeBlessingPicker();
    });
    grid.appendChild(card);
  });

  sectEl.appendChild(grid);
  container.appendChild(sectEl);
}

function closeBlessingPicker() {
  document.getElementById('blessingPickerModal').classList.remove('active');
}


// ── Add Champion Modal ─────────────────────────────────────
function openAddModal() {
  const modal = document.getElementById('addModal');
  modal.querySelector('#addSearchInput').value = '';
  modal.querySelector('#addSearchResults').innerHTML = '';
  modal.classList.add('active');
  document.body.classList.add('modal-open');
  setTimeout(() => modal.querySelector('#addSearchInput').focus(), 50);
}

function closeAddModal() {
  document.getElementById('addModal').classList.remove('active');
  document.body.classList.remove('modal-open');
}

function searchForAdd(q) {
  const results = document.getElementById('addSearchResults');
  results.innerHTML = '';
  if (!q.trim()) return;

  const matches = Object.values(championsMap)
    .filter(c => c.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity))
    .slice(0, 25);

  if (!matches.length) {
    results.innerHTML = '<div class="add-result-empty">No champions found</div>';
    return;
  }

  matches.forEach(champ => {
    const item       = document.createElement('div');
    item.className   = 'add-result-item';
    const count = myBox.filter(e => e.name === champ.name).length;

    item.innerHTML = `
      <img class="add-result-img"
           src="/tools/champions-index/img/champions/${champ.image}.webp"
           onerror="this.src=''" alt="">
      <span>${champ.name}</span>
      <span class="add-result-rarity ${champ.rarity.toLowerCase()}">${champ.rarity}</span>
      ${count > 0 ? `<span class="add-result-exists">×${count}</span>` : ''}
    `;

    item.addEventListener('click', () => {
      const defRank  = RARITY_MIN_RANK[champ.rarity] || 1;
      const newEntry = {
        id: genId(), name: champ.name,
        rank: defRank, ascension: 0, empowerLevel: 0,
        blessingName: null, blessingLevel: 0,
        t1Used: 0, t1Unused: 0, t2Used: 0, t2Unused: 0, t3Used: 0, t3Unused: 0,
        mastered: false, books: {}, pinned: false, note: '', addedAt: Date.now(),
      };
      myBox.push(newEntry);
      saveBox();
      closeAddModal();
      openEditModal(newEntry.id);
    });

    results.appendChild(item);
  });
}


// ── Event Listeners ────────────────────────────────────────
function setupEventListeners() {

  // Import CSV
  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('csvInput').click();
  });

  document.getElementById('csvInput').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const { imported, notFound } = importCSV(ev.target.result);
      renderGrid();
      let msg = `✓ ${imported} champion${imported !== 1 ? 's' : ''} imported.`;
      if (notFound.length) {
        const preview = notFound.slice(0, 3).join(', ');
        const extra   = notFound.length > 3 ? ` +${notFound.length - 3} more` : '';
        msg += ` Not found: ${preview}${extra}.`;
      }
      showToast(msg);
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  // Add champion
  document.getElementById('addChampBtn').addEventListener('click', openAddModal);

  // Search
  document.getElementById('searchInput').addEventListener('input', e => {
    activeFilters.search = e.target.value;
    renderGrid();
  });

  // Rarity filter
  document.querySelectorAll('.box-rarity-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const r   = btn.dataset.rarity;
      const idx = activeFilters.rarities.indexOf(r);
      if (idx >= 0) activeFilters.rarities.splice(idx, 1);
      else activeFilters.rarities.push(r);
      btn.classList.toggle('active');
      scheduleRender();
    });
  });

  // Affinity filter
  document.querySelectorAll('.box-affinity-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const a   = btn.dataset.affinity;
      const idx = activeFilters.affinities.indexOf(a);
      if (idx >= 0) activeFilters.affinities.splice(idx, 1);
      else activeFilters.affinities.push(a);
      btn.classList.toggle('active');
      scheduleRender();
    });
  });

  // Clear Box
  document.getElementById('clearBoxBtn').addEventListener('click', () => {
    if (!myBox.length) { showToast('Your box is already empty.'); return; }
    if (!confirm(`Delete all ${myBox.length} champions from your box? This cannot be undone.`)) return;
    myBox = [];
    saveBox();
    renderGrid();
    showToast('Box cleared.');
  });

  // Quick filters
  document.getElementById('filterPinned').addEventListener('change', e => {
    activeFilters.pinnedOnly = e.target.checked;
    renderGrid();
  });
  document.getElementById('filterDuplicates').addEventListener('change', e => {
    activeFilters.duplicatesOnly = e.target.checked;
    renderGrid();
  });
  document.getElementById('filterMastered').addEventListener('change', e => {
    activeFilters.masteredOnly = e.target.checked;
    renderGrid();
  });
  document.getElementById('filterPartialMastery').addEventListener('change', e => {
    activeFilters.partialMasteryOnly = e.target.checked;
    renderGrid();
  });
  document.getElementById('filterNoMasteries').addEventListener('change', e => {
    activeFilters.noMasteries = e.target.checked;
    renderGrid();
  });
  document.getElementById('filterFullBooks').addEventListener('change', e => {
    activeFilters.fullBooks = e.target.checked;
    renderGrid();
  });
  document.getElementById('filterPartialBooks').addEventListener('change', e => {
    activeFilters.partialBooks = e.target.checked;
    renderGrid();
  });
  document.getElementById('filterNoBooks').addEventListener('change', e => {
    activeFilters.noBooks = e.target.checked;
    renderGrid();
  });

  // Faction filter
  document.querySelectorAll('.box-faction-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const f   = btn.dataset.faction;
      const idx = activeFilters.factions.indexOf(f);
      if (idx >= 0) activeFilters.factions.splice(idx, 1);
      else activeFilters.factions.push(f);
      btn.classList.toggle('active');
      scheduleRender();
    });
  });

  // Empowerment filter
  document.querySelectorAll('.box-empower-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const lvl = parseInt(btn.dataset.empower);
      const idx = activeFilters.empowerments.indexOf(lvl);
      if (idx >= 0) activeFilters.empowerments.splice(idx, 1);
      else activeFilters.empowerments.push(lvl);
      btn.classList.toggle('active');
      scheduleRender();
    });
  });

  // Blessing sort toggle
  document.getElementById('sortBlessingBtn').addEventListener('click', () => {
    sortBy = sortBy === 'blessing' ? 'default' : 'blessing';
    document.getElementById('sortBlessingBtn').classList.toggle('active', sortBy === 'blessing');
    renderGrid();
  });

  // Export
  document.getElementById('exportBtn').addEventListener('click', exportBox);

  // Reset filters
  document.getElementById('resetBoxFilters').addEventListener('click', () => {
    activeFilters = { search: '', rarities: [], affinities: [], factions: [], empowerments: [], pinnedOnly: false, duplicatesOnly: false, masteredOnly: false, partialMasteryOnly: false, noMasteries: false, fullBooks: false, partialBooks: false, noBooks: false };
    sortBy = 'default';
    document.getElementById('searchInput').value = '';
    document.querySelectorAll('.box-rarity-btn, .box-affinity-btn, .box-faction-btn, .box-empower-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('sortBlessingBtn').classList.remove('active');
    document.getElementById('filterPinned').checked          = false;
    document.getElementById('filterDuplicates').checked      = false;
    document.getElementById('filterMastered').checked        = false;
    document.getElementById('filterPartialMastery').checked  = false;
    document.getElementById('filterNoMasteries').checked     = false;
    document.getElementById('filterFullBooks').checked       = false;
    document.getElementById('filterPartialBooks').checked    = false;
    document.getElementById('filterNoBooks').checked         = false;
    renderGrid();
  });

  // Edit modal
  document.getElementById('editModal').addEventListener('click', e => {
    if (e.target === document.getElementById('editModal')) closeEditModal();
  });
  document.getElementById('editCloseBtn').addEventListener('click', closeEditModal);
  document.getElementById('editSaveBtn').addEventListener('click', saveEditModal);
  document.getElementById('editDeleteBtn').addEventListener('click', deleteChampion);

  // Rank stars
  document.querySelectorAll('.rank-star-btn').forEach((btn, i) => {
    btn.addEventListener('click', () => {
      if (!currentEditChamp) return;
      const minRank = RARITY_MIN_RANK[championsMap[currentEditChamp]?.rarity] || 1;
      const starN   = i + 1;
      if (starN < minRank) return;
      const newRank = editRank === starN ? Math.max(minRank, starN - 1) : starN;
      updateRankStars(newRank, minRank);
      // Clip ascension to new rank
      if (editAscension > newRank) updateAscensionStars(newRank);
      if (editBlessingLevel > editAscension) updateBlessingStars(editAscension);
    });
  });

  // Ascension stars
  document.querySelectorAll('.ascension-star-btn').forEach((btn, i) => {
    btn.addEventListener('click', () => {
      const newLevel = editAscension === i + 1 ? i : i + 1;
      // Clip to rank
      const clamped = Math.min(newLevel, editRank);
      updateAscensionStars(clamped);
      // Clip blessing to ascension
      if (editBlessingLevel > clamped) updateBlessingStars(clamped);
    });
  });

  // Empower buttons
  document.querySelectorAll('.empower-btn').forEach(btn => {
    btn.addEventListener('click', () => updateEmpowerButtons(parseInt(btn.dataset.level)));
  });

  // Blessing stars
  document.querySelectorAll('.blessing-star-btn').forEach((btn, i) => {
    btn.addEventListener('click', () => {
      const newLevel = editBlessingLevel === i + 1 ? i : i + 1;
      updateBlessingStars(newLevel);
    });
  });

  // Blessing picker
  document.getElementById('editBlessingPickBtn').addEventListener('click', openBlessingPicker);
  document.getElementById('blessingPickerModal').addEventListener('click', e => {
    if (e.target === document.getElementById('blessingPickerModal')) closeBlessingPicker();
  });
  document.getElementById('blessingPickerClose').addEventListener('click', closeBlessingPicker);

  // Add modal
  document.getElementById('addModal').addEventListener('click', e => {
    if (e.target === document.getElementById('addModal')) closeAddModal();
  });
  document.getElementById('addModalClose').addEventListener('click', closeAddModal);
  document.getElementById('addSearchInput').addEventListener('input', e => searchForAdd(e.target.value));
}


// ── Export ─────────────────────────────────────────────────
function exportBox() {
  const total = myBox.length;
  if (!total) { showToast('Nothing to export — your box is empty.'); return; }

  const headers = [
    'Name','Rarity','Affinity','Faction',
    'Rank','Ascension','EmpowerLevel','BlessingName','BlessingLevel',
    'Mastered',
    'T1_Applied','T1_Available','T2_Applied','T2_Available','T3_Applied','T3_Available',
    'Pinned','Note'
  ];

  const rows = myBox.map(d => {
    const name = d.name;
    const c = championsMap[name] || {};
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    return [
      esc(name),
      esc(c.rarity  || ''),
      esc(c.affinity|| ''),
      esc(c.faction || ''),
      d.rank       || 6,
      d.ascension  || 0,
      d.empowerLevel  || 0,
      esc(d.blessingName  || ''),
      d.blessingLevel || 0,
      d.mastered ? 1 : 0,
      d.t1Used    || 0, d.t1Unused || 0,
      d.t2Used    || 0, d.t2Unused || 0,
      d.t3Used    || 0, d.t3Unused || 0,
      d.pinned ? 1 : 0,
      esc(d.note || ''),
    ].join(';');
  });

  const csv  = [headers.join(';'), ...rows].join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `mybox_export_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`✓ Exported ${total} champions.`);
}


// ── Toast ──────────────────────────────────────────────────
function showToast(msg) {
  document.querySelectorAll('.mybox-toast').forEach(t => t.remove());
  const toast = document.createElement('div');
  toast.className   = 'mybox-toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('show'));
  });
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}
