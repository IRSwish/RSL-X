let currentModalIndex = null;
let modalNavigationList = [];
let champions = [];
let factions = [];
let filteredChampions = [];
let championForms = {};
let currentForms = null;
let currentFormIndex = 0;
let selectedAuraStats = [];
let selectedAuraZones = [];

// Effets sélectionnés par l'utilisateur
let activeEffects = {
  Buff: [],
  Debuff: [],
  Positive: [],
  Negative: []
};

// Effets (buffs / debuffs / effets positifs / négatifs)
const EFFECTS = {
  Buff: [],
  Debuff: [],
  Positive: [],
  Negative: []
};

const grid = document.getElementById('championGrid');
const searchInput = document.getElementById('searchInput');
const rarityButtons = document.querySelectorAll('.rarity-btn');
const affinityButtons = document.querySelectorAll('.affinity-btn');
const typeButtons = document.querySelectorAll('.type-btn');
const invocableCheckbox = document.getElementById('invocableOnly');
const countDisplay = document.getElementById('championCount');
const auraStatButtons = document.querySelectorAll(".aura-stat-btn");
const auraAreaButtons = document.querySelectorAll(".aura-area-btn");

let selectedFactions = [];
let selectedRarities = [];
let selectedAffinities = [];
let selectedTypes = [];
let currentSort = { stat: null, order: "asc" };

