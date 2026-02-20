const ICON_PATH = "/style/img/Misc/";
let rewards = [];
let unlocked = new Set(); // verts
let planned = new Set();  // bleus
let keys = 0;             // clés disponibles
let activeLocks = 0;      // locks actifs
let points = 0;
let dependentsMap = {};
let totalKeys = 0; 

const container = document.getElementById("rewardContainer");
const svg = document.getElementById("connections");
const titleEl = document.querySelector("h1");

/* === BANDEAU INFO LATÉRAL === */
const infoSidebar = document.createElement("div");
infoSidebar.id = "info-sidebar";
infoSidebar.innerHTML = `
<br /><br />
  <div class="stat-item">
    <span class="stat-label">Available:</span>
    <input id="pointsAvailable" type="number" value="0" style="width: 80px; background:#0e0e0e; color:#fcf6ff; border:none; border-radius:4px; padding:4px 8px; text-align:right; font-weight:600;">
  </div>

  <div class="stat-item">
    <span class="stat-label">Spent:</span>
    <span class="stat-value" id="pointsSpent">0</span>
  </div>

  <div class="stat-item">
    <span class="stat-label">Needed:</span>
    <span class="stat-value" id="pointsNeeded">0</span>
  </div>

  <div class="stat-item">
    <span class="stat-label">Keys:</span>
    <span class="stat-value" id="keysCount">0</span>
  </div>

  <div id="shardsSection" class="shards-section" style="display:none;">
    <div class="shards-title">Planned Cost in Shards</div>
    <div id="shardsContainer"></div>
  </div>

  <div id="totalPoints" class="total-points"></div>

  <button id="reset" class="reset-btn" aria-label="Reset">
    <i data-lucide="rotate-cw"></i>
  </button>
`;
document.body.appendChild(infoSidebar);

// === Bouton Info (toggle du panneau) ===
const infoBtn = document.getElementById("info-btn");
infoBtn.addEventListener("click", () => {
  infoSidebar.classList.toggle("closed");
});

/* === RÉFÉRENCES === */
const pointsAvailableInput = document.getElementById("pointsAvailable");
const pointsSpentSpan = document.getElementById("pointsSpent");
const pointsNeededSpan = document.getElementById("pointsNeeded");
const keysSpan = document.getElementById("keysCount");
const resetBtn = document.getElementById("reset");
const shardsSection = document.getElementById("shardsSection");
const shardsContainer = document.getElementById("shardsContainer");
const totalPointsDiv = document.getElementById("totalPoints");

let currentShardCosts = null;

/* === LOCAL STORAGE === */
function getStorageKey() {
  const pathId = window.location.hash.replace("#", "").trim() || "default";
  return `rewardState_${pathId}`;
}

function saveState() {
  const state = {
    unlocked: [...unlocked],
    planned: [...planned],
    pointsAvailable: Number(pointsAvailableInput.value || 0),
  };
  localStorage.setItem(getStorageKey(), JSON.stringify(state));
}

function loadState() {
  const raw = localStorage.getItem(getStorageKey());
  if (!raw) return;
  try {
    const s = JSON.parse(raw);
    unlocked = new Set(s.unlocked || []);
    planned = new Set(s.planned || []);
    if (typeof s.pointsAvailable === "number")
      pointsAvailableInput.value = s.pointsAvailable;
  } catch (e) {
    console.warn("⚠️ Failed to parse saved state:", e);
  }
}