document.addEventListener("DOMContentLoaded", () => {

  initSqlJs({
    locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
  }).then(SQL => {

    fetch(`/tools/champions-index/champions.db?v=${Date.now()}`)
      .then(res => res.arrayBuffer())
      .then(buffer => {
        const db = new SQL.Database(new Uint8Array(buffer));

        const result = db.exec("SELECT * FROM champions;");

        if (!result.length) {
          console.error("La table champions semble vide ou introuvable");
          return;
        }

          champions = result[0].values.map(r => ({
          id: r[0],
          name: r[1],
          faction: r[2],
          rarity: r[3],
          affinity: r[4],
          type: r[5],
          image: r[6],
          invocable: r[7] === 1,

          hp: Number(r[8]) || 0,
          atk: Number(r[9]) || 0,
          def: Number(r[10]) || 0,
          spd: Number(r[11]) || 0,
          crate: Number(r[12]) || 0,
          cdmg: Number(r[13]) || 0,
          res: Number(r[14]) || 0,
          acc: Number(r[15]) || 0,

          aurastat: r[16] || null,
          aura: r[17] || null,

          s1: r[18] || null,
          s2: r[19] || null,
          s3: r[20] || null,
          s4: r[21] || null,
          p1: r[22] || null,
          p2: r[23] || null,
          IGid: r[25] || null,
          effects: (r[24] || "").split("\n").map(e => e.trim()).filter(e => e.length > 0)
        }));

        // === Charger la table effects ===
        const effectsResult = db.exec("SELECT * FROM effects;");
        if (effectsResult.length) {
          const rows = effectsResult[0].values;
          rows.forEach(r => {
            const [id, name, type, description] = r;
            if (!EFFECTS[type]) EFFECTS[type] = [];
            EFFECTS[type].push({ id, name, type, description });
          });
        } else {
          console.warn("Table 'effects' introuvable ou vide");
        }

        // === Regrouper les formes mythiques par nom ===
        champions.forEach(c => {
          if (!championForms[c.name]) championForms[c.name] = [];
          championForms[c.name].push(c);
        });

        // === Générer les filtres Buffs ===
        const buffGrid = document.getElementById("buffFilterGrid");
        EFFECTS.Buff.forEach(e => {
          const div = document.createElement("div");
          div.className = "effect-icon";
          div.dataset.id = e.id;
          div.dataset.type = "Buff";
          div.title = e.name;
          div.innerHTML = `<img src="/tools/champions-index/img/buffs/${e.id}.webp" alt="${e.name}">`;
          buffGrid.appendChild(div);
        });

        // === Générer les filtres Debuffs ===
        const debuffGrid = document.getElementById("debuffFilterGrid");
        EFFECTS.Debuff.forEach(e => {
          const div = document.createElement("div");
          div.className = "effect-icon";
          div.dataset.id = e.id;
          div.dataset.type = "Debuff";
          div.title = e.name;
          div.innerHTML = `<img src="/tools/champions-index/img/debuffs/${e.id}.webp" alt="${e.name}">`;
          debuffGrid.appendChild(div);
        });

        // === Générer les filtres Positive Effects ===
        const posList = document.getElementById("positiveFilterList");
        EFFECTS.Positive.forEach(e => {
          const row = document.createElement("label");
          row.innerHTML = `
            <input type="checkbox" data-type="Positive" data-id="${e.name}">
            <span>${e.name}</span>
          `;
          posList.appendChild(row);
        });

        // === Générer les filtres Negative Effects ===
        const negList = document.getElementById("negativeFilterList");
        EFFECTS.Negative.forEach(e => {
          const row = document.createElement("label");
          row.innerHTML = `
            <input type="checkbox" data-type="Negative" data-id="${e.name}">
            <span>${e.name}</span>
          `;
          negList.appendChild(row);
        });

        // === Listeners BUFF / DEBUFF (icônes cliquables) ===
        document.querySelectorAll(".effect-icon").forEach(icon => {
          icon.addEventListener("click", () => {
            icon.classList.toggle("active");

            const type = icon.dataset.type;
            const id   = icon.dataset.id;

            if (icon.classList.contains("active")) {
              activeEffects[type].push(id);
            } else {
              activeEffects[type] = activeEffects[type].filter(x => x !== id);
            }

            displayChampions();
          });
        });

        // === Listeners POSITIVE / NEGATIVE (checkboxes) ===
        document.querySelectorAll(".effect-checklist input").forEach(input => {
          input.addEventListener("change", () => {
            const type = input.dataset.type;
            const id   = input.dataset.id;

            if (input.checked) {
              activeEffects[type].push(id);
            } else {
              activeEffects[type] = activeEffects[type].filter(x => x !== id);
            }

            displayChampions();
          });
        });

        // === Collapse Effects ===
        const effectsContainer = document.querySelector(".effects-container");
        const effectsToggle = document.getElementById("effectsToggle");
        const effectsPanel  = document.querySelector(".effects-filters");

        effectsToggle.addEventListener("click", () => {
          effectsContainer.classList.toggle("open");
          effectsPanel.classList.toggle("open");
          effectsContainer.classList.toggle("collapsed");
          lucide.createIcons();
        });

        factions = [...new Set(champions.map(c => c.faction))].sort();

        displayChampions();

        // === INIT FRACTIONS (IMAGES + CLICK) ===
        document.querySelectorAll(".faction-icon").forEach(icon => {
          const faction = icon.dataset.faction;
          const slug = faction.toLowerCase().replace(/ /g, "");

          // assign image dynamically
          icon.src = `/tools/champions-index/img/factions/${slug}.webp`;
          icon.alt = faction;

          // click toggle
          icon.addEventListener("click", () => {
            icon.classList.toggle("active");

            if (icon.classList.contains("active")) {
              selectedFactions.push(faction);
            } else {
              selectedFactions = selectedFactions.filter(f => f !== faction);
            }

            displayChampions();
          });
        });
      })
      .catch(err => console.error("Erreur chargement champions.db :", err));

  });

});



function toggleSelection(array, value) {
  return array.includes(value) ? array.filter(v => v !== value) : [...array, value];
}

searchInput.addEventListener('input', displayChampions);
invocableCheckbox.addEventListener('change', displayChampions);

rarityButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    btn.classList.toggle('active');
    selectedRarities = toggleSelection(selectedRarities, btn.dataset.rarity);
    displayChampions();
  });
});

affinityButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    btn.classList.toggle('active');
    selectedAffinities = toggleSelection(selectedAffinities, btn.dataset.affinity);
    displayChampions();
  });
});

typeButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    btn.classList.toggle('active');
    selectedTypes = toggleSelection(selectedTypes, btn.dataset.type);
    displayChampions();
  });
});

// === AURA STAT FILTERS ===
auraStatButtons.forEach(btn => {
  btn.addEventListener("click", () => {

    // si déjà active → désactivation totale
    if (btn.classList.contains("active")) {
      auraStatButtons.forEach(b => b.classList.remove("active"));
      selectedAuraStats = [];
    }
    else {
      // sinon on active seulement celle-là
      auraStatButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      selectedAuraStats = [btn.dataset.aurastat];
    }

    displayChampions();
  });
});

// === AURA AREA FILTERS ===
auraAreaButtons.forEach(btn => {
  btn.addEventListener("click", () => {

    if (btn.classList.contains("active")) {
      auraAreaButtons.forEach(b => b.classList.remove("active"));
      selectedAuraZones = [];
    }
    else {
      auraAreaButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      selectedAuraZones = [btn.dataset.aurazone];
    }

    displayChampions();
  });
});


document.getElementById("resetFilters").addEventListener("click", resetAllFilters);

document.querySelectorAll(".sort-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const stat = btn.dataset.stat;

    // ---- Gestion des 3 clics ----
    if (currentSort.stat !== stat) {
      // 1er clic → DESC
      currentSort.stat = stat;
      currentSort.order = "desc";
    } else if (currentSort.order === "desc") {
      // 2e clic → ASC
      currentSort.order = "asc";
    } else {
      // 3e clic → Reset complet
      currentSort.stat = null;
      currentSort.order = "asc";

      // RESET VISUEL COMPLET
      document.querySelectorAll(".sort-btn").forEach(b => {
        b.classList.remove("active");

        // remet l'icône en "down" par défaut
        const icon = b.querySelector(".sort-icon");
        icon.setAttribute("data-lucide", "arrow-down-wide-narrow");
      });

      lucide.createIcons();
      displayChampions();
      return;
    }

    // ---- Mise à jour visuelle ----
    document.querySelectorAll(".sort-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    // icône up/down selon ordre
    const icon = btn.querySelector(".sort-icon");
    icon.setAttribute("data-lucide",
      currentSort.order === "desc"
        ? "arrow-down-wide-narrow"
        : "arrow-up-wide-narrow"
    );

    lucide.createIcons();
    displayChampions();
  });
});

const sliderTrack = document.querySelector(".slider-track");
const sliderThumb = document.querySelector(".slider-thumb");

sliderTrack.addEventListener("click", () => {
  const newIndex = currentFormIndex === 0 ? 1 : 0;

  // slider animation
  if (newIndex === 1) {
    sliderThumb.classList.add("alt");
  } else {
    sliderThumb.classList.remove("alt");
  }

  // charger la forme
  loadForm(newIndex);
});