/* === STATS === */
function updateStats() {
  const available = Number(pointsAvailableInput.value || 0);

  // 🟩 Points dépensés
  let spentPoints = 0;
  for (const id of unlocked) {
    const r = rewards.find(x => x.id === id);
    if (!r || r.name.toLowerCase().includes("lock")) continue;
    spentPoints += r.cost || 0;
  }

  // 🟦 Points planifiés
  let plannedPoints = 0;
  for (const id of planned) {
    const r = rewards.find(x => x.id === id);
    if (!r || r.name.toLowerCase().includes("lock")) continue;
    plannedPoints += r.cost || 0;
  }

  // Points nécessaires
  const needed = Math.max(0, plannedPoints - available);

  pointsSpentSpan.textContent = spentPoints.toLocaleString("en-US");
  pointsNeededSpan.textContent = needed.toLocaleString("en-US");
  keysSpan.textContent = keys.toString();

  // Calcul du total de points dans l'arbre
  const totalTreePoints = rewards.reduce((sum, r) => {
    if (r.name.toLowerCase().includes("lock")) return sum;
    return sum + (r.cost || 0);
  }, 0);
  totalPointsDiv.textContent = `Total tree: ${totalTreePoints.toLocaleString("en-US")} pts`;

  // Calcul des shards nécessaires pour le planned (en soustrayant les points disponibles)
  if (currentShardCosts && needed > 0) {
    shardsSection.style.display = 'block';
    updateShardDisplay(needed);
  } else {
    shardsSection.style.display = 'none';
  }

  saveState();
}

/* === CALCUL ET AFFICHAGE DES SHARDS === */
function updateShardDisplay(plannedPoints) {
  if (!currentShardCosts) return;

  const shards = [
    { name: 'Ancient', type: 'Ancient', cost: currentShardCosts.ancient },
    { name: 'Void', type: 'Void', cost: currentShardCosts.void },
    { name: 'Primal', type: 'Primal', cost: currentShardCosts.primal },
    { name: 'Sacred', type: 'Sacred', cost: currentShardCosts.sacred }
  ];

  shardsContainer.innerHTML = shards.map(shard => {
    const count = (plannedPoints / shard.cost).toFixed(2);
    return `
      <div class="shard-item">
        <img src="/style/img/Misc/${shard.type}.webp" alt="${shard.name}">
        <span class="shard-name">${shard.name}</span>
        <span class="shard-count">${count}</span>
      </div>
    `;
  }).join('');
}

/* === RECALCUL GÉNÉRAL === */
function recalcKeysAndPoints() {
  let newTotalKeys = 0;
  let newLocks = 0;
  let newPoints = 0;

  for (const id of unlocked) {
    const r = rewards.find(x => x.id === id);
    if (!r) continue;
    const name = r.name.toLowerCase();

    if (name.includes("key")) {
      newTotalKeys += r.keys && r.keys > 0 ? r.keys : 1;
      newPoints += r.cost || 0;
    } else if (name.includes("lock")) {
      newLocks += r.cost || 1;
      newPoints += r.cost || 0;
    } else {
      newPoints += r.cost || 0;
    }
  }

  totalKeys = newTotalKeys;                  // 🔢 total de clés possédées
  activeLocks = newLocks;                    // 🔒 locks actifs
  keys = Math.max(0, totalKeys - newLocks);  // ✅ clés disponibles (affichage)
  points = newPoints;
}

/* === SÉCURITÉ CLÉS / LOCKS === */
function enforceKeyLimit() {
  // ❗ On vérifie contre le TOTAL de clés, pas "keys" (qui est déjà soustrait des locks)
  if (activeLocks <= totalKeys) return;

  const locksToRemove = activeLocks - totalKeys;
  const activeLockRewards = Array.from(unlocked)
    .map(id => rewards.find(r => r.id === id))
    .filter(r => r && r.name.toLowerCase().includes("lock"));

  for (let i = 0; i < locksToRemove; i++) {
    const lockToRemove = activeLockRewards.pop();
    if (!lockToRemove) break;

    unlocked.delete(lockToRemove.id);
    const box = document.querySelector(`.reward-box[data-id="${lockToRemove.id}"]`);
    if (box) {
      box.className = "reward-box locked";
      box.dataset.state = "locked";
    }
    cascadeDeactivate(lockToRemove.id);
  }

  recalcKeysAndPoints();
}