function displayChampions() {
  const searchTerm = searchInput.value.toLowerCase();
  const invocableOnly = invocableCheckbox.checked;

  filteredChampions = champions.filter(c => {
  const matchesName      = c.name.toLowerCase().includes(searchTerm);
  const matchesFaction   = selectedFactions.length === 0 || selectedFactions.includes(c.faction);
  const matchesRarity    = selectedRarities.length === 0 || selectedRarities.includes(c.rarity);
  const matchesAffinity  = selectedAffinities.length === 0 || selectedAffinities.includes(c.affinity);
  const matchesType      = selectedTypes.length === 0 || selectedTypes.includes(c.type);
  const matchesInvocable = !invocableOnly || c.invocable;

  // === AURAS ===
  let matchesAura = true;

  // Si aucun filtre aura n'est actif → on ne touche à rien
  if (selectedAuraStats.length || selectedAuraZones.length) {
    const auraStat = (c.aurastat || "").toUpperCase();
    const auraTextRaw = c.aura || "";
    const auraText = auraTextRaw.toLowerCase();

    // Si le champion n'a pas d'aura → il ne matche pas
    if (!auraStat || !auraTextRaw) {
      matchesAura = false;
    } else {
      // --- Stat ---
      let matchesAuraStat = true;
      if (selectedAuraStats.length) {
        matchesAuraStat = selectedAuraStats.includes(auraStat);
      }

      // --- Zones ---
      let matchesAuraZone = true;
      if (selectedAuraZones.length) {
        const selectedZone = selectedAuraZones[0];

        // Si "All Battles" est sélectionné, on filtre uniquement les auras qui fonctionnent partout
        if (selectedZone === "All Battles") {
          matchesAuraZone = auraText.includes("all battles");
        } else {
          // Pour les autres zones, on vérifie si l'aura mentionne cette zone OU "all battles"
          let zones = [];

          if (auraText.includes("all battles")) {
            zones = ["Arena","Dungeons","Faction Wars","Doom Tower"];
          } else {
            if (auraText.includes("arena"))         zones.push("Arena");
            if (auraText.includes("dungeon"))       zones.push("Dungeons");
            if (auraText.includes("faction wars"))  zones.push("Faction Wars");
            if (auraText.includes("doom tower"))    zones.push("Doom Tower");
          }

          if (!zones.length) {
            matchesAuraZone = false;
          } else {
            matchesAuraZone = zones.includes(selectedZone);
          }
        }
      }

      matchesAura = matchesAuraStat && matchesAuraZone;
    }
  }

  return (
    matchesName &&
    matchesFaction &&
    matchesRarity &&
    matchesAffinity &&
    matchesType &&
    matchesInvocable &&
    matchesAura
  );
});


  // === FILTER BY EFFECTS ===
  const hasActiveEffects =
    activeEffects.Buff.length ||
    activeEffects.Debuff.length ||
    activeEffects.Positive.length ||
    activeEffects.Negative.length;

  let finalFiltered = filteredChampions;

  if (hasActiveEffects) {
    finalFiltered = filteredChampions.filter(c => {
      if (!c.effects || c.effects.length === 0) return false;

      // buffs = ids → doivent être présents dans c.effects
      for (const eff of activeEffects.Buff) {
        if (!c.effects.includes(eff)) return false;
      }

      // debuffs
      for (const eff of activeEffects.Debuff) {
        if (!c.effects.includes(eff)) return false;
      }

      // positive
      for (const eff of activeEffects.Positive) {
        if (!c.effects.includes(eff)) return false;
      }

      // negative
      for (const eff of activeEffects.Negative) {
        if (!c.effects.includes(eff)) return false;
      }

      return true;
    });
  } else {
    finalFiltered = filteredChampions;
  }

  window.__latestFinalFiltered = finalFiltered;
  grid.innerHTML = "";

  // === TRI ===
  if (currentSort.stat) {
    finalFiltered.sort((a, b) => {
      const valA = Number(a[currentSort.stat]) || 0;
      const valB = Number(b[currentSort.stat]) || 0;

      return currentSort.order === "asc"
        ? valA - valB
        : valB - valA;
    });
  }

  // === Eliminations des doublons mythiques ===
  const unique = [];
  const seen = new Set();

  finalFiltered.forEach(c => {
    if (!seen.has(c.name)) {
      unique.push(c);
      seen.add(c.name);
    }
  });

  window.__latestUniqueList = unique;

  // === COMPTEUR CORRECT ===
  countDisplay.textContent =
  `${unique.length} champion${unique.length !== 1 ? 's' : ''} found`;

  unique.forEach(c => {
    const card = document.createElement('div');
    card.classList.add('champion-card');

    const imgWrapper = document.createElement('div');
    imgWrapper.classList.add('card-image', c.rarity.toLowerCase());

    const img = document.createElement('img');
    img.src = `/tools/champions-index/img/champions/${c.image}.webp`;
    img.alt = c.name;
    img.loading = "lazy";
    img.classList.add('champion-img');

    const frame = document.createElement('img');
    frame.src = `/tools/champions-index/img/rarity/${c.rarity}.webp`;
    frame.alt = `${c.rarity} frame`;
    frame.classList.add('rarity-frame');

    const affinity = document.createElement('img');
    affinity.src = `/tools/champions-index/img/affinity/${c.affinity}.webp`;
    affinity.alt = `${c.affinity} affinity`;
    affinity.classList.add('affinity-icon');

    const name = document.createElement('div');
    name.classList.add('champion-name');
    name.textContent = c.name;

    imgWrapper.appendChild(img);
    imgWrapper.appendChild(frame);
    imgWrapper.appendChild(affinity);
    card.appendChild(imgWrapper);
    card.appendChild(name);

    if (currentSort.stat) {
      const statValue = document.createElement("div");
      statValue.style.fontSize = "12px";
      statValue.style.opacity = "0.8";
      statValue.style.marginTop = "2px";
      statValue.textContent = c[currentSort.stat];
      card.appendChild(statValue);
    }

    card.addEventListener("click", () => openChampionModal(c));
    grid.appendChild(card);
  });

  if (finalFiltered.length === 0) {
    grid.innerHTML = '<p style="grid-column: 1 / -1; text-align:center;">No champions found.</p>';
  }
}

function resetAllFilters() {
  // Recherche
  searchInput.value = "";

  // Factions
  selectedFactions = [];
  document.querySelectorAll(".faction-icon").forEach(i => i.classList.remove("active"));

  // Rarity / Affinity / Type
  selectedRarities = [];
  selectedAffinities = [];
  selectedTypes = [];

  document.querySelectorAll(".rarity-btn").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".affinity-btn").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".type-btn").forEach(el => el.classList.remove("active"));

    // Aura filters
  selectedAuraStats = [];
  selectedAuraZones = [];
  document.querySelectorAll(".aura-stat-btn").forEach(btn => btn.classList.remove("active"));
  document.querySelectorAll(".aura-area-btn").forEach(btn => btn.classList.remove("active"));


  // Invocable only
  invocableCheckbox.checked = false;

  // Reset tri
  currentSort.stat = null;
  currentSort.order = "asc";
  document.querySelectorAll(".sort-btn").forEach(btn => {
    btn.classList.remove("active");
    const icon = btn.querySelector(".sort-icon");
    if (icon) icon.setAttribute("data-lucide", "arrow-down-wide-narrow");
  });

  // Effects
  document.querySelectorAll(".effect-icon").forEach(icon => icon.classList.remove("active"));
  document
    .querySelectorAll('input[data-type="Positive"], input[data-type="Negative"]')
    .forEach(cb => (cb.checked = false));

  activeEffects = {
    Buff: [],
    Debuff: [],
    Positive: [],
    Negative: []
  };

  lucide.createIcons();
  displayChampions();
}

const modal = document.getElementById("championModal");

let primaryChampion = null;
let compareChampion = null;

const compareToggle = document.getElementById("compareToggle");
const compareHeader = document.getElementById("compareHeader");
const compareTargetName = document.getElementById("compareTargetName");
const compareInputWrapper = document.getElementById("compareInputWrapper");
const compareInput = document.getElementById("compareInput");
const compareSuggestions = document.getElementById("compareSuggestions");

const STAT_CONFIG = [
  { key: "hp",   id: "statHP",   isPercent: false },
  { key: "atk",  id: "statATK",  isPercent: false },
  { key: "def",  id: "statDEF",  isPercent: false },
  { key: "spd",  id: "statSPD",  isPercent: false },
  { key: "crate",id: "statCRATE",isPercent: true  },
  { key: "cdmg", id: "statCDMG", isPercent: true  },
  { key: "res",  id: "statRES",  isPercent: false },
  { key: "acc",  id: "statACC",  isPercent: false }
];

function formatValue(val, isPercent) {
  if (isNaN(val)) return "—";
  return isPercent ? `${val}%` : val;
}