/* === RESET === */
function resetAll() {
  unlocked.clear();
  planned.clear();
  keys = 0;
  activeLocks = 0;
  points = 0;

  document.querySelectorAll(".reward-box").forEach(b => {
    b.className = "reward-box locked";
    b.dataset.state = "locked";
  });

  recalcKeysAndPoints();
  enforceKeyLimit();
  updateAvailability();
  drawConnections();
  updateStats();
  saveState();
}

resetBtn.addEventListener("click", resetAll);
pointsAvailableInput.addEventListener("input", updateStats);

/* === INIT === */
async function init() {
  const pathId = window.location.hash.replace("#", "").trim();

  if (!pathId || !window.fusions || !window.fusions[pathId]) {
    document.body.innerHTML = "<h2 style='text-align:center;color:red'>Invalid Path Configuration</h2>";
    return;
  }

  const fusion = window.fusions[pathId];
  const jsonFile = fusion.json;
  const displayName = fusion.name || "Hero's Path";

  // Charge les coûts de shards s'ils existent
  currentShardCosts = fusion.shardCosts || null;

  const pageTitleEl = document.getElementById("page-title");
  if (pageTitleEl) pageTitleEl.textContent = displayName.toUpperCase();
  document.title = `${displayName} - ${window.siteConfig.title}`;
  if (titleEl) titleEl.textContent = displayName.toUpperCase();

  try {
    const res = await fetch(`${jsonFile}?v=${Date.now()}`);
    rewards = await res.json();
  } catch {
    document.body.innerHTML = `<h2 style='text-align:center;color:red'>Failed to load ${jsonFile}</h2>`;
    return;
  }

  dependentsMap = {};
  for (const r of rewards) {
    (r.requires || []).forEach(req => {
      if (!dependentsMap[req]) dependentsMap[req] = [];
      dependentsMap[req].push(r.id);
    });
  }

  const tiers = {};
  for (const r of rewards) {
    const match = r.id.match(/^t(\d+)/);
    const tier = match ? parseInt(match[1]) : 0;
    if (!tiers[tier]) tiers[tier] = [];
    tiers[tier].push(r);
  }

  const sortedTiers = Object.keys(tiers).sort((a, b) => a - b);
  sortedTiers.forEach(tier => {
    const row = document.createElement("div");
    row.className = "reward-row";
    let hasVisibleItems = false;

    tiers[tier].forEach((r, __idx) => {
      // Skip hidden items
      if (r.hidden === true) return;

      hasVisibleItems = true;

      const box = document.createElement("div");
      box.className = "reward-box locked";
      box.dataset.id = r.id;
      box.dataset.state = "locked";
      if (r.hasOwnProperty("x")) {
        box.setAttribute("data-x", String(r.x));
      } else {
        box.setAttribute("data-x", String(__idx + 1));
      }

      const img = document.createElement("img");
      img.src = ICON_PATH + r.image + ".webp";
      img.alt = r.name;

      const name = document.createElement("div");
      name.className = "reward-name";
      name.textContent = r.name;

      const cost = document.createElement("div");
      cost.className = "reward-cost";
      cost.textContent = r.name.toLowerCase().includes("lock")
        ? `${r.cost || 1} key${(r.cost || 1) > 1 ? "s" : ""}`
        : `${r.cost.toLocaleString("en-US")} pts`;

      box.append(img, name, cost);
      row.appendChild(box);
      box.addEventListener("click", () => handleClick(r, box));
    });

    // Only append the row if it has visible items
    if (hasVisibleItems) {
      container.appendChild(row);
    }
  });

  loadState();

  // Débloque automatiquement les items initiaux si définis dans la config
  if (fusion.initialUnlocked && Array.isArray(fusion.initialUnlocked)) {
    fusion.initialUnlocked.forEach(id => {
      unlocked.add(id);
    });
  }

  recalcKeysAndPoints();
  enforceKeyLimit();
  updateAvailability();
  drawConnections();
  updateStats();

  let lastWidth = window.innerWidth;
  let lastHeight = window.innerHeight;

  window.addEventListener("resize", () => {
    clearTimeout(window._resizeTimeout);

    // Détecte si la largeur a changé (pour les media queries)
    const currentWidth = window.innerWidth;
    const currentHeight = window.innerHeight;
    const widthChanged = Math.abs(currentWidth - lastWidth) > 10;
    const heightChanged = Math.abs(currentHeight - lastHeight) > 50;

    if (widthChanged || heightChanged) {
      // Efface immédiatement si changement significatif
      svg.innerHTML = "";
      lastWidth = currentWidth;
      lastHeight = currentHeight;
    }

    // Délai plus long si changement important (changement d'écran)
    const delay = (widthChanged && heightChanged) ? 150 : 50;

    window._resizeTimeout = setTimeout(() => {
      // Petit délai supplémentaire pour que les media queries s'appliquent
      requestAnimationFrame(() => {
        // Recalcule le layout avec callback pour redessiner après
        layoutByX(() => {
          drawConnections();
        });
      });
    }, delay);
  });
  window.addEventListener("scroll", () => requestAnimationFrame(drawConnections));
}

/* === INTERACTIONS === */
function handleClick(reward, box) {
  const state = box.dataset.state;
  const name = reward.name.toLowerCase();
  const isKey = name.includes("key");
  const isLock = name.includes("lock");

  // LOCKED → PLANNED
  if (state === "locked" || state === "available") {
    const requires = reward.requires || [];
    const canTake = requires.length === 0 || requires.some(req => unlocked.has(req) || planned.has(req));
    if (!canTake) return;

    planned.add(reward.id);
    box.className = "reward-box planned";
    box.dataset.state = "planned";

    updateAvailability();
    drawConnections();
    recalcKeysAndPoints();
    enforceKeyLimit();
    updateStats();
    return;
  }

  // PLANNED → ACTIVE
  if (state === "planned") {
    recalcKeysAndPoints(); // 🆕 recalcul avant vérif
    const requires = reward.requires || [];
    const canActivate = requires.length === 0 || requires.some(req => unlocked.has(req));
    if (!canActivate) {
      const requires = reward.requires || [];
      const parentPlanned = requires.some(req => planned.has(req));
      if (parentPlanned) {
        // 🔁 Si le parent est aussi planned, on repasse l’enfant en locked
        planned.delete(reward.id);
        const boxEl = document.querySelector(`.reward-box[data-id="${reward.id}"]`);
        if (boxEl) {
          boxEl.className = "reward-box locked";
          boxEl.dataset.state = "locked";
        }
        cascadeDeactivate(reward.id); // coupe les enfants
        updateAvailability();
        drawConnections();
        updateStats();
        return;
      }

      flashRed(box);
      return;
    }

    if (isLock && keys < (reward.cost || 1)) {
      flashRed(box);
      return;
    }

    planned.delete(reward.id);
    unlocked.add(reward.id);

    box.className = "reward-box active";
    box.dataset.state = "active";

    playActivationEffect(box);
    recalcKeysAndPoints();
    enforceKeyLimit();
    updateAvailability();
    drawConnections();
    updateStats();
    return;
  }

  // ACTIVE → LOCKED
  if (state === "active") {
    unlocked.delete(reward.id);
    cascadeDeactivate(reward.id);
    recalcKeysAndPoints();
    enforceKeyLimit();
    updateAvailability();
    drawConnections();
    updateStats();
    return;
  }
}

function flashRed(el) {
  el.style.boxShadow = "0 0 10px red";
  setTimeout(() => (el.style.boxShadow = ""), 300);
}