function formatPercent(p) {
  if (!isFinite(p)) return "0%";
  const rounded = Math.round(p);
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded}%`;
}

function updateStatsDisplay(primary, secondary = null) {
  STAT_CONFIG.forEach(cfg => {
    const el = document.getElementById(cfg.id);
    if (!el) return;

    const p = primary[cfg.key] ?? 0;
    const s = secondary ? secondary[cfg.key] ?? 0 : null;

    // MODE NORMAL (pas de comparatif)
    if (!secondary) {
      el.textContent = formatValue(p, cfg.isPercent);
      return;
    }

    // MODE COMPARATIF
    const equal = p === s;
    const pct = s ? ((p - s) / s) * 100 : 0;

    // couleurs
    const leftClass  = equal ? "positive" : (p > s ? "positive" : "negative");
    const rightClass = equal ? "positive" : (p > s ? "negative" : "positive");
    const pctClass   = equal ? "equal" : (pct >= 0 ? "positive" : "negative");

    el.innerHTML = `
      <span class="stat-number primary ${leftClass}">${formatValue(p, cfg.isPercent)}</span>
      <span class="stat-percent ${pctClass}">${formatPercent(pct)}</span>
      <span class="stat-number secondary ${rightClass}">${formatValue(s, cfg.isPercent)}</span>
    `;
  });
}

function renderSkills(champ) {
   const container = document.getElementById("modalSkills");
    if (!container) return;
    container.innerHTML = "";

    const gid = champ.IGid || champ.image || champ.id;

    // === CREATE MAIN ROW CONTAINER ===
    container.insertAdjacentHTML("beforeend", `
      <div class="aura-tomes-row"></div>
    `);

    const row = container.querySelector(".aura-tomes-row");

    // FLAGS
    let hasAura = champ.aurastat && champ.aura;
    let hasTomes = false;

   // === CREATE AURA + TOMES WRAPPER ===
    if (hasAura) {
      row.insertAdjacentHTML("beforeend", `
        <div class="aura-block aura-entry-wrapper">
          <div class="aura-entry">
            <div class="aura-icon-wrapper">
              <img class="aura-icon" src="/tools/champions-index/img/aura/${champ.aurastat}.webp" alt="Aura">
            </div>
            <div class="aura-text">
              <div class="aura-title">AURA</div>
              <div class="aura-desc">${champ.aura}</div>
            </div>
          </div>
        </div>
      `);
    }

    // ===== TOMES / COPIES BLOCK (separate right column) =====
    (function() {
      const rarity = champ.rarity.toLowerCase();
      // singular/plural helper
      const plural = (n, singular, plural) => n === 1 ? singular : plural;
      const countTomes = raw =>
        raw ? (raw.match(/^Level\s+\d+:/gm) || []).length : 0;

      let tomeDetails = [];
      let totalTomes = 0;

      // Skills A1-A6
      for (let i = 1; i <= 6; i++) {
        const raw = champ[`s${i}`];
        if (!raw) continue;

        const tomes = countTomes(raw);
        if (tomes > 0) {
          tomeDetails.push({ label: `A${i}`, tomes });
          totalTomes += tomes;
        }
      }

      // Passives P1-P2
      let pIndex = 1;
      for (let p = 1; p <= 2; p++) {
        const raw = champ[`p${p}`];
        if (!raw) continue;

        const tomes = countTomes(raw);
        if (tomes > 0) {
          tomeDetails.push({ label: `Passive ${pIndex}`, tomes });
          totalTomes += tomes;
        }
        pIndex++;
      }

      if (totalTomes > 0) hasTomes = true;

      // If no tomes → skip block
      if (totalTomes === 0) return;

      // Determine tome icon
      let iconHTML = "";
      if (["rare","epic","legendary","mythical"].includes(rarity)) {
        iconHTML = `
          <img src="/style/img/Misc/skill-tome-${rarity}.webp" class="tome-icon">
        `;
      } else {
        iconHTML = `
          <div class="copy-icon-wrapper">
            <img src="/tools/champions-index/img/champions/${champ.image}.webp" class="copy-icon">
            <img src="/tools/champions-index/img/rarity/${champ.rarity}.webp" class="copy-frame">
          </div>
        `;
      }

      let detailsHTML = "";
      tomeDetails.forEach(d => {
        detailsHTML += `<div class="tome-line">${d.label}: ${d.tomes} tomes</div>`;
      });

      const tomesHTML = `
      <div class="tomes-entry">
          <div class="tomes-icon-wrapper">
              ${iconHTML}
          </div>

          <div class="tomes-text">
              <div class="tomes-title">
                  ${totalTomes} ${
                      ["common","uncommon"].includes(rarity)
                      ? `${champ.rarity} ${plural(totalTomes, "Copy", "Copies")}`
                      : `${champ.rarity} Skill ${plural(totalTomes, "Tome", "Tomes")}`
                  }
              </div>

              <ul class="tomes-list">
                  ${tomeDetails.map(t => `
                      <li>${t.label}: ${t.tomes} ${
                          ["common","uncommon"].includes(rarity)
                          ? plural(t.tomes, "copy", "copies")
                          : plural(t.tomes, "tome", "tomes")
                      }</li>
                  `).join("")}
              </ul>
          </div>
      </div>
    `;

      // Insert SEPARATE block
      document.querySelector(".aura-tomes-row")
      if (hasTomes) {
        row.insertAdjacentHTML("beforeend", `
          <div class="tomes-block tomes-entry-wrapper">
            ${tomesHTML}
          </div>
        `);
      }

    })();

    // === Final layout adjustment for 50/50 or centered ===
    const auraBlock = row.querySelector(".aura-entry-wrapper");
    const tomeBlock = row.querySelector(".tomes-entry-wrapper");

    if ((hasAura && !hasTomes) || (!hasAura && hasTomes)) {
      row.classList.add("single");
    }
    else if (hasAura && !hasTomes) {
      // Only aura → full width centered
      auraBlock.style.width = "100%";
      auraBlock.style.justifyContent = "center";
    }
    else if (!hasAura && hasTomes) {
      // Only tomes → full width centered
      tomeBlock.style.width = "100%";
      tomeBlock.style.display = "flex";
      tomeBlock.style.justifyContent = "center";
    }


  // ===== SKILLS ACTIFS s1..s6 =====
  let activeCount = 0;
  for (let i = 1; i <= 6; i++) {
    const raw = champ[`s${i}`];
    if (!raw) continue;

    const [title, ...descLines] = raw.split("\n");
    const desc = descLines.join("\n");

    const img = `/tools/champions-index/img/skills/${gid}_s${i}.webp`;
    activeCount++;
    const formattedDesc = (desc || "")
      .replace(/\[(.*?)\]/g, '<span class="skill-bracket">[$1]</span>')
      .replace(/^.*?Multiplier:/gm, '<span class="multiplier-label">$&</span>')
      .replace(/\n/g, "<br>");

    const skillHTML = `
      <div class="skill-entry">
        <div class="skill-icon-wrapper">
            <img class="skill-icon" src="${img}">
        </div>
        <div class="skill-info">
          <div class="skill-title">${title}</div>
          <div class="skill-desc">
            ${formattedDesc}
          </div>
        </div>
      </div>
    `;
    container.insertAdjacentHTML("beforeend", skillHTML);
  }

  // ===== PASSIFS p1, p2 =====
  for (let p = 1; p <= 2; p++) {
    const raw = champ[`p${p}`];
    if (!raw) continue;

    const [title, ...descLines] = raw.split("\n");
    const desc = descLines.join("\n");

    const imgIndex = activeCount + p;
    const img = `/tools/champions-index/img/skills/${gid}_s${imgIndex}.webp`;
    const formattedDesc = (desc || "")
      .replace(/\[(.*?)\]/g, '<span class="skill-bracket">[$1]</span>')
      .replace(/^.*?Multiplier:/gm, '<span class="multiplier-label">$&</span>')
      .replace(/\n/g, "<br>");

    const passiveHTML = `
      <div class="skill-entry">
        <div class="skill-icon-wrapper passive">
          <div class="passive-stroke"></div>
          <div class="passive-glow"></div>
            <img class="skill-icon" src="${img}">
        </div>
        <div class="skill-info">
          <div class="skill-title">${title}</div>
          <div class="skill-desc">
            ${formattedDesc}
          </div>
        </div>
      </div>
    `;
    container.insertAdjacentHTML("beforeend", passiveHTML);
  }
}

function resetCompareUI() {
  compareChampion = null;
  compareHeader.style.display = "none";
  compareTargetName.textContent = "";
  compareInputWrapper.style.display = "none";
  compareSuggestions.innerHTML = "";
  compareToggle.dataset.mode = "off";
  compareToggle.innerHTML = `<i data-lucide="arrow-right-left"></i>`;
  lucide.createIcons();
}

function loadForm(index) {
  currentFormIndex = index;
  const champ = currentForms[index];

  primaryChampion = champ;
  resetCompareUI();

  // images
  document.getElementById("modalChampionImg").src = `/tools/champions-index/img/champions/${champ.image}.webp`;
  document.getElementById("modalFrameImg").src = `/tools/champions-index/img/rarity/${champ.rarity}.webp`;
  document.getElementById("modalFactionBanner").src = `/tools/champions-index/img/factions/${champ.faction.toLowerCase().replace(/ /g,"")}.webp`;
  document.getElementById("modalAffinityBig").src = `/tools/champions-index/img/affinity/${champ.affinity}.webp`;

  // titres
  document.getElementById("modalFactionTitle").textContent = champ.faction;
  document.getElementById("modalChampionTitle").textContent = champ.name;
  document.getElementById("modalStatsTitle").textContent = champ.type;

  // stats
  updateStatsDisplay(champ, null);

  // skills
  renderSkills(champ);

  // icônes
  lucide.createIcons();

  // maj du switch
  document.querySelectorAll(".form-option").forEach(opt => opt.classList.remove("active"));
  const activeBtn = document.querySelector(`.form-option[data-form="${index}"]`);
  if (activeBtn) activeBtn.classList.add("active");
}

function openChampionModal(champ) {

  // snapshot de la liste réellement affichée (une entrée par nom)
  modalNavigationList = [...(window.__latestUniqueList || [])];

  // position dans cette liste
  currentModalIndex = modalNavigationList.findIndex(c => c.id === champ.id);


  // récupérer toutes les formes de ce champion
  currentForms = championForms[champ.name] || [champ];
  currentFormIndex = 0;

  // afficher ou masquer le switch
  const fs = document.getElementById("formSwitch");
  fs.style.display = currentForms.length > 1 ? "flex" : "none";

  document.querySelector(".slider-thumb").classList.remove("alt");

  // charger la forme 0 (Base)
  loadForm(0);
    document.body.classList.add("modal-open");
    modal.classList.add("active");
  }

compareToggle.addEventListener("click", () => {
  const mode = compareToggle.dataset.mode || "off";

  // OFF -> passage en sélection (affiche input)
  if (mode === "off") {
    compareToggle.dataset.mode = "select";
    compareToggle.innerHTML = `<i data-lucide="x"></i>`;
    compareInputWrapper.style.display = "block";
    compareHeader.style.display = "none";
    compareInput.value = "";
    compareSuggestions.innerHTML = "";
    compareInput.focus();
    updateStatsDisplay(primaryChampion, null);
    lucide.createIcons();
    return;
  }

  // SELECT ou ON -> reset (fermer le comparatif)
  resetCompareUI();
  updateStatsDisplay(primaryChampion, null);
});

function selectCompareChampion(champ) {
  compareChampion = champ;
  compareToggle.dataset.mode = "on";

  compareHeader.style.display = "block";
  compareTargetName.textContent = champ.name;

  compareInputWrapper.style.display = "none";
  compareSuggestions.innerHTML = "";

  updateStatsDisplay(primaryChampion, compareChampion);
}

compareInput.addEventListener("input", () => {
  const query = compareInput.value.toLowerCase();
  compareSuggestions.innerHTML = "";
  if (!query) return;

  const matches = champions
    .filter(c =>
      primaryChampion &&
      c.id !== primaryChampion.id &&
      c.name.toLowerCase().includes(query)
    )
    .slice(0, 8);

  matches.forEach(c => {
    const item = document.createElement("div");
    item.className = "compare-suggestion";
    item.textContent = c.name;
    item.addEventListener("click", () => selectCompareChampion(c));
    compareSuggestions.appendChild(item);
  });
});

compareInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const query = compareInput.value.toLowerCase();
    let match = champions.find(c =>
      primaryChampion &&
      c.id !== primaryChampion.id &&
      c.name.toLowerCase() === query
    );

    if (!match && compareSuggestions.firstElementChild) {
      const name = compareSuggestions.firstElementChild.textContent;
      match = champions.find(c => c.name === name);
    }

    if (match) {
      selectCompareChampion(match);
    }
  }
});

document.querySelector(".modal-close").addEventListener("click", () => {
  modal.classList.remove("active");
  document.body.classList.remove("modal-open");
});

modal.addEventListener("click", e => {
  if (e.target === modal) {
    modal.classList.remove("active");
    document.body.classList.remove("modal-open");
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const modal = document.getElementById("championModal");
    if (modal.classList.contains("active")) {
      modal.classList.remove("active");
      document.body.classList.remove("modal-open");
      comparing = false;
      resetCompareUI();
    }
  }
});

function openNextChampion() {
  if (currentModalIndex === null) return;
  if (currentModalIndex < modalNavigationList.length - 1) {
    currentModalIndex++;
    openChampionModal(modalNavigationList[currentModalIndex], true);
  }
}

function openPrevChampion() {
  if (currentModalIndex === null) return;
  if (currentModalIndex > 0) {
    currentModalIndex--;
    openChampionModal(modalNavigationList[currentModalIndex], true);
  }
}

document.querySelector(".modal-nav.prev").addEventListener("click", openPrevChampion);
document.querySelector(".modal-nav.next").addEventListener("click", openNextChampion);

document.addEventListener("keydown", e => {
  const modalIsOpen = modal.classList.contains("active");
  if (!modalIsOpen) return;

  if (e.key === "ArrowRight") openNextChampion();
  if (e.key === "ArrowLeft")  openPrevChampion();
});