/* === DISPONIBILITÉ === */
function updateAvailability() {
  document.querySelectorAll(".reward-box").forEach(box => {
    const id = box.dataset.id;
    const reward = rewards.find(r => r.id === id);
    if (!reward) return;

    if (unlocked.has(id)) {
      box.className = "reward-box active";
      box.dataset.state = "active";
      return;
    }
    if (planned.has(id)) {
      box.className = "reward-box planned";
      box.dataset.state = "planned";
      return;
    }

    const requires = reward.requires || [];
    const canTake = requires.length === 0 ||
                    requires.some(req => unlocked.has(req) || planned.has(req));

    box.className = canTake ? "reward-box available" : "reward-box locked";
    box.dataset.state = canTake ? "available" : "locked";
  });

  updateStats();
}

/* === CASCADE === */
function cascadeDeactivate(id) {
  const dependents = dependentsMap[id] || [];
  for (const depId of dependents) {
    const reward = rewards.find(r => r.id === depId);
    if (!reward) continue;

    const stillConnected = (reward.requires || []).some(req => unlocked.has(req) || planned.has(req));
    if (stillConnected) continue;

    const box = document.querySelector(`.reward-box[data-id="${depId}"]`);
    if (!box) continue;

    unlocked.delete(depId);
    planned.delete(depId);
    box.className = "reward-box locked";
    box.dataset.state = "locked";

    cascadeDeactivate(depId);
  }
}

/* === CHEMINS === */
function drawConnections() {
  svg.innerHTML = "";

  const grayPaths = [], goldPaths = [], bluePaths = [], greenPaths = [];

  rewards.forEach(r => {
    (r.requires || []).forEach(req => {
      const pBox = document.querySelector(`.reward-box[data-id="${req}"]`);
      const cBox = document.querySelector(`.reward-box[data-id="${r.id}"]`);
      if (!pBox || !cBox) return;

      // Utilise offsetLeft/offsetTop qui reflètent immédiatement style.left/style.top
      // puis ajoute les offsets du parent pour avoir la position absolue
      const pRow = pBox.parentElement;
      const cRow = cBox.parentElement;

      // Position de la box parent (haut de la ligne)
      const pRowRect = pRow.getBoundingClientRect();
      const cRowRect = cRow.getBoundingClientRect();
      const svgRect = svg.getBoundingClientRect();

      // Calcule les positions en utilisant offsetLeft (qui lit style.left directement)
      const pLeft = parseFloat(pBox.style.left) || pBox.offsetLeft;
      const cLeft = parseFloat(cBox.style.left) || cBox.offsetLeft;

      const x1 = pLeft;
      const y1 = pRowRect.bottom - svgRect.top;
      const x2 = cLeft;
      const y2 = cRowRect.top - svgRect.top;
      const midY = y1 + (y2 - y1) * 0.45;

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M${x1},${y1} L${x1},${midY} L${x2},${midY} L${x2},${y2}`);
      path.setAttribute("stroke-width", "3.5");
      path.setAttribute("fill", "none");

      const parentPlanned = planned.has(req);
      const childPlanned = planned.has(r.id);
      const parentActive = unlocked.has(req);
      const childActive = unlocked.has(r.id);

      if (parentActive && childActive) {
        path.setAttribute("stroke", "#00ff66");
        greenPaths.push(path);
      } else if ((parentPlanned && childPlanned) || (parentActive && childPlanned)) {
        path.setAttribute("stroke", "#00c9ff");
        bluePaths.push(path);
      } else if (parentActive && !childActive) {
        path.setAttribute("stroke", "#d4af37");
        goldPaths.push(path);
      } else {
        path.setAttribute("stroke", "#555");
        grayPaths.push(path);
      }
    });
  });

  grayPaths.forEach(p => svg.appendChild(p));
  goldPaths.forEach(p => svg.appendChild(p));
  bluePaths.forEach(p => svg.appendChild(p));
  greenPaths.forEach(p => svg.appendChild(p));
}

function playActivationEffect(box) {
  const fx = document.createElement("div");
  fx.className = "activation-flash";
  box.appendChild(fx);
  setTimeout(() => fx.remove(), 700);
}

/* === LAYOUT X (placement figé par colonne, supporte x décimal, 0-based) === */
function layoutByX(callback) {
  const rows = Array.from(document.querySelectorAll(".reward-row"));
  if (!rows.length) {
    callback?.();
    return;
  }

  // Vérifie si le JSON contient au moins un "x"
  const hasX = rewards.some(r => typeof r.x === "number" && !isNaN(r.x));

  // S'il n'y a aucun x -> on laisse le flex d'origine
  if (!hasX) {
    rows.forEach(row => {
      row.style.display = "flex";
      row.style.flexWrap = "wrap";
      row.style.justifyContent = "center";
      row.style.gap = "15px";
      row.style.position = "";
      row.querySelectorAll(".reward-box").forEach(box => {
        box.style.position = "";
        box.style.left = "";
        box.style.transform = "";
      });
    });
    callback?.();
    return; // on sort, pas de layout figé
  }

  // --- sinon, on applique le placement absolu comme avant ---
  const allBoxes = Array.from(document.querySelectorAll(".reward-box"));
  let maxCols = 0;
  allBoxes.forEach(b => {
    const xAttr = b.getAttribute("data-x");
    const x = parseFloat(xAttr);
    if (isFinite(x)) {
      const neededCols = Math.floor(x) + 1;
      if (neededCols > maxCols) maxCols = neededCols;
    }
  });
  if (maxCols <= 0) {
    callback?.();
    return;
  }

  // Force un reflow AVANT de lire les dimensions (important pour les media queries)
  void container.offsetHeight;

  const refBox = document.querySelector(".reward-box");
  if (!refBox) {
    callback?.();
    return;
  }
  const refW = refBox.offsetWidth || 120;
  const refH = refBox.offsetHeight || 140;
  const gap = 15;
  const cellW = refW + gap;

  rows.forEach(row => {
    row.style.display = "block";
    row.style.position = "relative";
    row.style.height = refH + "px";
  });

  // Force un reflow après avoir changé les styles des rows
  void rows[0]?.offsetHeight;

  rows.forEach(row => {
    const rowWidth = row.clientWidth || row.getBoundingClientRect().width;
    const totalGridW = maxCols * cellW - gap;
    const offsetLeft = Math.max(0, (rowWidth - totalGridW) / 2);

    const boxes = Array.from(row.querySelectorAll(".reward-box"));
    boxes.forEach((box, idx) => {
      const xAttr = box.getAttribute("data-x");
      let x = parseFloat(xAttr);
      if (!isFinite(x)) x = idx;
      const centerX = offsetLeft + (x + 0.5) * cellW;
      box.style.position = "absolute";
      box.style.left = centerX + "px";
      box.style.top = "0px";
      box.style.transform = "translateX(-50%)";
    });
  });

  // Force un repaint en changeant temporairement une propriété
  container.style.transform = 'translateZ(0)';

  // Appelle le callback APRÈS que le navigateur ait appliqué les changements
  if (callback) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // Retire la transformation forcée
        container.style.transform = '';
        callback();
      });
    });
  }
}

/* === BOOT === */
init();
// Force layoutByX après init()
window.addEventListener("load", () => {
  setTimeout(() => {
    layoutByX(() => {
      drawConnections();
    });
  }, 500);
});
window.addEventListener("hashchange", () => {
  container.innerHTML = "";
  svg.innerHTML = "";
  unlocked.clear();
  planned.clear();
  keys = 0;
  activeLocks = 0;
  points = 0;
  init();
});

// 🧠 Assure un layout correct une fois tout le contenu chargé
window.addEventListener("load", () => {
  // un petit délai pour que le DOM et les images soient rendus
  setTimeout(() => {
    layoutByX(() => {
      drawConnections(); // redessine les lignes une fois bien placées
    });
  }, 300);
});

// 🧭 et si le contenu change après (ex. hashchange)
window.addEventListener("hashchange", () => {
  setTimeout(() => {
    layoutByX(() => {
      drawConnections();
    });
  }, 300);
});
