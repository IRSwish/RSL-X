// Version: 2025-01-12-018 - Don't auto-save while typing
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import { getDatabase, ref, set, onValue, update, remove } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-database.js";
import { setupAuthUI, getCurrentRoom, isViewer, exportSiegeData, importSiegeData, showChangePasswordModal, logout } from "./auth.js";

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyBiHB2MMmdv9lpYC_TIOB9Sn8xO_Xd09iU",
  authDomain: "siegeprojectrsl.firebaseapp.com",
  databaseURL: "https://siegeprojectrsl-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "siegeprojectrsl",
  storageBucket: "siegeprojectrsl.firebasestorage.app",
  messagingSenderId: "475982575288",
  appId: "1:475982575288:web:43249fa990ff6a0e4fa64d"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Room-based path helper
function getRoomPath(path) {
    const roomId = getCurrentRoom();
    if (!roomId) {
        console.error('No room selected');
        return null;
    }
    return `rooms/${roomId}/siege/${path}`;
}

// --- SQLite champions DB (sql.js global) ---
let championsDB = null;
let summarySortMode = "post"; // default
let summarySortDirection = "asc"; // asc or desc
let clanMembers = {};

let siegeDB = null;

async function loadSiegeDB() {
    try {
        const SQL = await window.initSqlJs({
            locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
        });
        const res = await fetch(`/siege/siege.db?v=${Date.now()}`);
        const buf = await res.arrayBuffer();
        siegeDB = new SQL.Database(new Uint8Array(buf));
    } catch (e) {
        console.error("Erreur chargement siege.db", e);
    }
}
loadSiegeDB();

async function loadChampionDB() {
    try {
        const SQL = await window.initSqlJs({
            locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
        });
        const res = await fetch(`/tools/champions-index/champions.db?v=${Date.now()}`);
        const buf = await res.arrayBuffer();
        championsDB = new SQL.Database(new Uint8Array(buf));
    } catch (e) {
        console.error("Erreur chargement champions.db", e);
    }
}
loadChampionDB();

function getConditionsByType() {
    if (!siegeDB) return { orderedTypes: [], byType: {} };

    try {
        const stmt = siegeDB.prepare(
            "SELECT rowid, id, type, name, image, description FROM conditions ORDER BY rowid;"
        );
        const byType = {};
        const orderedTypes = [];

        while (stmt.step()) {
            const row = stmt.getAsObject();
            const t = row.type;

            if (!byType[t]) {
                byType[t] = [];
                orderedTypes.push(t); // ordre = 1er rowid rencontré pour ce type
            }
            byType[t].push({
                rowid: row.rowid,
                id: row.id,
                type: row.type,
                name: row.name,
                image: row.image,
                description: row.description
            });
        }
        stmt.free();
        return { orderedTypes, byType };
    } catch (e) {
        console.error("Erreur getConditionsByType", e);
        return { orderedTypes: [], byType: {} };
    }
}

function getBuildingSlots(buildingType, level) {
    if (!siegeDB) return 0;

    try {
        const stmt = siegeDB.prepare(
            "SELECT slots FROM buildings WHERE name = ? AND level = ?;"
        );
        stmt.bind([buildingType, level]);

        if (stmt.step()) {
            const row = stmt.getAsObject();
            stmt.free();
            return row.slots || 0;
        }
        stmt.free();
        return 0;
    } catch (e) {
        console.error("Erreur getBuildingSlots", e);
        return 0;
    }
}

function getBuildingTrapsSlots(buildingType, level) {
    if (!siegeDB) return 0;

    try {
        const stmt = siegeDB.prepare(
            "SELECT trapsslots FROM buildings WHERE name = ? AND level = ?;"
        );
        stmt.bind([buildingType, level]);

        if (stmt.step()) {
            const row = stmt.getAsObject();
            stmt.free();
            return row.trapsslots || 0;
        }
        stmt.free();
        return 0;
    } catch (e) {
        console.error("Erreur getBuildingTrapsSlots", e);
        return 0;
    }
}

function getBuildingTypeFromPostId(postId) {
    if (postId === "stronghold") return "Stronghold";
    if (postId.includes("magictower")) return "Magic Tower";
    if (postId.includes("defensetower")) return "Defense Tower";
    if (postId.includes("manashrine")) return "Mana Shrine";
    return null;
}

function isBuildingPost(postId) {
    return getBuildingTypeFromPostId(postId) !== null;
}


function searchChampions(query) {
    if (!championsDB || !query) return [];
    try {
        const stmt = championsDB.prepare(
            "SELECT name, rarity, image, auratext, aura FROM champions WHERE name LIKE '%' || ? || '%' ORDER BY name LIMIT 20;"
        );

        const raw = [];
        stmt.bind([query]);
        while (stmt.step()) {
            raw.push(stmt.getAsObject());
        }
        stmt.free();

        // 🔥 SUPPRESSION DES DOUBLONS PAR NOM
        const unique = [];
        const seen = new Set();

        for (const ch of raw) {
            if (!seen.has(ch.name)) {
                seen.add(ch.name);
                unique.push(ch);
            }
        }

        return unique;
    } catch (e) {
        console.error("Erreur searchChampions", e);
        return [];
    }
}


function getChampionByNameExact(name) {
    if (!championsDB || !name) return null;
    try {
        const stmt = championsDB.prepare(
            "SELECT name, rarity, image, auratext, aura FROM champions WHERE name = ? LIMIT 1;"
        );
        stmt.bind([name]);
        let found = null;
        if (stmt.step()) {
            found = stmt.getAsObject();
        }
        stmt.free();
        return found;
    } catch (e) {
        console.error("Erreur getChampionByNameExact", e);
        return null;
    }
}

// Get full champion data including faction, type, affinity for condition validation
function getChampionFullData(name) {
    if (!championsDB || !name) return null;
    try {
        const stmt = championsDB.prepare(
            "SELECT name, faction, rarity, affinity, type, image, auratext, aura FROM champions WHERE name = ? LIMIT 1;"
        );
        stmt.bind([name]);
        let found = null;
        if (stmt.step()) {
            found = stmt.getAsObject();
        }
        stmt.free();
        return found;
    } catch (e) {
        console.error("Erreur getChampionFullData", e);
        return null;
    }
}

// Get ALL forms of a champion (for Mythics with multiple forms)
// Mythics have the same name but appear on multiple rows in the database
function getAllChampionForms(name) {
    if (!championsDB || !name) return [];
    try {
        const stmt = championsDB.prepare(
            "SELECT name, faction, rarity, affinity, type, image, auratext, aura FROM champions WHERE name = ?;"
        );
        stmt.bind([name]);
        const forms = [];
        while (stmt.step()) {
            forms.push(stmt.getAsObject());
        }
        stmt.free();
        return forms;
    } catch (e) {
        console.error("Erreur getAllChampionForms", e);
        return [];
    }
}

// Get champion data for condition validation, checking both forms for Mythics
function getChampionDataForCondition(name) {
    if (!name) return null;

    // Get all forms of this champion
    const allForms = getAllChampionForms(name);

    if (allForms.length === 0) return null;

    const mainData = allForms[0];

    // If it's a Mythical and has multiple forms, return both
    if (mainData.rarity === "Mythical" && allForms.length > 1) {
        return {
            main: allForms[0],
            alternate: allForms[1]
        };
    }

    // For non-Mythics or single-form champions
    return {
        main: mainData,
        alternate: null
    };
}

// Get alliance for a given faction
function getAllianceForFaction(faction) {
    if (!championsDB || !faction) return null;
    try {
        const stmt = championsDB.prepare(
            "SELECT alliance FROM alliances WHERE faction = ? LIMIT 1;"
        );
        stmt.bind([faction]);
        let result = null;
        if (stmt.step()) {
            const row = stmt.getAsObject();
            result = row.alliance;
        }
        stmt.free();
        return result;
    } catch (e) {
        console.error("Erreur getAllianceForFaction", e);
        return null;
    }
}

// Validate if a team satisfies a specific condition
function validateTeamCondition(team, conditionId) {
    if (!siegeDB || !team || !conditionId) return false;

    // team = { champion4: "name", champion3: "name", champion2: "name", lead: "name" }
    const champions = [team.champion4, team.champion3, team.champion2, team.lead].filter(c => c && c.trim());
    if (champions.length === 0) {
        return false;
    }

    try {
        // Get condition details
        const condStmt = siegeDB.prepare("SELECT type, name FROM conditions WHERE id = ? LIMIT 1;");
        condStmt.bind([conditionId]);

        if (!condStmt.step()) {
            condStmt.free();
            return false;
        }

        const condition = condStmt.getAsObject();
        condStmt.free();

        const condType = condition.type;
        const condName = condition.name;

        // Effects conditions are always true
        if (condType === 'effects' || condType === 'Effects') {
            return true;
        }

        // Get champion data for all champions in team (including both forms for Mythics)
        const champDataList = champions.map(name => getChampionDataForCondition(name)).filter(c => c !== null);

        if (champDataList.length === 0) {
            return false;
        }

        // Validate based on condition type (case-insensitive)
        const condTypeLower = condType.toLowerCase();

        // Helper function to check if a champion (checking both forms for Mythics) matches a condition
        const championMatches = (champDataObj, checkFunc) => {
            if (!champDataObj) return false;

            // Check main form
            if (checkFunc(champDataObj.main)) return true;

            // If it's a Mythic, also check alternate form
            if (champDataObj.alternate && checkFunc(champDataObj.alternate)) return true;

            return false;
        };

        switch (condTypeLower) {
            case 'rarity':
                return champDataList.every(champDataObj =>
                    championMatches(champDataObj, c => c.rarity === condName)
                );

            case 'factions':
                return champDataList.every(champDataObj =>
                    championMatches(champDataObj, c => c.faction === condName)
                );

            case 'type':
                return champDataList.every(champDataObj =>
                    championMatches(champDataObj, c => c.type === condName)
                );

            case 'affinity':
                return champDataList.every(champDataObj =>
                    championMatches(champDataObj, c => c.affinity === condName)
                );

            case 'alliance':
                return champDataList.every(champDataObj =>
                    championMatches(champDataObj, c => {
                        const alliance = getAllianceForFaction(c.faction);
                        return alliance === condName;
                    })
                );

            default:
                return false;
        }
    } catch (e) {
        console.error("Erreur validateTeamCondition", e);
        return false;
    }
}

// Get all conditions validated by a team
function getValidatedConditions(team) {
    if (!siegeDB || !team) {
        return [];
    }

    const validatedConditions = [];

    try {
        // Get all conditions
        const stmt = siegeDB.prepare("SELECT id FROM conditions ORDER BY rowid;");

        while (stmt.step()) {
            const row = stmt.getAsObject();
            const condId = row.id;

            if (validateTeamCondition(team, condId)) {
                validatedConditions.push(condId);
            }
        }

        stmt.free();
    } catch (e) {
        console.error("Erreur getValidatedConditions", e);
    }

    return validatedConditions;
}

function getConditionIcon(conditionId) {
    if (!siegeDB) return null;
    try {
        const stmt = siegeDB.prepare("SELECT image FROM conditions WHERE id = ? LIMIT 1;");
        stmt.bind([conditionId]);
        let icon = null;
        if (stmt.step()) {
            const row = stmt.getAsObject();
            icon = `/siege/img/conditions/${row.image}.webp`;
        }
        stmt.free();
        return icon;
    } catch (e) {
        console.error("Erreur getConditionIcon", e);
        return null;
    }
}

function getConditionName(conditionId) {
    if (!siegeDB) return "";
    try {
        const stmt = siegeDB.prepare("SELECT name FROM conditions WHERE id = ? LIMIT 1;");
        stmt.bind([conditionId]);
        let name = "";
        if (stmt.step()) {
            const row = stmt.getAsObject();
            name = row.name;
        }
        stmt.free();
        return name;
    } catch (e) {
        console.error("Erreur getConditionName", e);
        return "";
    }
}

function getConditionType(conditionId) {
    if (!siegeDB) return "";
    try {
        const stmt = siegeDB.prepare("SELECT type FROM conditions WHERE id = ? LIMIT 1;");
        stmt.bind([conditionId]);
        let type = "";
        if (stmt.step()) {
            const row = stmt.getAsObject();
            type = row.type;
        }
        stmt.free();
        return type;
    } catch (e) {
        console.error("Erreur getConditionType", e);
        return "";
    }
}

// --- Siege planner state ---
let currentRoomId = null;
let currentPostId = null;
let hasUnsavedChanges = false;
let initialModalState = null;
let memberSortColumn = "member"; // "member" or "teams"
let memberSortDirection = "asc"; // "asc" or "desc"
const postIds = [
    "post1", 
    "post2", 
    "post3", 
    "post4", 
    "post5", 
    "post6", 
    "post7", 
    "post8", 
    "post9", 
    "post10", 
    "post11", 
    "post12", 
    "post13", 
    "post14", 
    "post15", 
    "post16", 
    "post17", 
    "post18",
    "manashrine1",
    "manashrine2",
    "magictower1",
    "magictower2",
    "magictower3",
    "magictower4",
    "defensetower1",
    "defensetower2",
    "defensetower3",
    "defensetower4",
    "defensetower5",
    "stronghold",
];
const postDataCache = {}; // postId -> data

// Irradiance des tours de magie
const MAGIC_TOWER_IRRADIANCE = {
    "magictower1": ["post12", "post13"],
    "magictower2": ["defensetower2", "post10", "post15"],
    "magictower3": ["post15", "defensetower3", "defensetower5"],
    "magictower4": ["defensetower4", "defensetower5", "stronghold"]
};

let currentPostConditionsList = [];  // les 3 conditions choisies pour le post courant (objets complets)
let postConditionsSlotsWrapper = null;
let activeConditionSlotIndex = 0;

function updateRoomLabel(roomId) {
    const el = document.getElementById("currentRoomLabel");
    if (!el) return;
    el.textContent = roomId ? "Room : " + roomId : "No Room";
}

function setStatus(msg, isError = false) {
    const el = document.getElementById("statusMsg");
    if (!el) return;
    el.textContent = msg || "";
    el.style.color = isError ? "#ff9494" : "#a0ffa0";
}

function randomRoomId() {
    return "room-" + Math.random().toString(36).substring(2, 8);
}

function connectRoom(roomId) {
    currentRoomId = roomId;
    updateRoomLabel(roomId);
    setStatus("Connected to room " + roomId);

    // Use new room-based path structure: rooms/{roomId}/siege/
    const mref = ref(db, `rooms/${roomId}/siege/members`);
    onValue(mref, snap => {
        clanMembers = snap.val() || {};
        updateMembersList();
        updateMemberFilter();
        updateConditionsFilter();
    });

    postIds.forEach(id => {
        const r = ref(db, `rooms/${roomId}/siege/${id}`);
        onValue(r, snap => {
            const data = snap.val() || {};
            postDataCache[id] = data;

            if (currentPostId === id) {
                fillModalFromData(data);
            }

            updateSummaryTable();
            updatePostConditionsOnMap(id);  // Mettre à jour les icônes sur la carte
            updateTeamsCountOnMap(id);  // Mettre à jour le compteur d'équipes
            updateTooltipOnMap(id);  // Mettre à jour le tooltip hover
            updateMembersList();  // Mettre à jour le compteur de teams par membre
            updateConditionsFilter();  // Mettre à jour le filtre des conditions
            updateStats();  // Mettre à jour les statistiques
        });
    });
    updateSummaryTable();

    const url = new URL(window.location.href);
    url.searchParams.set("room", roomId);
    window.history.replaceState({}, "", url.toString());
}

function updateMemberFilter() {
    const memberFilter = document.getElementById("memberFilter");
    if (!memberFilter) return;

    const currentValue = memberFilter.dataset.value || "";

    // Build custom select options
    const optionsContainer = memberFilter.querySelector(".custom-select-options");
    if (!optionsContainer) return;

    optionsContainer.innerHTML = '';

    // Add "All" option
    const allOption = document.createElement("div");
    allOption.className = "custom-select-option";
    allOption.dataset.value = "";
    allOption.textContent = "All";
    if (currentValue === "") {
        allOption.classList.add("selected");
    }
    optionsContainer.appendChild(allOption);

    // Add "Empty Posts" option
    const emptyOption = document.createElement("div");
    emptyOption.className = "custom-select-option";
    emptyOption.dataset.value = "__EMPTY__";
    emptyOption.textContent = "Empty Posts";
    if (currentValue === "__EMPTY__") {
        emptyOption.classList.add("selected");
    }
    optionsContainer.appendChild(emptyOption);

    // Add member options
    Object.keys(clanMembers).sort().forEach(name => {
        const option = document.createElement("div");
        option.className = "custom-select-option";
        option.dataset.value = name;
        option.textContent = name;
        if (currentValue === name) {
            option.classList.add("selected");
        }
        optionsContainer.appendChild(option);
    });

    // Update trigger display
    updateMemberFilterDisplay();
}

function updateMemberFilterDisplay() {
    const memberFilter = document.getElementById("memberFilter");
    if (!memberFilter) return;

    const trigger = memberFilter.querySelector(".custom-select-trigger");
    const selectedValue = memberFilter.dataset.value || "";

    if (selectedValue === "") {
        trigger.querySelector("span").textContent = "All";
    } else if (selectedValue === "__EMPTY__") {
        trigger.querySelector("span").textContent = "Empty Posts";
    } else {
        trigger.querySelector("span").textContent = selectedValue;
    }
}

function applyFilters() {
    const memberFilter = document.getElementById("memberFilter");
    const conditionFilter = document.getElementById("conditionFilter");

    const selectedMember = memberFilter ? (memberFilter.dataset.value || "") : "";
    const selectedCondition = conditionFilter ? (conditionFilter.dataset.value || "") : "";

    postIds.forEach(postId => {
        const postEl = document.getElementById(postId);
        if (!postEl) return;

        const postType = postEl.getAttribute("data-type");
        const data = postDataCache[postId] || {};
        const teams = data.teams || [];

        let showPost = true;

        // Filter by member
        if (selectedMember !== "") {
            if (selectedMember === "__EMPTY__") {
                // Show only empty posts (no teams with members assigned)
                const hasAnyMember = teams.some(team => team.member);
                if (hasAnyMember) {
                    showPost = false;
                }
            } else {
                // For buildings, just check if member is present
                // For regular posts, check if member has at least one ACCEPTED team (selected === true)
                if (postType !== "post") {
                    // Building: just check if member exists
                    const hasMember = teams.some(team => team.member === selectedMember);
                    if (!hasMember) {
                        showPost = false;
                    }
                } else {
                    // Regular post: check if member has at least one ACCEPTED team (selected === true)
                    const hasAcceptedTeam = teams.some(team => {
                        return team.member === selectedMember && team.selected === true;
                    });
                    if (!hasAcceptedTeam) {
                        showPost = false;
                    }
                }
            }
        }

        // Filter by condition (only for regular posts - check META conditions)
        if (selectedCondition !== "") {
            // Hide all buildings when filtering by condition
            if (postType !== "post") {
                showPost = false;
            } else {
                const conditionsArr = Array.isArray(data.conditions) ? data.conditions : [];
                const hasCondition = conditionsArr.some(condId => String(condId) === String(selectedCondition));
                if (!hasCondition) {
                    showPost = false;
                }
            }
        }

        postEl.style.display = showPost ? "" : "none";

        // Show/hide persistent tooltips based on member filter
        if (showPost && selectedMember !== "" && selectedMember !== "__EMPTY__") {
            // Show persistent tooltip for this post
            showPersistentTooltip(postEl, postId);
        } else {
            // Hide persistent tooltip
            hidePersistentTooltip(postEl, postId);
        }
    });
}

function showPersistentTooltip(postEl, postId) {
    // Get filtered member
    const memberFilter = document.getElementById("memberFilter");
    const selectedMember = memberFilter ? (memberFilter.dataset.value || "") : "";

    // Create a persistent tooltip element for this post
    let tooltip = postEl.querySelector('.persistent-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.className = 'persistent-tooltip post-tooltip';
        postEl.appendChild(tooltip);
    }

    // Create tooltip content showing ONLY the filtered member's team
    const content = createFilteredTooltipContent(postId, selectedMember);
    if (content) {
        tooltip.innerHTML = '';
        tooltip.appendChild(content);
        tooltip.style.opacity = '1';
    }

    // Update hover behavior to toggle between filtered and all teams
    postEl.removeEventListener("mouseenter", postEl._tooltipMouseEnter);
    postEl.removeEventListener("mouseleave", postEl._tooltipMouseLeave);

    postEl._tooltipMouseEnter = () => {
        // Hide ALL persistent tooltips
        document.querySelectorAll('.persistent-tooltip').forEach(t => {
            t.style.opacity = '0';
        });
        // Show global tooltip with all teams
        showTooltip(postEl, postId);
    };

    postEl._tooltipMouseLeave = () => {
        // Hide global tooltip
        hideTooltip();
        // Show ALL persistent tooltips again
        document.querySelectorAll('.persistent-tooltip').forEach(t => {
            t.style.opacity = '1';
        });
    };

    postEl.addEventListener("mouseenter", postEl._tooltipMouseEnter);
    postEl.addEventListener("mouseleave", postEl._tooltipMouseLeave);
}

function createFilteredTooltipContent(postId, selectedMember) {
    const data = postDataCache[postId] || {};
    const teams = Array.isArray(data.teams) ? data.teams : [];

    // Filter teams to show ONLY the selected member's team
    const memberTeams = teams.filter(team => team.member === selectedMember);

    if (memberTeams.length === 0) return null;

    const content = document.createElement("div");

    // Title
    const title = document.createElement("div");
    title.className = "post-tooltip-title";
    title.textContent = getPostLabel(postId);
    content.appendChild(title);

    // Show only the member's teams
    memberTeams.forEach((team) => {
        const teamDiv = document.createElement("div");
        teamDiv.className = "post-tooltip-team";
        teamDiv.style.background = "rgba(212, 175, 55, 0.15)";
        teamDiv.style.borderRadius = "6px";

        // Pseudo
        const memberSpan = document.createElement("span");
        memberSpan.className = "post-tooltip-member";
        memberSpan.textContent = team.member;
        teamDiv.appendChild(memberSpan);

        // Condition icon (only for regular posts)
        const postEl = document.getElementById(postId);
        const postType = postEl ? postEl.dataset.type : "post";

        if (postType === "post" && team.condition) {
            const condIcon = getConditionIcon(team.condition);
            if (condIcon) {
                const img = document.createElement("img");
                img.src = condIcon;
                img.className = "post-tooltip-cond-icon";
                img.title = getConditionName(team.condition);
                teamDiv.appendChild(img);
            }
        }

        // Champions (images)
        const champsDiv = document.createElement("div");
        champsDiv.className = "post-tooltip-champs";

        for (let i = 1; i <= 4; i++) {
            const champName = team["c" + i];

            if (champName && championsDB) {
                const champ = getChampionByNameExact(champName);

                if (champ && champ.image) {
                    const champImg = document.createElement("img");
                    champImg.className = "post-tooltip-champ-img";
                    champImg.src = `/tools/champions-index/img/champions/${champ.image}.webp`;
                    champImg.title = champName;
                    champsDiv.appendChild(champImg);
                }
            }
        }

        teamDiv.appendChild(champsDiv);
        content.appendChild(teamDiv);
    });

    return content;
}

function hidePersistentTooltip(postEl, postId) {
    const tooltip = postEl.querySelector('.persistent-tooltip');
    if (tooltip) {
        tooltip.remove();
    }

    // Restore normal hover tooltip behavior
    updateTooltipOnMap(postId);
}

function updateConditionsFilter() {
    // Don't load conditions filter in viewer mode
    if (isViewer()) {
        return;
    }

    const conditionFilter = document.getElementById("conditionFilter");
    if (!conditionFilter) return;

    const currentValue = conditionFilter.dataset.value || "";

    // Collect all unique conditions from regular posts (META conditions)
    const conditionsSet = new Set();
    postIds.forEach(postId => {
        const postEl = document.getElementById(postId);
        if (!postEl) return;

        const postType = postEl.getAttribute("data-type");
        if (postType !== "post") return; // Only regular posts

        const data = postDataCache[postId] || {};
        const conditionsArr = Array.isArray(data.conditions) ? data.conditions : [];

        conditionsArr.forEach(condId => {
            if (condId && condId !== "") {
                conditionsSet.add(String(condId));
            }
        });
    });

    // Sort conditions by ID
    const conditionIds = Array.from(conditionsSet).sort((a, b) => parseInt(a) - parseInt(b));

    // Build custom select options
    const optionsContainer = conditionFilter.querySelector(".custom-select-options");
    if (!optionsContainer) return;

    optionsContainer.innerHTML = '';

    // Add "All" option
    const allOption = document.createElement("div");
    allOption.className = "custom-select-option";
    allOption.dataset.value = "";
    allOption.textContent = "All";
    if (currentValue === "") {
        allOption.classList.add("selected");
    }
    optionsContainer.appendChild(allOption);

    // Add condition options with icons
    conditionIds.forEach(condId => {
        const icon = getConditionIcon(condId);
        const name = getConditionName(condId);
        const option = document.createElement("div");
        option.className = "custom-select-option";
        option.dataset.value = condId;
        option.dataset.icon = icon || '';
        option.textContent = name;
        if (icon) {
            option.style.setProperty('--icon-url', `url('${icon}')`);
        }
        if (currentValue === condId) {
            option.classList.add("selected");
        }
        optionsContainer.appendChild(option);
    });

    // Update trigger display
    updateConditionFilterDisplay();
}

function updateConditionFilterDisplay() {
    const conditionFilter = document.getElementById("conditionFilter");
    if (!conditionFilter) return;

    const trigger = conditionFilter.querySelector(".custom-select-trigger");
    const selectedValue = conditionFilter.dataset.value || "";

    if (selectedValue === "") {
        trigger.querySelector("span").textContent = "All";
        trigger.style.removeProperty('--icon-url');
    } else {
        const name = getConditionName(selectedValue);
        const icon = getConditionIcon(selectedValue);
        trigger.querySelector("span").textContent = name;
        if (icon) {
            trigger.style.setProperty('--icon-url', `url('${icon}')`);
        }
    }
}

function updateStats() {
    // Don't load stats in viewer mode
    if (isViewer()) {
        return;
    }

    let totalTeamsPlaced = 0;
    let totalTeamsMax = 0;
    let bonusesValidated = 0;
    let trapsUsed = 0;
    let trapsMax = 0;

    postIds.forEach(postId => {
        const postEl = document.getElementById(postId);
        if (!postEl) return;

        const postType = postEl.getAttribute("data-type");
        const data = postDataCache[postId] || {};
        const teams = data.teams || [];

        if (postType === "post") {
            // Regular posts: only 1 slot
            const maxTeams = 1;
            totalTeamsMax += maxTeams;

            // Count teams that have at least member OR champions (up to max)
            let placedCount = 0;
            teams.forEach((team, index) => {
                if (index < maxTeams && (team.member || team.c1 || team.c2 || team.c3 || team.c4)) {
                    placedCount++;
                }
            });
            totalTeamsPlaced += placedCount;

            // Count bonuses: teams with member selected + condition checked
            teams.forEach(team => {
                if (team.member && team.condition) {
                    bonusesValidated++;
                }
            });
        } else {
            // Buildings: manashrine, magictower, defensetower, stronghold
            // Get max slots from database
            const level = data.buildingLevel || 1;
            const buildingType = getBuildingTypeFromPostId(postId);
            const maxSlots = getBuildingSlots(buildingType, level);
            totalTeamsMax += maxSlots;

            // Count teams that have at least member OR champions (up to max)
            let placedCount = 0;
            teams.forEach((team, index) => {
                if (index < maxSlots && (team.member || team.c1 || team.c2 || team.c3 || team.c4)) {
                    placedCount++;
                }
            });
            totalTeamsPlaced += placedCount;

            // Count bonuses based on building type (not radiation)
            if (postType === "magictower" || postType === "stronghold" || postType === "defensetower") {
                // Magic towers, stronghold, and defense towers: count if they have a bonus selected (stored in data.condition)
                if (data.condition) {
                    bonusesValidated++;
                }
            }
            // Note: manashrine doesn't count for bonuses

            // Count traps for stronghold
            if (postId === "stronghold") {
                // For stronghold, get the level from buildingLevel (which is the actual level 1-6)
                const strongholdLevel = data.buildingLevel || 1;
                const buildingType = "Stronghold";
                trapsMax = getBuildingTrapsSlots(buildingType, strongholdLevel);
                // TODO: count actual traps when implemented
                trapsUsed = 0;
            }
        }
    });

    // Update display
    document.getElementById("statTeams").textContent = `${totalTeamsPlaced}/${totalTeamsMax}`;
    document.getElementById("statBonuses").textContent = `${bonusesValidated}/28`;
    document.getElementById("statTraps").textContent = `${trapsUsed}/${trapsMax}`;
}

function updateMembersList() {
    // Don't load members list in viewer mode
    if (isViewer()) {
        return;
    }

    const tbody = document.getElementById("membersTableBody");
    tbody.innerHTML = "";

    // Count teams per member (all posts including towers/shrines/stronghold)
    const teamCounts = {};
    Object.keys(postDataCache).forEach(postId => {
        const postData = postDataCache[postId];
        if (postData && Array.isArray(postData.teams)) {
            postData.teams.forEach(team => {
                if (team.member) {
                    teamCounts[team.member] = (teamCounts[team.member] || 0) + 1;
                }
            });
        }
    });

    // Sort members based on current sort settings
    const membersArray = Object.values(clanMembers);
    membersArray.sort((a, b) => {
        let compareResult;

        if (memberSortColumn === "teams") {
            const countA = teamCounts[a.pseudo] || 0;
            const countB = teamCounts[b.pseudo] || 0;
            compareResult = countA - countB;
        } else {
            // Sort by member name
            compareResult = a.pseudo.localeCompare(b.pseudo);
        }

        return memberSortDirection === "asc" ? compareResult : -compareResult;
    });

    membersArray.forEach(member => {
            const tr = document.createElement("tr");

            // Member name
            const memberTd = document.createElement("td");
            memberTd.textContent = member.pseudo;
            memberTd.style.fontWeight = "600";
            memberTd.style.cursor = "pointer";
            memberTd.title = "Click to filter map by this member";

            // Click event to filter by this member
            memberTd.addEventListener("click", () => {
                const memberFilter = document.getElementById("memberFilter");
                if (!memberFilter) return;

                // Set the filter value
                memberFilter.dataset.value = member.pseudo;

                // Update the selected option
                const optionsContainer = memberFilter.querySelector(".custom-select-options");
                if (optionsContainer) {
                    optionsContainer.querySelectorAll(".custom-select-option").forEach(opt => {
                        opt.classList.remove("selected");
                        if (opt.dataset.value === member.pseudo) {
                            opt.classList.add("selected");
                        }
                    });
                }

                // Update display
                updateMemberFilterDisplay();

                // Apply filters
                applyFilters();

                // Open filters if they are closed
                const filtersContent = document.getElementById("filtersContent");
                const filtersToggleBtn = document.getElementById("filtersToggleBtn");
                if (filtersContent && !filtersContent.classList.contains("open")) {
                    filtersContent.classList.add("open");
                    if (filtersToggleBtn) {
                        filtersToggleBtn.classList.add("active");
                    }
                }

                // Smooth scroll to top with animation
                smoothScrollToTop();
            });

            tr.appendChild(memberTd);

            // HellHades Link
            const linkTd = document.createElement("td");
            if (member.link) {
                const link = document.createElement("a");
                link.href = "#";
                link.className = "member-hh-link";
                link.innerHTML = `<img src="/siege/img/HH.ico" alt="HH" /> View Profile`;

                link.addEventListener("click", (e) => {
                    e.preventDefault();
                    toggleMemberProfile(tr, member.link, member.pseudo);
                });

                linkTd.appendChild(link);
            } else {
                linkTd.textContent = "-";
                linkTd.style.color = "#555";
            }
            tr.appendChild(linkTd);

            // Teams count
            const teamsTd = document.createElement("td");
            const count = teamCounts[member.pseudo] || 0;
            teamsTd.innerHTML = `<span class="member-team-count">${count}</span>`;
            tr.appendChild(teamsTd);

            // Team Presets
            const presetsTd = document.createElement("td");
            presetsTd.className = "member-presets-cell";
            const presetsCount = (member.presets && Object.keys(member.presets).length) || 0;
            const presetsCountSpan = document.createElement("div");
            presetsCountSpan.className = "member-presets-count";
            presetsCountSpan.innerHTML = `
                <span class="member-presets-number">${presetsCount}</span>
                <button class="view-presets-btn" title="Edit Presets">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                        <path d="m15 5 4 4"/>
                    </svg>
                </button>
            `;
            const viewBtn = presetsCountSpan.querySelector(".view-presets-btn");
            viewBtn.addEventListener("click", () => openPresetsModal(member.pseudo));
            presetsTd.appendChild(presetsCountSpan);
            tr.appendChild(presetsTd);

            // Manage buttons
            const manageTd = document.createElement("td");
            const manageDiv = document.createElement("div");
            manageDiv.className = "member-manage-btns";

            // Edit button
            const editBtn = document.createElement("button");
            editBtn.className = "member-edit-btn";
            editBtn.title = "Change Info";
            editBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="18" cy="15" r="3"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M10 15H6a4 4 0 0 0-4 4v2"/>
                    <path d="m21.7 16.4-.9-.3"/>
                    <path d="m15.2 13.9-.9-.3"/>
                    <path d="m16.6 18.7.3-.9"/>
                    <path d="m19.1 12.2.3-.9"/>
                    <path d="m19.6 18.7-.4-1"/>
                    <path d="m16.8 12.3-.4-1"/>
                    <path d="m14.3 16.6 1-.4"/>
                    <path d="m20.7 13.8 1-.4"/>
                </svg>
            `;
            editBtn.addEventListener("click", () => editMember(member.pseudo, member.link));

            // Delete button
            const deleteBtn = document.createElement("button");
            deleteBtn.className = "member-delete-btn";
            deleteBtn.title = "Delete Member";
            deleteBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <line x1="17" x2="22" y1="8" y2="13"/>
                    <line x1="22" x2="17" y1="8" y2="13"/>
                </svg>
            `;
            deleteBtn.addEventListener("click", () => deleteClanMember(member.pseudo));

            manageDiv.appendChild(editBtn);
            manageDiv.appendChild(deleteBtn);
            manageTd.appendChild(manageDiv);
            tr.appendChild(manageTd);

            tbody.appendChild(tr);
        });

    // Update member count
    const membersCount = Object.keys(clanMembers).length;
    const titleEl = document.getElementById("membersTitle");
    if (titleEl) titleEl.textContent = `Clan Members (${membersCount})`;

    // Update active header and direction arrow
    document.querySelectorAll("#membersTable th.sortable").forEach(th => {
        if (th.dataset.sort === memberSortColumn) {
            th.classList.add("active");
            th.classList.toggle("desc", memberSortDirection === "desc");
        } else {
            th.classList.remove("active", "desc");
        }
    });

    // Refresh Teams Presets Dropdown if it's open
    const dropdown = document.getElementById("teamsPresetsDropdown");
    if (dropdown && dropdown.classList.contains("open")) {
        refreshTeamsPresetsDropdown();
    }
}

function toggleMemberProfile(tr, profileUrl, memberPseudo) {
    // Check if profile row already exists
    const existingProfileRow = tr.nextElementSibling;
    if (existingProfileRow && existingProfileRow.classList.contains("member-profile-row")) {
        // Remove existing profile row
        existingProfileRow.remove();
        tr.classList.remove("profile-open");
        return;
    }

    // Close any other open profile
    document.querySelectorAll(".member-profile-row").forEach(row => row.remove());
    document.querySelectorAll("tr.profile-open").forEach(row => row.classList.remove("profile-open"));

    // Create new profile row
    const profileRow = document.createElement("tr");
    profileRow.className = "member-profile-row";

    const profileCell = document.createElement("td");
    profileCell.colSpan = 5; // Span across all columns

    const profileContainer = document.createElement("div");
    profileContainer.className = "member-profile-container";

    const iframe = document.createElement("iframe");
    iframe.src = profileUrl;
    iframe.className = "member-profile-iframe";
    iframe.setAttribute("loading", "lazy");

    profileContainer.appendChild(iframe);
    profileCell.appendChild(profileContainer);
    profileRow.appendChild(profileCell);

    // Insert after current row
    tr.after(profileRow);
    tr.classList.add("profile-open");

    // Scroll to position the row at the top of the screen
    setTimeout(() => {
        tr.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
}

function editMember(pseudo, currentLink) {
    if (isViewer()) {
        alert("Cannot edit in viewer mode.");
        return;
    }

    const newPseudo = prompt("Edit member name:", pseudo);
    if (!newPseudo || newPseudo === pseudo) {
        // If cancelled or same name, just edit the link
        const newLink = prompt("Edit HellHades link (leave empty to remove):", currentLink || "");
        if (newLink !== null) {
            clanMembers[pseudo].link = newLink.trim();
            const refMembers = ref(db, `rooms/${currentRoomId}/siege/members`);
            set(refMembers, clanMembers);
        }
        return;
    }

    // Check if new name already exists
    if (clanMembers[newPseudo]) {
        alert("A member with this name already exists.");
        return;
    }

    // Edit link too
    const newLink = prompt("Edit HellHades link (leave empty to remove):", currentLink || "");

    // Update member
    const member = { ...clanMembers[pseudo] };
    member.pseudo = newPseudo;
    if (newLink !== null) {
        member.link = newLink.trim();
    }

    delete clanMembers[pseudo];
    clanMembers[newPseudo] = member;

    // Update all teams with this member
    Object.keys(postDataCache).forEach(postId => {
        const postData = postDataCache[postId];
        if (postData && Array.isArray(postData.teams)) {
            postData.teams.forEach(team => {
                if (team.member === pseudo) {
                    team.member = newPseudo;
                }
            });
        }
    });

    // Save to Firebase
    const refMembers = ref(db, `rooms/${currentRoomId}/siege/members`);
    set(refMembers, clanMembers);

    // Save all posts with updated member names
    Object.keys(postDataCache).forEach(postId => {
        const postRef = ref(db, `rooms/${currentRoomId}/siege/${postId}`);
        set(postRef, postDataCache[postId]);
    });
}

function deleteClanMember(pseudo) {
    if (isViewer()) {
        alert("Cannot delete in viewer mode.");
        return;
    }

    // Double validation
    const firstConfirm = confirm(`Are you sure you want to delete member "${pseudo}"?`);
    if (!firstConfirm) return;

    const secondConfirm = confirm(`⚠️ FINAL WARNING ⚠️\n\nThis will permanently delete "${pseudo}" and remove all their teams from all posts.\n\nThis action CANNOT be undone!\n\nClick OK to confirm deletion.`);
    if (!secondConfirm) return;

    // Delete the member
    delete clanMembers[pseudo];

    // Remove all teams belonging to this member from all posts
    Object.keys(postDataCache).forEach(postId => {
        const postData = postDataCache[postId];
        if (postData && Array.isArray(postData.teams)) {
            // Filter out teams belonging to the deleted member
            const updatedTeams = postData.teams.filter(team => team.member !== pseudo);

            // Update the post data
            postDataCache[postId].teams = updatedTeams;

            // Save to Firebase
            const postRef = ref(db, `rooms/${currentRoomId}/siege/${postId}`);
            set(postRef, postDataCache[postId]);
        }
    });

    // Save updated members to Firebase
    const refMembers = ref(db, `rooms/${currentRoomId}/siege/members`);
    set(refMembers, clanMembers);
}

// Find if a preset is already used in a post (returns formatted name only)
function findPresetUsage(memberPseudo, preset) {
    const result = findPresetUsageDetailed(memberPseudo, preset);
    return result ? result.formattedName : null;
}

// Find if a preset is already used in a post (returns detailed info)
function findPresetUsageDetailed(memberPseudo, preset) {
    // Extract champion names from preset
    const presetChamps = [
        preset.champion4,
        preset.champion3,
        preset.champion2,
        preset.lead
    ].filter(c => c && c.trim() !== "").sort();

    if (presetChamps.length === 0) {
        return null;
    }

    // Check all posts
    for (const postId in postDataCache) {
        const postData = postDataCache[postId];
        if (!postData || !postData.teams) continue;

        // Check each team in the post
        for (const team of postData.teams) {
            if (team.member !== memberPseudo) continue;

            // Extract champion names from team (using c1, c2, c3, c4)
            const teamChamps = [
                team.c4,
                team.c3,
                team.c2,
                team.c1
            ].filter(c => c && c.trim() !== "").sort();

            // Compare sorted arrays
            if (teamChamps.length === presetChamps.length &&
                teamChamps.every((champ, i) => champ === presetChamps[i])) {
                // Found a match! Return detailed info
                const postEl = document.getElementById(postId);
                const postType = postEl ? postEl.dataset.type : "post";
                return {
                    postId: postId,
                    postType: postType,
                    formattedName: formatPostName(postId)
                };
            }
        }
    }

    return null;
}

// Format post ID to display name
function formatPostName(postId) {
    if (postId.startsWith("post")) {
        return postId.replace("post", "Post ");
    }
    if (postId.startsWith("defensetower")) {
        return postId.replace("defensetower", "Defense ");
    }
    if (postId.startsWith("magictower")) {
        return postId.replace("magictower", "Magic ");
    }
    if (postId.startsWith("manashrine")) {
        return postId.replace("manashrine", "Shrine ");
    }
    if (postId === "stronghold") {
        return "Stronghold";
    }
    return postId;
}

// Refresh Teams Presets Dropdown
function refreshTeamsPresetsDropdown() {
    const dropdown = document.getElementById("teamsPresetsDropdown");
    if (!dropdown) return;

    dropdown.innerHTML = "";

    // Add header
    const header = document.createElement("div");
    header.className = "preset-dropdown-header";
    header.textContent = "All Team Presets";
    dropdown.appendChild(header);

    // Collect all members with presets
    const membersWithPresets = Object.keys(clanMembers).filter(pseudo => {
        const member = clanMembers[pseudo];
        return member.presets && Object.keys(member.presets).length > 0;
    });

    if (membersWithPresets.length === 0) {
        const noPresets = document.createElement("div");
        noPresets.className = "preset-dropdown-no-presets";
        noPresets.textContent = "No team presets found. Add presets in the Clan Members section.";
        dropdown.appendChild(noPresets);
        return;
    }

    // Collect all unique conditions from presets
    const allConditionsSet = new Set();
    membersWithPresets.forEach(pseudo => {
        const member = clanMembers[pseudo];
        const presets = member.presets || {};
        Object.values(presets).forEach(preset => {
            // Use cached conditions if available, otherwise calculate and cache
            let validatedConditions = preset.cachedConditions;
            if (!validatedConditions || !Array.isArray(validatedConditions)) {
                validatedConditions = getValidatedConditions(preset);
                preset.cachedConditions = validatedConditions;
            }
            validatedConditions.forEach(condId => {
                const condType = getConditionType(condId);
                if (condType !== 'effects' && condType !== 'Effects') {
                    allConditionsSet.add(String(condId));
                }
            });
        });
    });

    // Add member filter
    const memberFilterDiv = document.createElement("div");
    memberFilterDiv.className = "preset-member-filter";

    const memberFilterLabel = document.createElement("label");
    memberFilterLabel.textContent = "Member:";
    memberFilterLabel.style.fontSize = "12px";
    memberFilterLabel.style.color = "#d4af37";
    memberFilterLabel.style.fontWeight = "600";
    memberFilterLabel.style.textTransform = "uppercase";
    memberFilterLabel.style.letterSpacing = "0.05em";
    memberFilterDiv.appendChild(memberFilterLabel);

    const memberSelectWrapper = document.createElement("div");
    memberSelectWrapper.className = "custom-select-wrapper";

    const memberSelect = document.createElement("div");
    memberSelect.id = "presetMemberFilter";
    memberSelect.className = "custom-select custom-select-no-icon";
    memberSelect.dataset.value = "";

    const memberTrigger = document.createElement("div");
    memberTrigger.className = "custom-select-trigger";

    const memberTriggerSpan = document.createElement("span");
    memberTriggerSpan.textContent = "All";
    memberTrigger.appendChild(memberTriggerSpan);

    const memberChevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    memberChevron.classList.add("chevron-icon");
    memberChevron.setAttribute("width", "14");
    memberChevron.setAttribute("height", "14");
    memberChevron.setAttribute("viewBox", "0 0 24 24");
    memberChevron.setAttribute("fill", "none");
    memberChevron.setAttribute("stroke", "currentColor");
    memberChevron.setAttribute("stroke-width", "2");
    memberChevron.setAttribute("stroke-linecap", "round");
    memberChevron.setAttribute("stroke-linejoin", "round");
    const memberPolyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    memberPolyline.setAttribute("points", "6 9 12 15 18 9");
    memberChevron.appendChild(memberPolyline);
    memberTrigger.appendChild(memberChevron);

    memberSelect.appendChild(memberTrigger);

    const memberOptions = document.createElement("div");
    memberOptions.className = "custom-select-options";

    // Add "All" option
    const allOption = document.createElement("div");
    allOption.className = "custom-select-option selected";
    allOption.dataset.value = "";
    allOption.textContent = "All";
    memberOptions.appendChild(allOption);

    // Add member options
    membersWithPresets.forEach(pseudo => {
        const option = document.createElement("div");
        option.className = "custom-select-option";
        option.dataset.value = pseudo;
        option.textContent = pseudo;
        memberOptions.appendChild(option);
    });

    memberSelect.appendChild(memberOptions);
    memberSelectWrapper.appendChild(memberSelect);
    memberFilterDiv.appendChild(memberSelectWrapper);
    dropdown.appendChild(memberFilterDiv);

    // Add event listeners for member filter
    memberTrigger.addEventListener("click", (e) => {
        e.stopPropagation();
        memberSelect.classList.toggle("open");
    });

    memberOptions.addEventListener("click", (e) => {
        const option = e.target.closest(".custom-select-option");
        if (!option) return;

        const value = option.dataset.value;
        memberSelect.dataset.value = value;

        // Update display
        memberTriggerSpan.textContent = value === "" ? "All" : value;

        // Update selected class
        memberOptions.querySelectorAll(".custom-select-option").forEach(opt => {
            opt.classList.remove("selected");
        });
        option.classList.add("selected");

        // Close dropdown
        memberSelect.classList.remove("open");

        // Filter presets by member
        filterPresetsByMember(value);
    });

    // Close member filter when clicking outside
    document.addEventListener("click", (e) => {
        if (!memberSelect.contains(e.target)) {
            memberSelect.classList.remove("open");
        }
    });

    // Add condition filter if there are conditions
    if (allConditionsSet.size > 0) {
        const filterDiv = document.createElement("div");
        filterDiv.className = "preset-condition-filter";

        const filterLabel = document.createElement("div");
        filterLabel.className = "preset-condition-filter-label";
        filterLabel.textContent = "Filter by Condition:";
        filterDiv.appendChild(filterLabel);

        const filterOptions = document.createElement("div");
        filterOptions.className = "preset-condition-filter-options";

        // Add condition options sorted by ID (no "All" option)
        const conditionIds = Array.from(allConditionsSet).sort((a, b) => parseInt(a) - parseInt(b));
        conditionIds.forEach(condId => {
            const condIcon = getConditionIcon(condId);
            const condName = getConditionName(condId);

            const option = document.createElement("div");
            option.className = "preset-condition-filter-option";
            option.dataset.conditionId = condId;
            option.title = condName; // Add tooltip

            if (condIcon) {
                const img = document.createElement("img");
                img.src = condIcon;
                img.alt = condName;
                option.appendChild(img);
            }

            const text = document.createElement("span");
            text.textContent = condName;
            option.appendChild(text);

            option.addEventListener("click", () => {
                // Toggle behavior: if already active, deactivate it
                if (option.classList.contains("active")) {
                    option.classList.remove("active");
                    filterPresetsByCondition(""); // Show all
                } else {
                    // Deactivate all others and activate this one
                    filterOptions.querySelectorAll(".preset-condition-filter-option").forEach(opt => {
                        opt.classList.remove("active");
                    });
                    option.classList.add("active");
                    filterPresetsByCondition(condId);
                }
            });

            filterOptions.appendChild(option);
        });

        filterDiv.appendChild(filterOptions);
        dropdown.appendChild(filterDiv);
    }

    // Display each member's presets
    membersWithPresets.forEach(pseudo => {
        const member = clanMembers[pseudo];
        const presets = member.presets || {};
        const presetIds = Object.keys(presets);

        const memberDiv = document.createElement("div");
        memberDiv.className = "preset-dropdown-member";

        // Member name
        const memberName = document.createElement("div");
        memberName.className = "preset-dropdown-member-name";
        memberName.textContent = pseudo;
        memberDiv.appendChild(memberName);

        // Teams container
        const teamsContainer = document.createElement("div");
        teamsContainer.className = "preset-dropdown-teams";

        presetIds.forEach((presetId, index) => {
            const preset = presets[presetId];
            const teamDiv = document.createElement("div");
            teamDiv.className = "preset-dropdown-team";

            // Make preset draggable
            teamDiv.draggable = true;
            teamDiv.dataset.memberPseudo = pseudo;
            teamDiv.dataset.presetData = JSON.stringify(preset);

            // Team label
            const teamLabel = document.createElement("div");
            teamLabel.className = "preset-dropdown-team-label";
            teamLabel.textContent = `Team ${index + 1}`;
            teamDiv.appendChild(teamLabel);

            // Champions
            const champsDiv = document.createElement("div");
            champsDiv.className = "preset-dropdown-team-champs";

            ["champion4", "champion3", "champion2", "lead"].forEach(slot => {
                const champName = preset[slot] || "";
                if (champName) {
                    const champData = getChampionFullData(champName);
                    if (champData) {
                        const img = document.createElement("img");
                        img.src = `/tools/champions-index/img/champions/${champData.image}.webp`;
                        img.className = "preset-dropdown-champ-img";
                        img.title = champName;
                        champsDiv.appendChild(img);
                    } else {
                        const emptyDiv = document.createElement("div");
                        emptyDiv.className = "preset-dropdown-champ-empty";
                        champsDiv.appendChild(emptyDiv);
                    }
                } else {
                    const emptyDiv = document.createElement("div");
                    emptyDiv.className = "preset-dropdown-champ-empty";
                    champsDiv.appendChild(emptyDiv);
                }
            });

            teamDiv.appendChild(champsDiv);

            // Container for post usage and conditions (vertical layout)
            const infoContainer = document.createElement("div");
            infoContainer.className = "preset-dropdown-info";

            // Check if this preset is already used in a post
            const usageDetails = findPresetUsageDetailed(pseudo, preset);
            if (usageDetails) {
                const { postType, formattedName } = usageDetails;
                const usageIndicator = document.createElement("div");
                usageIndicator.className = "preset-usage-indicator";
                usageIndicator.classList.add(`indicator-${postType}`);
                usageIndicator.textContent = formattedName;
                usageIndicator.title = `Already used in ${formattedName}`;
                infoContainer.appendChild(usageIndicator);
                teamDiv.classList.add("preset-used");
                teamDiv.classList.add(`preset-used-${postType}`);
            }

            // Conditions (validated only, no effects)
            // Use cached conditions if available, otherwise calculate and cache
            let validatedConditions = preset.cachedConditions;
            if (!validatedConditions || !Array.isArray(validatedConditions)) {
                validatedConditions = getValidatedConditions(preset);
                preset.cachedConditions = validatedConditions;
            }
            // Filter out effects (Irradiance and Stronghold bonus)
            const nonEffectConditions = validatedConditions.filter(condId => {
                const condType = getConditionType(condId);
                return condType !== 'effects' && condType !== 'Effects';
            });

            // Store conditions in data attribute for filtering
            teamDiv.dataset.conditions = JSON.stringify(nonEffectConditions);

            if (nonEffectConditions.length > 0) {
                const conditionsDiv = document.createElement("div");
                conditionsDiv.className = "preset-dropdown-conditions";

                nonEffectConditions.forEach(condId => {
                    const condIcon = getConditionIcon(condId);
                    if (condIcon) {
                        const img = document.createElement("img");
                        img.src = condIcon;
                        img.className = "preset-dropdown-condition-icon";
                        img.title = getConditionName(condId);
                        conditionsDiv.appendChild(img);
                    }
                });

                infoContainer.appendChild(conditionsDiv);
            }

            // Add info container to team div if it has content
            if (infoContainer.children.length > 0) {
                teamDiv.appendChild(infoContainer);
            }

            // Drag events
            teamDiv.addEventListener("dragstart", (e) => {
                e.dataTransfer.effectAllowed = "copy";
                e.dataTransfer.setData("text/plain", JSON.stringify({
                    member: pseudo,
                    preset: preset
                }));
                teamDiv.style.opacity = "0.5";
                // Hide dropdown during drag
                const dropdown = document.getElementById("teamsPresetsDropdown");
                if (dropdown) {
                    dropdown.style.visibility = "hidden";
                }
            });

            teamDiv.addEventListener("dragend", (e) => {
                teamDiv.style.opacity = "1";
                // Show dropdown after drop
                const dropdown = document.getElementById("teamsPresetsDropdown");
                if (dropdown) {
                    dropdown.style.visibility = "visible";
                }
            });

            // Click event to open modal if team is assigned to a post
            teamDiv.addEventListener("click", (e) => {
                // Don't trigger if clicking during a drag
                if (teamDiv.style.opacity === "0.5") return;

                const usedInPost = findPresetUsage(pseudo, preset);
                if (usedInPost) {
                    // Extract post ID from usage string (e.g., "Post 1" -> "post1")
                    const postId = usedInPost
                        .toLowerCase()
                        .replace("post ", "post")
                        .replace("magic tower ", "magictower")
                        .replace("defense tower ", "defensetower")
                        .replace("mana shrine ", "manashrine")
                        .replace("stronghold", "stronghold");

                    openPostFromSummary(postId, pseudo);
                }
            });

            teamsContainer.appendChild(teamDiv);
        });

        memberDiv.appendChild(teamsContainer);
        dropdown.appendChild(memberDiv);
    });
}

// Filter presets by condition
function filterPresetsByCondition(conditionId) {
    const dropdown = document.getElementById("teamsPresetsDropdown");
    if (!dropdown) return;

    const allTeams = dropdown.querySelectorAll(".preset-dropdown-team");
    const allMembers = dropdown.querySelectorAll(".preset-dropdown-member");

    if (conditionId === "") {
        // Show all
        allTeams.forEach(team => team.classList.remove("filtered-out"));
        allMembers.forEach(member => member.classList.remove("filtered-out"));
    } else {
        // Filter by condition
        allTeams.forEach(team => {
            const conditions = JSON.parse(team.dataset.conditions || "[]");
            const hasCondition = conditions.some(condId => String(condId) === String(conditionId));
            if (hasCondition) {
                team.classList.remove("filtered-out");
            } else {
                team.classList.add("filtered-out");
            }
        });

        // Hide members with no visible teams
        allMembers.forEach(member => {
            const visibleTeams = member.querySelectorAll(".preset-dropdown-team:not(.filtered-out)");
            if (visibleTeams.length === 0) {
                member.classList.add("filtered-out");
            } else {
                member.classList.remove("filtered-out");
            }
        });
    }
}

function filterPresetsByMember(memberPseudo) {
    const dropdown = document.getElementById("teamsPresetsDropdown");
    if (!dropdown) return;

    const allMembers = dropdown.querySelectorAll(".preset-dropdown-member");

    if (memberPseudo === "") {
        // Show all members
        allMembers.forEach(member => member.classList.remove("member-filtered-out"));
    } else {
        // Filter by member
        allMembers.forEach(member => {
            const memberName = member.querySelector(".preset-dropdown-member-name");
            if (memberName && memberName.textContent === memberPseudo) {
                member.classList.remove("member-filtered-out");
            } else {
                member.classList.add("member-filtered-out");
            }
        });
    }
}

// Setup drag & drop zone on a post/building
function setupPostDropZone(postElement) {
    postElement.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        postElement.classList.add("drag-over");
    });

    postElement.addEventListener("dragleave", (e) => {
        postElement.classList.remove("drag-over");
    });

    postElement.addEventListener("drop", (e) => {
        e.preventDefault();
        postElement.classList.remove("drag-over");

        try {
            const data = JSON.parse(e.dataTransfer.getData("text/plain"));
            const { member, preset } = data;
            const postId = postElement.id;

            if (postId && member && preset) {
                addPresetToPost(postId, member, preset);
            }
        } catch (error) {
            console.error("Error dropping preset:", error);
        }
    });
}

// Add a preset to a post as a new team
function addPresetToPost(postId, memberPseudo, preset) {
    if (isViewer()) {
        alert("Cannot add teams in viewer mode.");
        return;
    }

    const currentData = postDataCache[postId] || {};
    const teams = Array.isArray(currentData.teams) ? [...currentData.teams] : [];

    // Create new team from preset
    const newTeam = {
        member: memberPseudo,
        c1: preset.champion4 || "",
        c2: preset.champion3 || "",
        c3: preset.champion2 || "",
        c4: preset.lead || "",
        c1_blessing: preset.champion4_blessing || null,
        c1_blessing_rarity: preset.champion4_blessing_rarity || null,
        c1_blessing_level: preset.champion4_blessing_level || 0,
        c2_blessing: preset.champion3_blessing || null,
        c2_blessing_rarity: preset.champion3_blessing_rarity || null,
        c2_blessing_level: preset.champion3_blessing_level || 0,
        c3_blessing: preset.champion2_blessing || null,
        c3_blessing_rarity: preset.champion2_blessing_rarity || null,
        c3_blessing_level: preset.champion2_blessing_level || 0,
        c4_blessing: preset.lead_blessing || null,
        c4_blessing_rarity: preset.lead_blessing_rarity || null,
        c4_blessing_level: preset.lead_blessing_level || 0,
        condition: preset.condition || "",
        selected: false
    };

    // Add to the end of teams array
    teams.push(newTeam);

    // Update Firebase
    const updatedData = {
        ...currentData,
        teams: teams
    };

    const refPost = ref(db, `rooms/${currentRoomId}/siege/${postId}`);
    set(refPost, updatedData).then(() => {
    }).catch(err => {
        console.error("Error adding preset to post:", err);
    });
}

// --- UI helpers ---

function clearChampVisual(imgEl, rarityEl) {
    if (imgEl) {
        imgEl.src = "";
        imgEl.style.display = "none";
    }
    if (rarityEl) {
        rarityEl.src = "";
        rarityEl.style.display = "none";
    }
}

function updateVisualForInput(inputEl, champImgEl, rarityImgEl) {
    const name = inputEl.value.trim();
    const slot = inputEl.closest('.champ-slot');
    const starsContainer = slot ? slot.querySelector('.blessing-stars') : null;

    if (!championsDB || !name) {
        clearChampVisual(champImgEl, rarityImgEl);
        // Hide stars if no champion
        if (starsContainer) {
            starsContainer.classList.remove("visible");
        }
        return;
    }
    const champ = getChampionByNameExact(name);
    if (!champ || !champ.image) {
        clearChampVisual(champImgEl, rarityImgEl);
        if (starsContainer) {
            starsContainer.classList.remove("visible");
        }
        return;
    }
    rarityImgEl.src = `/tools/champions-index/img/rarity/${champ.rarity}.webp`;
    rarityImgEl.style.display = "block";
    champImgEl.src = `/tools/champions-index/img/champions/${champ.image}.webp`;
    champImgEl.style.display = "block";

    // Show/hide stars based on rarity
    if (starsContainer) {
        if (champ.rarity === "Common" || champ.rarity === "Uncommon") {
            starsContainer.classList.remove("visible");
        } else {
            starsContainer.classList.add("visible");
        }
    }
}

function updateLeadAura(teamRow) {
    const auraDisplay = teamRow.querySelector(".lead-aura-display");
    if (!auraDisplay) return;

    // Trouver le champion 4 (lead)
    const rightRow = teamRow.querySelector(".modal-right-row");
    if (!rightRow) return;

    const leadSlot = Array.from(rightRow.querySelectorAll(".champ-slot")).find(
        slot => parseInt(slot.dataset.champIndex) === 4
    );

    if (!leadSlot) return;

    const leadInput = leadSlot.querySelector(".champ-input");
    const leadName = leadInput ? leadInput.value.trim() : "";

    if (!leadName || !championsDB) {
        auraDisplay.innerHTML = "";
        auraDisplay.style.display = "none";
        return;
    }

    const lead = getChampionByNameExact(leadName);
    if (!lead || !lead.auratext || !lead.aura) {
        auraDisplay.innerHTML = "";
        auraDisplay.style.display = "none";
        return;
    }

    // Parser l'aura pour extraire zone et valeur
    const auraText = lead.auratext || '';
    let zone = '';
    let value = '';

    // Extraire la zone (All Battles, Dungeons, Doom Tower, Arena)
    const zoneMatch = auraText.match(/in (all battles|dungeons|doom tower|arena)/i);
    if (zoneMatch) {
        zone = zoneMatch[1];
    }

    // Extraire la valeur (dernier nombre avec % si présent)
    const valueMatch = auraText.match(/by (\d+%?)\s*(?:SPD|ACC|ATK|DEF|HP|C\.RATE|C\.DMG|RES)?$/i);
    if (valueMatch) {
        value = valueMatch[1];
        // Ajouter le % s'il n'y est pas mais qu'il y a un % ailleurs dans le texte
        if (!value.includes('%') && auraText.includes('%')) {
            value += '%';
        }
    }

    // Afficher l'aura
    auraDisplay.innerHTML = `
        <div class="lead-aura-container">
            <img class="lead-aura-icon" src="/tools/champions-index/img/aura/${lead.aura}.webp" alt="Aura">
            <img class="lead-aura-border" src="/tools/champions-index/img/aura/BORDER.webp" alt="">
        </div>
        <div class="lead-aura-zone">${zone}</div>
        <div class="lead-aura-value">${value}</div>
    `;
    auraDisplay.style.display = "flex";

    // Add pulsing red effect if not "All Battles"
    if (zone && zone.toLowerCase() !== 'all battles') {
        auraDisplay.classList.add('lead-aura-restricted');
    } else {
        auraDisplay.classList.remove('lead-aura-restricted');
    }
}

// Generic functions for row reordering (works for both team-row and preset-row)
function moveRowUp(row, rowClass, updateCallback, saveCallback) {
    const prevRow = row.previousElementSibling;
    if (prevRow && prevRow.classList.contains(rowClass)) {
        row.parentNode.insertBefore(row, prevRow);
        if (updateCallback) updateCallback();
        if (saveCallback) saveCallback();
    }
}

function moveRowDown(row, rowClass, updateCallback, saveCallback) {
    const nextRow = row.nextElementSibling;
    if (nextRow && nextRow.classList.contains(rowClass)) {
        row.parentNode.insertBefore(nextRow, row);
        if (updateCallback) updateCallback();
        if (saveCallback) saveCallback();
    }
}

function updateRowMoveButtons(container, rowClass) {
    const rows = Array.from(container.querySelectorAll(`.${rowClass}`));

    rows.forEach((row, index) => {
        const upBtn = row.querySelector(".move-up");
        const downBtn = row.querySelector(".move-down");

        if (upBtn) upBtn.disabled = (index === 0);
        if (downBtn) downBtn.disabled = (index === rows.length - 1);
    });
}

// Team-specific wrappers
function moveTeamUp(teamRow) {
    moveRowUp(teamRow, "team-row", updateMoveButtons, autoSaveCurrentPost);
}

function moveTeamDown(teamRow) {
    moveRowDown(teamRow, "team-row", updateMoveButtons, autoSaveCurrentPost);
}

function updateMoveButtons() {
    const teamsContainer = document.getElementById("teamsContainer");
    updateRowMoveButtons(teamsContainer, "team-row");
}

// Preset-specific wrappers
function movePresetUp(presetRow) {
    moveRowUp(presetRow, "preset-row", updatePresetMoveButtons, savePresetsOrder);
}

function movePresetDown(presetRow) {
    moveRowDown(presetRow, "preset-row", updatePresetMoveButtons, savePresetsOrder);
}

function updatePresetMoveButtons() {
    const presetsContainer = document.getElementById("presetsContainer");
    updateRowMoveButtons(presetsContainer, "preset-row");
}

function savePresetsOrder() {
    const presetsContainer = document.getElementById("presetsContainer");
    const presetRows = Array.from(presetsContainer.querySelectorAll(".preset-row"));

    if (presetRows.length === 0) return;

    // Get member pseudo from first row
    const memberPseudo = presetRows[0].dataset.memberPseudo;
    if (!memberPseudo || !clanMembers[memberPseudo]) return;

    // Get current order of preset IDs
    const orderedPresetIds = presetRows.map(row => row.dataset.presetId);

    // Rebuild presets object in new order
    const member = clanMembers[memberPseudo];
    const oldPresets = member.presets || {};
    const newPresets = {};

    orderedPresetIds.forEach(presetId => {
        if (oldPresets[presetId]) {
            newPresets[presetId] = oldPresets[presetId];
        }
    });

    // Update in memory
    member.presets = newPresets;

    // Save to Firebase
    const memberRef = ref(db, `rooms/${currentRoomId}/members/${memberPseudo}/presets`);
    set(memberRef, newPresets);
}

function createTeamRow(teamData = {}, index = 0, hasSelectedTeam = false) {
    const teamsContainer = document.getElementById("teamsContainer");
    const teamRow = document.createElement("div");
    teamRow.className = "team-row";
    teamRow.draggable = true;
    teamRow.dataset.teamIndex = index;

    // Drag & drop handlers for team reordering
    teamRow.addEventListener("dragstart", (e) => {
        // Only start drag if the target is the teamRow itself, not a child element
        if (e.target !== teamRow) {
            e.preventDefault();
            return;
        }

        e.dataTransfer.effectAllowed = "move";
        // Use a custom data type to distinguish from champion drag
        e.dataTransfer.setData("application/x-team-row", index.toString());
        teamRow.classList.add("dragging");
    });

    teamRow.addEventListener("dragend", () => {
        teamRow.classList.remove("dragging");
        // Remove all drag-over classes
        document.querySelectorAll(".team-row.drag-over").forEach(row => {
            row.classList.remove("drag-over");
        });
    });

    teamRow.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const draggingElement = document.querySelector(".team-row.dragging");
        if (draggingElement && draggingElement !== teamRow) {
            teamRow.classList.add("drag-over");
        }
    });

    teamRow.addEventListener("dragleave", () => {
        teamRow.classList.remove("drag-over");
    });

    teamRow.addEventListener("drop", (e) => {
        e.preventDefault();
        teamRow.classList.remove("drag-over");

        // Only handle team row drops, not champion drops
        const teamRowData = e.dataTransfer.getData("application/x-team-row");
        if (!teamRowData) {
            // This is a champion drop, ignore it
            return;
        }

        const fromIndex = parseInt(teamRowData);
        const toIndex = index;

        if (fromIndex !== toIndex) {
            // Swap teams in the modal
            const allTeamRows = Array.from(teamsContainer.querySelectorAll(".team-row"));
            const fromRow = allTeamRows[fromIndex];
            const toRow = allTeamRows[toIndex];

            if (fromRow && toRow) {
                // Swap positions in DOM
                if (fromIndex < toIndex) {
                    toRow.parentNode.insertBefore(fromRow, toRow.nextSibling);
                } else {
                    toRow.parentNode.insertBefore(fromRow, toRow);
                }

                // Update data indices and save
                saveCurrentPost();
            }
        }
    });

    // --- Boutons monter/descendre ---
    const moveButtons = document.createElement("div");
    moveButtons.className = "move-team-btns";

    const moveUpBtn = document.createElement("button");
    moveUpBtn.className = "move-team-btn move-up";
    moveUpBtn.type = "button";
    moveUpBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>`;
    moveUpBtn.title = "Move team up";

    const moveDownBtn = document.createElement("button");
    moveDownBtn.className = "move-team-btn move-down";
    moveDownBtn.type = "button";
    moveDownBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>`;
    moveDownBtn.title = "Move team down";

    moveUpBtn.onclick = () => moveTeamUp(teamRow);
    moveDownBtn.onclick = () => moveTeamDown(teamRow);

    moveButtons.appendChild(moveUpBtn);
    moveButtons.appendChild(moveDownBtn);
    teamRow.appendChild(moveButtons);

    // --- Bouton de sélection (pour posts classiques uniquement) ---
    const postElForSelect = currentPostId ? document.getElementById(currentPostId) : null;
    const postTypeForSelect = postElForSelect ? postElForSelect.dataset.type : "post";

    if (postTypeForSelect === "post") {
        // SVG icons
        const checkmarkSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
        const crossSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
        const hourglassSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/><path d="M7 22v-4.172a2 2 0 0 1 .586-1.414L12 12 7.586 7.414A2 2 0 0 1 7 6.172V2"/></svg>`;

        const selectBtn = document.createElement("button");
        selectBtn.className = "team-select-btn";
        selectBtn.type = "button";
        selectBtn.dataset.selected = teamData.selected === true ? "true" : "false";

        if (teamData.selected === true) {
            selectBtn.innerHTML = checkmarkSVG;
            selectBtn.dataset.state = "selected";
        } else {
            // Set initial state based on whether any team is selected
            if (hasSelectedTeam) {
                // Another team is selected, so this one is rejected
                selectBtn.innerHTML = crossSVG;
                selectBtn.dataset.state = "rejected";
            } else {
                // No team selected yet, so this is pending
                selectBtn.innerHTML = hourglassSVG;
                selectBtn.dataset.state = "pending";
            }
        }
        selectBtn.title = "Select this team";

        selectBtn.onclick = () => {
            // Toggle selection
            const isSelected = selectBtn.dataset.selected === "true";

            if (!isSelected) {
                // Marquer cette team comme sélectionnée
                selectBtn.dataset.selected = "true";
                selectBtn.dataset.state = "selected";
                selectBtn.innerHTML = checkmarkSVG;

                // Désélectionner toutes les autres teams du même poste
                teamsContainer.querySelectorAll(".team-select-btn").forEach(btn => {
                    if (btn !== selectBtn) {
                        btn.dataset.selected = "false";
                        btn.dataset.state = "rejected";
                        btn.innerHTML = crossSVG;
                    }
                });
            } else {
                // Désélectionner cette team - toutes repassent en pending
                selectBtn.dataset.selected = "false";
                selectBtn.dataset.state = "pending";
                selectBtn.innerHTML = hourglassSVG;

                // Remettre toutes les autres en pending aussi
                teamsContainer.querySelectorAll(".team-select-btn").forEach(btn => {
                    if (btn !== selectBtn && btn.dataset.selected !== "true") {
                        btn.dataset.state = "pending";
                        btn.innerHTML = hourglassSVG;
                    }
                });
            }

            // Apply team-specific locks after selection change
            applyTeamSelectionLocks();

            // Auto-save on selection change
            autoSaveCurrentPost();
        };

        teamRow.appendChild(selectBtn);
    }

    // --- bouton clear à droite des champions ---
    const clearBtn = document.createElement("button");
    clearBtn.className = "action-btn clear-team-btn";
    clearBtn.type = "button";
    clearBtn.title = "Clear team";
    clearBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6l-1.5 14H6.5L5 6"></path>
        <path d="M10 11v6"></path>
        <path d="M14 11v6"></path>
        <path d="M9 6V4h6v2"></path>
    </svg>
    `;

    // logique pour vider la team
    clearBtn.onclick = () => {
        const memberSelect = teamRow.querySelector(".member-select");
        if (memberSelect) memberSelect.value = "";

        teamRow.querySelectorAll(".champ-input").forEach(ci => ci.value = "");
        teamRow.querySelectorAll(".champ-img").forEach(img => {
            img.src = "";
            img.style.display = "none";
        });
        teamRow.querySelectorAll(".rarity-img").forEach(img => {
            img.src = "";
            img.style.display = "none";
        });

        // Clear team condition
        const conditionInput = teamRow.querySelector(".team-condition-value");
        if (conditionInput) conditionInput.value = "";

        // Save changes to database
        saveCurrentPost();
    };



    // member slot
    const memberSlot = document.createElement("div");
    memberSlot.className = "member-slot";

    const mLabel = document.createElement("label");
    mLabel.textContent = "Member";

    const mInput = document.createElement("select");
    mInput.className = "member-select";

    Object.keys(clanMembers).sort().forEach(name => {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        mInput.appendChild(opt);
    });

    mInput.value = teamData.member || "";

    // Add hover listener to highlight team when member is hovered
    mInput.addEventListener("mouseenter", () => {
        teamRow.style.background = "rgba(212, 175, 55, 0.15)";
        teamRow.style.transition = "background 0.2s";
    });

    mInput.addEventListener("mouseleave", () => {
        teamRow.style.background = "";
    });

    memberSlot.appendChild(mLabel);
    memberSlot.appendChild(mInput);

    teamRow.appendChild(memberSlot);
    
        // --- Condition par team (seulement pour les posts classiques) ---
    const postEl = currentPostId ? document.getElementById(currentPostId) : null;
    const postTypeForTeam = postEl ? postEl.dataset.type : "post";

    if (postTypeForTeam === "post") {
        const teamCondSlot = document.createElement("div");
        teamCondSlot.className = "team-condition-slot";

        const condLabel = document.createElement("div");
        condLabel.className = "team-condition-label";
        condLabel.textContent = "CONDITION";

        const condChoices = document.createElement("div");
        condChoices.className = "team-condition-choices";

        const condHidden = document.createElement("input");
        condHidden.type = "hidden";
        condHidden.className = "team-condition-value";
        condHidden.value = teamData.condition || "";

        // créer les boutons pour les 3 conditions du post
        const buttons = [];
        currentPostConditionsList.forEach(cond => {
            if (!cond) return;

            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "team-cond-btn";

            const img = document.createElement("img");
            img.src = `/siege/img/conditions/${cond.image}.webp`;
            img.alt = cond.name || "Condition";
            img.title = cond.description || cond.name || "Condition";

            btn.appendChild(img);

            btn.addEventListener("click", () => {
                // Si on clique la condition déjà sélectionnée → on la retire
                if (String(condHidden.value) === String(cond.id)) {
                    condHidden.value = "";
                    buttons.forEach(b => b.classList.remove("selected"));
                    return;
                }

                // Sinon → on sélectionne normalement
                condHidden.value = cond.id;
                buttons.forEach(b => b.classList.remove("selected"));
                btn.classList.add("selected");
            });

            if (String(teamData.condition || "") === String(cond.id)) {
                btn.classList.add("selected");
            }

            buttons.push(btn);
            condChoices.appendChild(btn);
        });

        teamCondSlot.appendChild(condLabel);
        teamCondSlot.appendChild(condChoices);
        teamCondSlot.appendChild(condHidden);

        memberSlot.appendChild(teamCondSlot);
    }

    // right champs row
    const rightRow = document.createElement("div");
    rightRow.className = "modal-right-row";

    // Variable to track dragging within this modal
    let draggedModalChampSlot = null;

    // Store slots temporarily to add them in reverse visual order
    const champSlots = [];

    for (let i = 1; i <= 4; i++) {
        const champSlot = document.createElement("div");
        champSlot.className = "champ-slot";
        champSlot.draggable = true;
        champSlot.dataset.champIndex = i;

        const cLabel = document.createElement("label");
        // Use champIndex directly for label to match drag behavior
        if (i === 4) {
            cLabel.textContent = "Lead";
        } else {
            cLabel.textContent = "Champion " + i;
        }
        const cInput = document.createElement("input");
        cInput.className = "champ-input";
        cInput.value = teamData["c" + i] || "";

        const visual = document.createElement("div");
        visual.className = "champ-visual";
        const rarityImg = document.createElement("img");
        rarityImg.className = "rarity-img";
        const champImg = document.createElement("img");
        champImg.className = "champ-img";

        const clearChampBtn = document.createElement("button");
        clearChampBtn.className = "clear-champ-btn";
        clearChampBtn.type = "button";
        clearChampBtn.innerHTML = "×";
        clearChampBtn.title = "Remove this champion";

        clearChampBtn.onclick = () => {
            cInput.value = "";
            champImg.src = "";
            champImg.style.display = "none";
            rarityImg.src = "";
            rarityImg.style.display = "none";
        };

        // Create blessing stars
        const blessingStars = createBlessingStars(
            (teamData && teamData["c" + i]) || "",
            (teamData && teamData[`c${i}_blessing_level`]) || 0
        );

        // Create blessing image
        const blessingName = (teamData && teamData[`c${i}_blessing`]) || null;
        const blessingRarity = (teamData && teamData[`c${i}_blessing_rarity`]) || null;
        const blessingImg = createBlessingImage(blessingName, blessingRarity);

        // Add click handlers for stars
        const stars = blessingStars.querySelectorAll(".blessing-star");
        stars.forEach((star, starIndex) => {
            star.addEventListener("click", (e) => {
                e.stopPropagation();
                const clickedLevel = starIndex + 1;
                const currentLevel = parseInt(blessingStars.dataset.currentLevel || "0");

                // If clicking the same level, deactivate (set to 0)
                // Otherwise, set to clicked level
                const newLevel = (clickedLevel === currentLevel) ? 0 : clickedLevel;

                // Update stars visual
                updateBlessingStars(blessingStars, newLevel);
                blessingStars.dataset.currentLevel = newLevel;

                // Show/hide blessing image
                updateBlessingImageVisibility(visual, newLevel);

                // Save to team data
                if (teamData) {
                    teamData[`c${i}_blessing_level`] = newLevel;

                    // If level is 0, also clear the blessing
                    if (newLevel === 0) {
                        teamData[`c${i}_blessing`] = null;
                        teamData[`c${i}_blessing_rarity`] = null;
                    }
                }

                // Save to Firebase
                if (currentPostId && currentRoomId) {
                    const levelRef = ref(db, `rooms/${currentRoomId}/siege/${currentPostId}/teams/${index}/c${i}_blessing_level`);
                    set(levelRef, newLevel);

                    // If level is 0, also clear the blessing from Firebase
                    if (newLevel === 0) {
                        const blessingRef = ref(db, `rooms/${currentRoomId}/siege/${currentPostId}/teams/${index}/c${i}_blessing`);
                        set(blessingRef, null);

                        const rarityRef = ref(db, `rooms/${currentRoomId}/siege/${currentPostId}/teams/${index}/c${i}_blessing_rarity`);
                        set(rarityRef, null);
                    }
                }
            });
        });

        blessingStars.dataset.currentLevel = (teamData && teamData[`c${i}_blessing_level`]) || 0;

        // Show blessing image if blessing level > 0
        const initialBlessingLevel = (teamData && teamData[`c${i}_blessing_level`]) || 0;
        if (initialBlessingLevel > 0) {
            blessingImg.style.display = "block";
        }

        visual.appendChild(champImg);
        visual.appendChild(rarityImg);
        visual.appendChild(blessingStars);
        visual.appendChild(blessingImg);
        visual.appendChild(clearChampBtn);

        const sugWrapper = document.createElement("div");
        sugWrapper.className = "suggestions";
        const sugList = document.createElement("div");
        sugList.className = "suggestions-list";
        sugWrapper.appendChild(sugList);

        const inputWrapper = document.createElement("div");
        inputWrapper.className = "champ-input-wrapper";
        inputWrapper.style.position = "relative";
        inputWrapper.style.width = "70px";

        inputWrapper.appendChild(cInput);
        inputWrapper.appendChild(sugWrapper);

        // nouveau layout
        champSlot.appendChild(cLabel);
        champSlot.appendChild(inputWrapper);
        champSlot.appendChild(visual);


        // suggestions logic
        cInput.addEventListener("input", () => {
            const q = cInput.value.trim();
            sugList.innerHTML = "";
            if (!q || !championsDB) return;

            const results = searchChampions(q);

            results.forEach(ch => {
                const div = document.createElement("div");
                div.textContent = ch.name;

                div.addEventListener("click", () => {
                    cInput.value = ch.name;
                    sugList.innerHTML = "";
                    // Get the images from the DOM at click time, not from closure
                    const slot = cInput.closest('.champ-slot');
                    const img = slot.querySelector('.champ-img');
                    const rarity = slot.querySelector('.rarity-img');
                    updateVisualForInput(cInput, img, rarity);
                });

                sugList.appendChild(div);
            });
        });

        cInput.addEventListener("blur", () => {
            setTimeout(() => { sugList.innerHTML = ""; }, 200);
        });

        // initial visual if data present
        if (championsDB && cInput.value.trim()) {
            updateVisualForInput(cInput, champImg, rarityImg);
        }

        // Update lead aura when champion 4 changes
        if (i === 4) {
            cInput.addEventListener("input", () => {
                setTimeout(() => updateLeadAura(teamRow), 50);
            });

            // Also update when a suggestion is clicked or input loses focus
            cInput.addEventListener("blur", () => {
                setTimeout(() => updateLeadAura(teamRow), 250);
            });
        }

        // Drag & Drop events
        champSlot.addEventListener("dragstart", (e) => {
            // Stop propagation to prevent teamRow dragstart from firing
            e.stopPropagation();

            draggedModalChampSlot = e.currentTarget;
            e.dataTransfer.effectAllowed = "move";
            // Use custom data type to distinguish from team row drag
            e.dataTransfer.setData("application/x-champion-slot", e.currentTarget.dataset.champIndex);
            e.currentTarget.classList.add("dragging");
        });

        champSlot.addEventListener("dragend", () => {
            champSlot.classList.remove("dragging");
            draggedModalChampSlot = null;
        });

        champSlot.addEventListener("dragover", (e) => {
            // Only allow drop if we're dragging a champion slot from this modal
            if (!draggedModalChampSlot) {
                e.dataTransfer.dropEffect = "none";
                return;
            }

            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            champSlot.classList.add("drag-over");
        });

        champSlot.addEventListener("dragleave", () => {
            champSlot.classList.remove("drag-over");
        });

        champSlot.addEventListener("drop", (e) => {
            e.preventDefault();
            champSlot.classList.remove("drag-over");

            // Only allow drop if we're dragging a champion slot from this modal
            if (!draggedModalChampSlot) {
                return;
            }

            // Get data from custom type
            const champSlotData = e.dataTransfer.getData("application/x-champion-slot");
            if (!champSlotData) {
                return;
            }

            const fromIndex = parseInt(champSlotData);
            const toIndex = parseInt(champSlot.dataset.champIndex);

            if (fromIndex === toIndex) return;

            // Échanger les champions dans la même team
            const allSlots = rightRow.querySelectorAll(".champ-slot");

            const fromSlot = Array.from(allSlots).find(s => parseInt(s.dataset.champIndex) === fromIndex);
            const toSlot = champSlot;

            if (!fromSlot || !toSlot) return;

            const fromInput = fromSlot.querySelector(".champ-input");
            const toInput = toSlot.querySelector(".champ-input");
            const fromChampImg = fromSlot.querySelector(".champ-img");
            const toChampImg = toSlot.querySelector(".champ-img");
            const fromRarityImg = fromSlot.querySelector(".rarity-img");
            const toRarityImg = toSlot.querySelector(".rarity-img");

            // Get blessing containers
            const fromVisual = fromSlot.querySelector(".champ-visual");
            const toVisual = toSlot.querySelector(".champ-visual");
            const fromBlessingContainer = fromVisual ? fromVisual.querySelector(".blessing-img-container") : null;
            const toBlessingContainer = toVisual ? toVisual.querySelector(".blessing-img-container") : null;

            // Échanger les valeurs
            const tempValue = fromInput.value;
            const tempChampSrc = fromChampImg.src;
            const tempChampDisplay = fromChampImg.style.display;
            const tempRaritySrc = fromRarityImg.src;
            const tempRarityDisplay = fromRarityImg.style.display;

            fromInput.value = toInput.value;
            fromChampImg.src = toChampImg.src;
            fromChampImg.style.display = toChampImg.style.display;
            fromRarityImg.src = toRarityImg.src;
            fromRarityImg.style.display = toRarityImg.style.display;

            toInput.value = tempValue;
            toChampImg.src = tempChampSrc;
            toChampImg.style.display = tempChampDisplay;
            toRarityImg.src = tempRaritySrc;
            toRarityImg.style.display = tempRarityDisplay;

            // Swap blessings - swap the entire containers
            if (fromBlessingContainer && toBlessingContainer) {
                // Clone both containers
                const fromClone = fromBlessingContainer.cloneNode(true);
                const toClone = toBlessingContainer.cloneNode(true);

                // Replace them
                fromBlessingContainer.parentNode.replaceChild(toClone, fromBlessingContainer);
                toBlessingContainer.parentNode.replaceChild(fromClone, toBlessingContainer);
            }

            // Swap blessing stars
            const fromStarsContainer = fromVisual ? fromVisual.querySelector(".blessing-stars") : null;
            const toStarsContainer = toVisual ? toVisual.querySelector(".blessing-stars") : null;

            if (fromStarsContainer && toStarsContainer) {
                // Clone both star containers
                const fromStarsClone = fromStarsContainer.cloneNode(true);
                const toStarsClone = toStarsContainer.cloneNode(true);

                // Replace them
                fromStarsContainer.parentNode.replaceChild(toStarsClone, fromStarsContainer);
                toStarsContainer.parentNode.replaceChild(fromStarsClone, toStarsContainer);
            }

            // Update lead aura if champion 4 was involved in the swap
            if (fromIndex === 4 || toIndex === 4) {
                setTimeout(() => updateLeadAura(teamRow), 50);
            }

            // Save swapped blessing data to Firebase
            const teamIndex = teamRow.dataset.teamIndex;
            if (currentPostId && currentRoomId && teamIndex !== undefined) {
                const postData = postDataCache[currentPostId];
                if (postData && postData.teams && postData.teams[teamIndex]) {
                    const teamData = postData.teams[teamIndex];

                    // Update team data in cache
                    const tempChamp = teamData[`c${fromIndex}`];
                    const tempBlessing = teamData[`c${fromIndex}_blessing`];
                    const tempBlessingRarity = teamData[`c${fromIndex}_blessing_rarity`];
                    const tempBlessingLevel = teamData[`c${fromIndex}_blessing_level`];

                    teamData[`c${fromIndex}`] = teamData[`c${toIndex}`];
                    teamData[`c${fromIndex}_blessing`] = teamData[`c${toIndex}_blessing`];
                    teamData[`c${fromIndex}_blessing_rarity`] = teamData[`c${toIndex}_blessing_rarity`];
                    teamData[`c${fromIndex}_blessing_level`] = teamData[`c${toIndex}_blessing_level`];

                    teamData[`c${toIndex}`] = tempChamp;
                    teamData[`c${toIndex}_blessing`] = tempBlessing;
                    teamData[`c${toIndex}_blessing_rarity`] = tempBlessingRarity;
                    teamData[`c${toIndex}_blessing_level`] = tempBlessingLevel;

                    // Save to Firebase
                    const teamRef = ref(db, `rooms/${currentRoomId}/siege/${currentPostId}/teams/${teamIndex}`);
                    update(teamRef, {
                        [`c${fromIndex}`]: teamData[`c${fromIndex}`],
                        [`c${fromIndex}_blessing`]: teamData[`c${fromIndex}_blessing`],
                        [`c${fromIndex}_blessing_rarity`]: teamData[`c${fromIndex}_blessing_rarity`],
                        [`c${fromIndex}_blessing_level`]: teamData[`c${fromIndex}_blessing_level`],
                        [`c${toIndex}`]: teamData[`c${toIndex}`],
                        [`c${toIndex}_blessing`]: teamData[`c${toIndex}_blessing`],
                        [`c${toIndex}_blessing_rarity`]: teamData[`c${toIndex}_blessing_rarity`],
                        [`c${toIndex}_blessing_level`]: teamData[`c${toIndex}_blessing_level`]
                    });
                }
            }
        });

        // Store slot instead of appending directly
        champSlots.push(champSlot);
    }

    // Append slots in reverse order so visual matches drag behavior
    // We want: position 0 = champIndex 1, position 1 = champIndex 2, etc.
    // But visually labeled as: Champion 4, Champion 3, Champion 2, Lead
    // The issue is the LABEL doesn't match the champIndex!
    // champIndex 1 is labeled "Champion 4" but user sees it as Champion 4
    // So when dragging, user drags "what they see" but champIndex is different

    // Solution: keep champIndex order but user must understand:
    // Visual "Champion 4" = champIndex 1
    // Visual "Champion 3" = champIndex 2
    // Visual "Champion 2" = champIndex 3
    // Visual "Lead" = champIndex 4
    champSlots.forEach(slot => rightRow.appendChild(slot));

    teamRow.appendChild(rightRow);

    // Aura display (will be populated when lead is set)
    const auraDisplay = document.createElement("div");
    auraDisplay.className = "lead-aura-display";
    teamRow.appendChild(auraDisplay);

    // Delete button (only if index > 0) - BEFORE clear button
    if (index > 0) {
        const deleteBtn = document.createElement("button");
        deleteBtn.className = "action-btn delete-team-btn";
        deleteBtn.type = "button";
        deleteBtn.title = "Delete team";
        deleteBtn.style.marginLeft = "auto"; // Push buttons to the right
        deleteBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <line x1="17" x2="22" y1="8" y2="8"/>
            </svg>
        `;
        deleteBtn.addEventListener("click", () => {
            teamRow.remove();
            updateMoveButtons();
            autoSaveCurrentPost();
        });

        teamRow.appendChild(deleteBtn);
    } else {
        // For the first team (index 0), the clear button should push right
        clearBtn.style.marginLeft = "auto";
    }

    teamRow.appendChild(clearBtn);

    // Save as Preset button
    const savePresetBtn = document.createElement("button");
    savePresetBtn.className = "action-btn save-preset-btn";
    savePresetBtn.type = "button";
    savePresetBtn.title = "Save as Preset";
    savePresetBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 12H3"/>
            <path d="M16 6H3"/>
            <path d="M16 18H3"/>
            <path d="M18 9v6"/>
            <path d="M21 12h-6"/>
        </svg>
    `;
    savePresetBtn.addEventListener("click", () => {
        saveTeamAsPreset(teamRow);
    });
    teamRow.appendChild(savePresetBtn);

    // Bouton pour transférer vers un autre poste
    const transferBtn = document.createElement("button");
    transferBtn.className = "action-btn transfer-team-btn";
    transferBtn.type = "button";
    transferBtn.title = "Move to another post";
    transferBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 3 3 9-3 9 19-9Z"/><path d="M6 12h16"/></svg>`;

    const transferMenu = document.createElement("div");
    transferMenu.className = "transfer-menu";

    const scrollWrapper = document.createElement("div");
    scrollWrapper.className = "transfer-menu-scroll";

    // Créer les options de transfert
    postIds.forEach(pid => {
        const item = document.createElement("div");
        item.className = "transfer-menu-item";
        item.textContent = getPostLabel(pid);

        if (pid === currentPostId) {
            item.classList.add("current");
            item.title = "Current post";
        } else {
            item.addEventListener("click", () => {
                transferTeamToPost(teamRow, pid);
                transferMenu.classList.remove("open");
            });
        }

        scrollWrapper.appendChild(item);
    });

    transferMenu.appendChild(scrollWrapper);

    transferBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        // Fermer tous les autres menus
        document.querySelectorAll(".transfer-menu.open").forEach(m => {
            if (m !== transferMenu) m.classList.remove("open");
        });
        transferMenu.classList.toggle("open");

        // Position the menu using fixed positioning
        if (transferMenu.classList.contains("open")) {
            const btnRect = transferBtn.getBoundingClientRect();
            const viewportHeight = window.innerHeight;

            // Position to the right of the button
            transferMenu.style.right = `${window.innerWidth - btnRect.right}px`;

            // Check if there's space below, otherwise position above
            const estimatedMenuHeight = 300; // max-height from CSS
            if (btnRect.bottom + estimatedMenuHeight > viewportHeight) {
                // Position above the button
                transferMenu.style.top = 'auto';
                transferMenu.style.bottom = `${viewportHeight - btnRect.top}px`;
            } else {
                // Position below the button
                transferMenu.style.top = `${btnRect.bottom}px`;
                transferMenu.style.bottom = 'auto';
            }
        }
    });

    teamRow.appendChild(transferBtn);
    teamRow.appendChild(transferMenu);
    teamsContainer.appendChild(teamRow);
    updateMoveButtons();

    // Update lead aura if champion 4 is set
    if (championsDB) {
        setTimeout(() => updateLeadAura(teamRow), 100);
    }
}

// Save team as preset
function saveTeamAsPreset(teamRow) {
    if (isViewer()) {
        alert("Cannot save presets in viewer mode.");
        return;
    }

    // Get member from the team
    const memberSelect = teamRow.querySelector(".member-select");
    if (!memberSelect || !memberSelect.value) {
        alert("Please select a member first before saving as preset.");
        return;
    }

    const memberPseudo = memberSelect.value;

    // Get champions from the team
    const champInputs = teamRow.querySelectorAll(".champ-input");
    const champions = {
        champion4: champInputs[0]?.value || "",
        champion3: champInputs[1]?.value || "",
        champion2: champInputs[2]?.value || "",
        lead: champInputs[3]?.value || ""
    };

    // Check if at least one champion is set
    const hasChampions = Object.values(champions).some(c => c && c.trim() !== "");
    if (!hasChampions) {
        alert("Please add at least one champion before saving as preset.");
        return;
    }

    // Get condition if any
    const conditionInput = teamRow.querySelector(".team-condition-value");
    const condition = conditionInput?.value || "";

    // Create preset object
    const preset = {
        ...champions,
        condition: condition
    };

    // Get current member data
    const member = clanMembers[memberPseudo];
    if (!member) {
        alert("Member not found.");
        return;
    }

    // Initialize presets if needed
    if (!member.presets) {
        member.presets = {};
    }

    // Generate unique preset ID
    const presetIds = Object.keys(member.presets);
    let newPresetId = `preset${presetIds.length + 1}`;
    let counter = presetIds.length + 1;
    while (member.presets[newPresetId]) {
        counter++;
        newPresetId = `preset${counter}`;
    }

    // Add preset
    member.presets[newPresetId] = preset;

    // Save to Firebase
    const refMembers = ref(db, `rooms/${currentRoomId}/siege/members`);
    set(refMembers, clanMembers).then(() => {
        // Show success message
        alert(`✓ Team saved as preset for ${memberPseudo}!`);

        // Refresh the teams presets dropdown if it's open
        const dropdown = document.getElementById("teamsPresetsDropdown");
        if (dropdown && dropdown.classList.contains("show")) {
            refreshTeamsPresetsDropdown();
        }
    }).catch(err => {
        console.error("Error saving preset:", err);
        alert("Error saving preset. Please try again.");
    });
}

function getTeamsFromModal() {
    const teams = [];
    const teamsContainer = document.getElementById("teamsContainer");

    // Vérifier le type de post
    const postEl = currentPostId ? document.getElementById(currentPostId) : null;
    const postType = postEl ? postEl.dataset.type : "post";

    let teamIndex = 0;
    teamsContainer.querySelectorAll(".team-row").forEach(row => {
        const memberInput = row.querySelector(".member-select");
        const champInputs = row.querySelectorAll(".champ-input");
        const condInput = row.querySelector(".team-condition-value");
        const selectBtn = row.querySelector(".team-select-btn");

        const team = {
            member: memberInput ? memberInput.value.trim() : "",
            c1: champInputs[0] ? champInputs[0].value.trim() : "",
            c2: champInputs[1] ? champInputs[1].value.trim() : "",
            c3: champInputs[2] ? champInputs[2].value.trim() : "",
            c4: champInputs[3] ? champInputs[3].value.trim() : "",
            condition: condInput ? condInput.value.trim() : ""
        };

        // Ajouter selected pour les posts classiques
        if (postType === "post" && selectBtn) {
            team.selected = selectBtn.dataset.selected === "true";
        }

        // Ajouter group et team pour les non-posts
        if (postType !== "post") {
            team.group = Math.floor(teamIndex / 3) + 1;
            team.team = (teamIndex % 3) + 1;
        }

        if (team.member || team.c1 || team.c2 || team.c3 || team.c4 || team.condition) {
            teams.push(team);
            teamIndex++;
        }
    });
    return teams;
}

function createGroupHeader(groupNumber) {
    const header = document.createElement("div");
    header.className = "group-header";
    header.textContent = `Group ${groupNumber}`;
    return header;
}

function fillModalFromData(data) {
    // CONDIS NON UTILISÉES POUR L'INSTANT → CHECK SAFE
    const teamsContainer = document.getElementById("teamsContainer");
    teamsContainer.innerHTML = "";

    // Vérifier le type de post
    const postEl = currentPostId ? document.getElementById(currentPostId) : null;
    const postType = postEl ? postEl.dataset.type : "post";

    // Ne plus limiter le nombre de teams - c'est juste visuel
    const teams = Array.isArray(data.teams) && data.teams.length ? data.teams : [{}];

    // Check if any team is selected (for correct initial state)
    const hasSelectedTeam = teams.some(t => t.selected === true);

    // Pour les tours, shrine et stronghold, grouper par 3
    if (postType !== "post") {
        teams.forEach((team, i) => {
            // Ajouter un header de groupe tous les 3 teams
            if (i % 3 === 0) {
                const groupNumber = Math.floor(i / 3) + 1;
                teamsContainer.appendChild(createGroupHeader(groupNumber));
            }
            createTeamRow(team, i, hasSelectedTeam);
        });
    } else {
        // Pour les posts classiques, pas de groupes
        teams.forEach((team, i) => createTeamRow(team, i, hasSelectedTeam));
    }
}

function openModal(postId) {
    currentPostId = postId;
    document.body.classList.add("modal-open");
    document.getElementById("modalOverlay").style.display = "flex";

    const data = postDataCache[postId] || {};
    const isFrozen = data.frozen || false;

    // Add lock/unlock icon before title
    const lockIcon = isFrozen
        ? '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 8px;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>'
        : '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 8px;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>';

    const titleText = postId
        .replace("post", "Post ")
        .replace("magictower", "Magic Tower ")
        .replace("defensetower", "Defense Tower ")
        .replace("manashrine", "Mana Shrine ")
        .replace("stronghold", "Stronghold");

    document.getElementById("modalTitle").innerHTML = lockIcon + titleText;

    // Mettre à jour l'état du bouton freeze
    updateFreezeButton(isFrozen);

    // Mettre à jour le bonus du bastion (visible sur tous les posts)
    updateStrongholdBonus();

    // Mettre à jour l'irradiance des tours de magie
    updateIrradianceDisplay();

    // Afficher/masquer la section de niveau de bâtiment
    updateBuildingLevelSection(postId, data);

    // ⚠️ d'abord les conditions (post-level)
    renderConditionsUI(postId, data);

    // puis les teams (qui ont besoin des 3 conditions du post)
    fillModalFromData(data);

    // Mettre à jour l'état des boutons de sélection (sablier vs croix)
    updateSelectionButtonsState();

    // Appliquer le verrouillage si nécessaire
    applyFreezeState(data.frozen || false);

    // Reset unsaved changes tracking
    hasUnsavedChanges = false;

    // Capture initial state after a small delay to ensure everything is rendered
    setTimeout(() => {
        initialModalState = captureModalState();
        setupChangeTracking();
    }, 100);

    setStatus("");
}

function updateBuildingLevelSection(postId, data) {
    const buildingLevelSection = document.getElementById("buildingLevelSection");
    const buildingLevelSelect = document.getElementById("buildingLevel");
    const buildingLevelSlots = document.getElementById("buildingLevelSlots");

    if (!buildingLevelSection || !buildingLevelSelect || !buildingLevelSlots) return;

    const buildingType = getBuildingTypeFromPostId(postId);

    if (!buildingType) {
        // Ce n'est pas un bâtiment, masquer la section
        buildingLevelSection.style.display = "none";
        return;
    }

    // C'est un bâtiment, afficher la section
    buildingLevelSection.style.display = "flex";

    // Récupérer le niveau actuel (par défaut 1)
    const currentLevel = data.buildingLevel || 1;
    buildingLevelSelect.value = currentLevel;

    // Mettre à jour les slots requis
    updateBuildingLevelSlots(buildingType, currentLevel);

    // Mettre à jour les contraintes de niveau max selon le stronghold
    updateBuildingLevelConstraints(postId);

    // Écouter les changements de niveau
    buildingLevelSelect.onchange = function() {
        const newLevel = parseInt(this.value);
        updateBuildingLevelSlots(buildingType, newLevel);
        // Ne plus ajuster automatiquement les teams - c'est juste visuel
        trackModalChanges();
    };
}

function updateBuildingLevelSlots(buildingType, level) {
    const buildingLevelSlots = document.getElementById("buildingLevelSlots");
    if (!buildingLevelSlots) return;

    const requiredSlots = getBuildingSlots(buildingType, level);
    buildingLevelSlots.textContent = requiredSlots;
}

function updateBuildingLevelConstraints(postId) {
    const buildingLevelSelect = document.getElementById("buildingLevel");
    if (!buildingLevelSelect) return;

    // Si c'est le stronghold, pas de contraintes
    if (postId === "stronghold") {
        // Tous les niveaux disponibles (1-6)
        for (let i = 1; i <= 6; i++) {
            buildingLevelSelect.options[i - 1].disabled = false;
        }
        return;
    }

    // Pour les autres bâtiments, max = niveau du stronghold
    const strongholdData = postDataCache["stronghold"] || {};
    const strongholdLevel = strongholdData.buildingLevel || 1;

    for (let i = 1; i <= 6; i++) {
        const option = buildingLevelSelect.options[i - 1];
        if (i > strongholdLevel) {
            option.disabled = true;
        } else {
            option.disabled = false;
        }
    }

    // Si le niveau actuel est supérieur au stronghold, le réduire
    const currentLevel = parseInt(buildingLevelSelect.value);
    if (currentLevel > strongholdLevel) {
        buildingLevelSelect.value = strongholdLevel;
        const buildingType = getBuildingTypeFromPostId(postId);
        updateBuildingLevelSlots(buildingType, strongholdLevel);
    }
}

function setupChangeTracking() {
    const modal = document.getElementById("modalOverlay");
    if (!modal) return;

    // Add event listeners to track changes on inputs, selects, and buttons
    const teamsContainer = document.getElementById("teamsContainer");
    const conditionInput = document.getElementById("condition");
    const buildingLevelSelect = document.getElementById("buildingLevel");

    if (teamsContainer) {
        teamsContainer.addEventListener("input", trackModalChanges);
        teamsContainer.addEventListener("change", trackModalChanges);
    }

    if (conditionInput) {
        conditionInput.addEventListener("change", trackModalChanges);
    }

    if (buildingLevelSelect) {
        buildingLevelSelect.addEventListener("change", trackModalChanges);
    }
}

function updateSelectionButtonsState() {
    const teamsContainer = document.getElementById("teamsContainer");
    if (!teamsContainer) return;

    const selectButtons = teamsContainer.querySelectorAll(".team-select-btn");
    if (selectButtons.length === 0) return;

    // SVG icons
    const crossSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    const hourglassSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/><path d="M7 22v-4.172a2 2 0 0 1 .586-1.414L12 12 7.586 7.414A2 2 0 0 1 7 6.172V2"/></svg>`;

    // Vérifier si au moins une équipe est sélectionnée
    const hasSelection = Array.from(selectButtons).some(btn => btn.dataset.selected === "true");

    // Mettre à jour les boutons non sélectionnés
    selectButtons.forEach(btn => {
        if (btn.dataset.selected !== "true") {
            // PRESERVE the rejected state if it's already set (don't revert cross to hourglass)
            const currentState = btn.dataset.state;

            if (hasSelection) {
                // Une sélection existe : afficher la croix (only if not already rejected)
                if (currentState !== "rejected") {
                    btn.dataset.state = "rejected";
                    btn.innerHTML = crossSVG;
                }
            } else {
                // Aucune sélection : afficher le sablier (only if currently pending or undefined)
                if (currentState !== "rejected") {
                    btn.dataset.state = "pending";
                    btn.innerHTML = hourglassSVG;
                }
            }
        }
    });
}

function closeModal() {
    // Check for unsaved changes
    if (hasUnsavedChanges) {
        const confirmClose = confirm("You have unsaved changes. Do you want to save before closing?");
        if (confirmClose) {
            // Save and then close
            saveCurrentPost();
            // Wait a bit for save to complete
            setTimeout(() => {
                hasUnsavedChanges = false;
                initialModalState = null;
                document.body.classList.remove("modal-open");
                document.getElementById("modalOverlay").style.display = "none";
            }, 300);
            return;
        } else {
            // User chose not to save, ask for final confirmation
            const confirmDiscard = confirm("Are you sure you want to discard your changes?");
            if (!confirmDiscard) {
                return; // Don't close
            }
        }
    }

    // Close modal
    hasUnsavedChanges = false;
    initialModalState = null;
    document.body.classList.remove("modal-open");
    document.getElementById("modalOverlay").style.display = "none";
}

function captureModalState() {
    const teamsContainer = document.getElementById("teamsContainer");

    if (!teamsContainer) return null;

    const state = {
        teams: [],
        condition: document.getElementById("condition")?.value || "",
        frozen: postDataCache[currentPostId]?.frozen || false
    };

    // Capturer le niveau de bâtiment si c'est un bâtiment
    if (isBuildingPost(currentPostId)) {
        const buildingLevelSelect = document.getElementById("buildingLevel");
        if (buildingLevelSelect) {
            state.buildingLevel = buildingLevelSelect.value;
        }
    }

    teamsContainer.querySelectorAll(".team-row").forEach(row => {
        const memberSelect = row.querySelector(".member-select");
        const champInputs = row.querySelectorAll(".champ-input");
        const condInput = row.querySelector(".team-condition-value");

        state.teams.push({
            member: memberSelect?.value || "",
            c1: champInputs[0]?.value || "",
            c2: champInputs[1]?.value || "",
            c3: champInputs[2]?.value || "",
            c4: champInputs[3]?.value || "",
            condition: condInput?.value || ""
        });
    });

    return JSON.stringify(state);
}

function trackModalChanges() {
    const modal = document.getElementById("modalOverlay");
    if (!modal || modal.style.display !== "flex") return;

    const currentState = captureModalState();
    if (currentState && initialModalState && currentState !== initialModalState) {
        hasUnsavedChanges = true;
        // Auto-save on change
        autoSaveCurrentPost();
    }
}

function updateStrongholdBonus() {
    const strongholdData = postDataCache["stronghold"] || {};
    const bonusIcon = document.getElementById("strongholdBonusIcon");
    const bonusDisplay = document.getElementById("strongholdBonusDisplay");

    if (!bonusIcon || !bonusDisplay) return;

    // Ne pas afficher le bonus sur le stronghold lui-même
    if (currentPostId === "stronghold") {
        bonusDisplay.classList.remove("active");
        return;
    }

    // Récupérer le bonus sélectionné pour le stronghold
    const conditionId = strongholdData.condition;

    if (conditionId) {
        // Trouver l'image du bonus dans la DB
        const levels = getStrongholdLevels();
        const selectedLevel = levels.find(l => String(l.id) === String(conditionId));

        if (selectedLevel) {
            bonusIcon.src = `/siege/img/stronghold/${selectedLevel.image}.webp`;
            bonusIcon.title = selectedLevel.description || "Stronghold Bonus";
            bonusDisplay.classList.add("active");
            return;
        }
    }

    // Pas de bonus actif, on cache l'élément
    bonusDisplay.classList.remove("active");
}

function updateIrradianceDisplay() {
    const irradianceDisplay = document.getElementById("irradianceDisplay");
    if (!irradianceDisplay) return;

    // Trouver quelles tours de magie irradient le post courant
    const affectingTowers = [];
    for (const [towerId, affectedPosts] of Object.entries(MAGIC_TOWER_IRRADIANCE)) {
        if (affectedPosts.includes(currentPostId)) {
            const towerData = postDataCache[towerId] || {};

            // Les tours de magie stockent leur niveau dans 'condition', pas 'magictower'
            const towerLevelId = towerData.condition;

            if (towerLevelId) {
                // Récupérer l'image depuis la DB
                const levels = getMagicTowerLevels();
                const selectedLevel = levels.find(l => String(l.id) === String(towerLevelId));

                if (selectedLevel) {
                    affectingTowers.push({
                        towerId,
                        image: selectedLevel.image,
                        description: selectedLevel.description || `Magic Tower ${towerId.replace('magictower', '')}`
                    });
                }
            }
        }
    }

    // Vider le container
    irradianceDisplay.innerHTML = "";

    // Afficher les icônes des tours qui irradient ce post
    if (affectingTowers.length > 0) {
        affectingTowers.forEach(tower => {
            const icon = document.createElement("img");
            icon.className = "irradiance-display-icon";
            icon.src = `/siege/img/magictower/${tower.image}.webp`;
            icon.title = tower.description;
            irradianceDisplay.appendChild(icon);
        });
        irradianceDisplay.classList.add("active");
    } else {
        irradianceDisplay.classList.remove("active");
    }
}

function updateFreezeButton(isFrozen) {
    const btn = document.getElementById("freezePostBtn");
    const icon = document.getElementById("freezeIcon");
    const label = document.getElementById("freezeLabel");

    if (isFrozen) {
        btn.classList.add("frozen");
        icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
        label.textContent = "Locked";
        btn.title = "Unlock this post";
    } else {
        btn.classList.remove("frozen");
        icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>`;
        label.textContent = "Lock";
        btn.title = "Lock this post";
    }

    // Update modal title icon
    updateModalTitleIcon(isFrozen);
}

function updateModalTitleIcon(isFrozen) {
    const modalTitle = document.getElementById("modalTitle");
    if (!modalTitle) return;

    const lockIcon = isFrozen
        ? '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 8px;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>'
        : '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 8px;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>';

    const currentText = modalTitle.textContent;
    modalTitle.innerHTML = lockIcon + currentText;
}

function applyFreezeState(isFrozen) {
    const modal = document.querySelector(".modal");
    const addTeamBtn = document.getElementById("addTeamBtn");

    if (isFrozen) {
        // Désactiver tous les inputs et boutons d'édition
        modal.querySelectorAll("input, select, .champ-input").forEach(el => el.disabled = true);
        modal.querySelectorAll(".move-team-btn, .clear-team-btn, .delete-team-btn, .transfer-team-btn, .clear-champ-btn, .condition-toggle, .team-cond-btn").forEach(btn => btn.disabled = true);

        // Disable drag & drop
        modal.querySelectorAll('[draggable="true"]').forEach(el => {
            el.draggable = false;
            el.style.cursor = 'not-allowed';
            el.style.opacity = '0.6';
        });

        // Disable champion slots (autocomplete)
        modal.querySelectorAll('.champ-slot').forEach(slot => {
            slot.style.pointerEvents = 'none';
            slot.style.opacity = '0.6';
        });

        if (addTeamBtn) addTeamBtn.disabled = true;

        modal.classList.add("frozen-post");
    } else {
        // Réactiver tous les inputs et boutons
        modal.querySelectorAll("input, select, .champ-input").forEach(el => el.disabled = false);
        modal.querySelectorAll(".move-team-btn, .clear-team-btn, .delete-team-btn, .transfer-team-btn, .clear-champ-btn, .condition-toggle, .team-cond-btn").forEach(btn => btn.disabled = false);

        // Re-enable drag & drop
        modal.querySelectorAll('[draggable="false"]').forEach(el => {
            el.draggable = true;
            el.style.cursor = '';
            el.style.opacity = '';
        });

        // Re-enable champion slots
        modal.querySelectorAll('.champ-slot').forEach(slot => {
            slot.style.pointerEvents = '';
            slot.style.opacity = '';
        });

        if (addTeamBtn) addTeamBtn.disabled = false;

        modal.classList.remove("frozen-post");

        // Re-update move buttons pour les états corrects
        updateMoveButtons();
    }

    // Apply team-specific locks (validated/rejected teams) - do this regardless of freeze state
    // But only if the post is not frozen (otherwise everything is already disabled)
    if (!isFrozen) {
        applyTeamSelectionLocks();
    }
}

function applyTeamSelectionLocks() {
    // Only for regular posts (not towers/shrines)
    const postEl = currentPostId ? document.getElementById(currentPostId) : null;
    const postType = postEl ? postEl.dataset.type : "post";

    if (postType !== "post") return;

    const teamsContainer = document.getElementById("teamsContainer");
    if (!teamsContainer) return;

    const teamRows = teamsContainer.querySelectorAll(".team-row");

    teamRows.forEach(row => {
        const selectBtn = row.querySelector(".team-select-btn");
        if (!selectBtn) return;

        const state = selectBtn.dataset.state;

        // If team is selected (validated) or rejected, disable ALL editing
        if (state === "selected" || state === "rejected") {
            // Disable champion slots
            row.querySelectorAll(".champ-slot").forEach(slot => {
                slot.style.pointerEvents = "none";
                slot.style.opacity = "0.6";

                // Disable the autocomplete input inside
                const input = slot.querySelector(".champ-input");
                if (input) {
                    input.disabled = true;
                }
            });

            // Disable ALL buttons (move, delete, clear, transfer, condition)
            row.querySelectorAll(".move-team-btn, .delete-team-btn, .clear-team-btn, .clear-champ-btn, .transfer-dropdown-toggle, .team-cond-btn").forEach(btn => {
                btn.disabled = true;
                btn.style.pointerEvents = "none";
                btn.style.opacity = "0.5";
            });

            // Disable drag & drop on champions
            row.querySelectorAll('[draggable="true"]').forEach(el => {
                el.draggable = false;
                el.style.cursor = 'not-allowed';
            });

            // Disable member select
            const memberSelect = row.querySelector(".member-select");
            if (memberSelect) {
                memberSelect.disabled = true;
                memberSelect.style.opacity = "0.6";
            }
        } else {
            // Team is pending - ensure editing is allowed
            row.querySelectorAll(".champ-slot").forEach(slot => {
                slot.style.pointerEvents = "";
                slot.style.opacity = "";

                const input = slot.querySelector(".champ-input");
                if (input) {
                    input.disabled = false;
                }
            });

            // Re-enable buttons
            row.querySelectorAll(".move-team-btn, .delete-team-btn, .clear-team-btn, .clear-champ-btn, .transfer-dropdown-toggle, .team-cond-btn").forEach(btn => {
                btn.disabled = false;
                btn.style.pointerEvents = "";
                btn.style.opacity = "";
            });

            // Re-enable drag & drop
            row.querySelectorAll('[draggable="false"]').forEach(el => {
                el.draggable = true;
                el.style.cursor = '';
            });

            // Re-enable member select
            const memberSelect = row.querySelector(".member-select");
            if (memberSelect) {
                memberSelect.disabled = false;
                memberSelect.style.opacity = "";
            }
        }
    });
}

function toggleFreezePost() {
    if (!currentRoomId || !currentPostId) return;

    const data = postDataCache[currentPostId] || {};
    const newFrozenState = !(data.frozen || false);

    data.frozen = newFrozenState;

    if (isViewer()) {
        alert("Cannot freeze/unfreeze in viewer mode.");
        return;
    }

    const r = ref(db, `rooms/${currentRoomId}/siege/${currentPostId}/frozen`);
    set(r, newFrozenState)
        .then(() => {
            updateFreezeButton(newFrozenState);
            applyFreezeState(newFrozenState);
            updatePostConditionsOnMap(currentPostId);  // Masquer/afficher les icônes sur la carte
            updateTeamsCountOnMap(currentPostId);  // Update team count and hourglass
            setStatus(newFrozenState ? "Post locked ✔" : "Post unlocked ✔");
        })
        .catch(err => {
            console.error(err);
            setStatus("Error: " + err.message, true);
        });
}

function transferTeamToPost(teamRow, targetPostId) {
    if (!currentRoomId || !currentPostId || !targetPostId) return;

    // Extraire les données de la team à partir de la row
    const memberInput = teamRow.querySelector(".member-select");
    const champInputs = teamRow.querySelectorAll(".champ-input");
    const condInput = teamRow.querySelector(".team-condition-value");

    const teamData = {
        member: memberInput ? memberInput.value.trim() : "",
        c1: champInputs[0] ? champInputs[0].value.trim() : "",
        c2: champInputs[1] ? champInputs[1].value.trim() : "",
        c3: champInputs[2] ? champInputs[2].value.trim() : "",
        c4: champInputs[3] ? champInputs[3].value.trim() : "",
        condition: condInput ? condInput.value.trim() : ""
    };

    // Récupérer les teams du poste source
    const sourceData = postDataCache[currentPostId] || {};
    const sourceTeams = Array.isArray(sourceData.teams) ? [...sourceData.teams] : [];

    // Trouver l'index de la team dans le DOM pour la supprimer
    const teamsContainer = document.getElementById("teamsContainer");
    const allRows = Array.from(teamsContainer.querySelectorAll(".team-row"));
    const teamIndex = allRows.indexOf(teamRow);

    if (teamIndex !== -1 && teamIndex < sourceTeams.length) {
        sourceTeams.splice(teamIndex, 1);
    }

    // Récupérer les teams du poste de destination
    const targetData = postDataCache[targetPostId] || {};
    const targetTeams = Array.isArray(targetData.teams) ? [...targetData.teams] : [];
    targetTeams.push(teamData);

    // Check viewer mode
    if (isViewer()) {
        alert("Cannot transfer teams in viewer mode.");
        return;
    }

    // Sauvegarder les deux postes
    const sourceRef = ref(db, `rooms/${currentRoomId}/siege/${currentPostId}/teams`);
    const targetRef = ref(db, `rooms/${currentRoomId}/siege/${targetPostId}/teams`);

    Promise.all([
        set(sourceRef, sourceTeams),
        set(targetRef, targetTeams)
    ])
        .then(() => {
            setStatus(`Team transférée vers ${getPostLabel(targetPostId)} ✔`);
            teamRow.remove();
            updateMoveButtons();
        })
        .catch(err => {
            console.error(err);
            setStatus("Erreur lors du transfert : " + err.message, true);
        });
}

function renderConditionsUI(postId, data) {
    const postEl = document.getElementById(postId);
    const toggleBtn = document.getElementById("conditionToggle");
    const currentIcon = document.getElementById("conditionCurrentIcon");
    const hiddenInput = document.getElementById("condition");
    const panel = document.getElementById("conditionsPanel");
    const groupEl = document.querySelector(".conditions-group");

    if (!postEl || !groupEl) return;

    const postType = postEl.dataset.type || "post";

    // -----------------------------
    // CASE 1 : POSTS CLASSIQUES → 3 conditions
    // -----------------------------
    panel.classList.remove("open");
    panel.innerHTML = "";

    const panelToggle = document.getElementById("conditionsPanelToggle");
    if (panelToggle) panelToggle.classList.remove("open");

    if (postType === "post") {
        // cacher l'ancien système (un seul toggle)
        if (toggleBtn) toggleBtn.style.display = "none";
        if (currentIcon) currentIcon.style.display = "none";
        if (hiddenInput) hiddenInput.style.display = "none";

        // Afficher le bouton toggle pour les posts classiques
        if (panelToggle) panelToggle.style.display = "inline-flex";

        // s'assurer qu'on a un wrapper pour les 3 slots
        if (!postConditionsSlotsWrapper) {
            postConditionsSlotsWrapper = document.createElement("div");
            postConditionsSlotsWrapper.className = "post-conditions-row";

            for (let i = 0; i < 3; i++) {
                const slot = document.createElement("div");
                slot.className = "post-condition-slot";
                slot.dataset.index = String(i);

                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "condition-toggle bg-post";

                const img = document.createElement("img");
                img.className = "condition-current-icon";

                btn.appendChild(img);

                const valueInput = document.createElement("input");
                valueInput.type = "hidden";
                valueInput.className = "condition-value";

                // Add clear button for condition
                const clearBtn = document.createElement("button");
                clearBtn.type = "button";
                clearBtn.className = "clear-condition-btn";
                clearBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
                clearBtn.title = "Clear condition";

                clearBtn.addEventListener("click", () => {
                    const index = parseInt(slot.dataset.index);
                    valueInput.value = "";
                    img.src = "";
                    img.style.display = "none";

                    // Update data
                    const data = postDataCache[currentPostId] || {};
                    const conditionsArr = Array.isArray(data.conditions) ? data.conditions : [];
                    conditionsArr[index] = "";
                    data.conditions = conditionsArr;
                    postDataCache[currentPostId] = data;
                    saveCurrentPost();
                });

                slot.appendChild(btn);
                slot.appendChild(valueInput);
                slot.appendChild(clearBtn);
                postConditionsSlotsWrapper.appendChild(slot);
            }

            // Insérer dans le conditions-top-row plutôt qu'en premier dans groupEl
            const topRow = groupEl.querySelector(".conditions-top-row");
            if (topRow) {
                topRow.insertBefore(postConditionsSlotsWrapper, topRow.firstChild);
            } else {
                groupEl.insertBefore(postConditionsSlotsWrapper, groupEl.firstChild);
            }
        }

        postConditionsSlotsWrapper.style.display = "";
        if (panel) {
            panel.style.display = "";
        }

        const { orderedTypes, byType } = getConditionsByType();
        panel.innerHTML = "";

        // helper pour retrouver un objet condition par id
        function resolveConditionById(id) {
            id = String(id);
            for (const t of orderedTypes) {
                for (const cond of byType[t]) {
                    if (String(cond.id) === id) return cond;
                }
            }
            return null;
        }

        const conditionsArr = Array.isArray(data.conditions) ? data.conditions : [];
        const slots = postConditionsSlotsWrapper.querySelectorAll(".post-condition-slot");

        currentPostConditionsList = [];

        // initialisation visuelle des 3 slots
        slots.forEach((slot, index) => {
            const btn = slot.querySelector(".condition-toggle");
            const img = slot.querySelector(".condition-current-icon");
            const valueInput = slot.querySelector(".condition-value");

            const existingId = conditionsArr[index] || "";
            const cond = existingId ? resolveConditionById(existingId) : null;

            if (cond) {
                img.src = `/siege/img/conditions/${cond.image}.webp`;
                img.style.display = "block";
                img.title = cond.description || cond.name || "Condition";
                valueInput.value = cond.id;
                currentPostConditionsList[index] = cond;
            } else {
                img.src = `/siege/img/conditions/Condition.webp`;
                img.style.display = "block";
                img.title = "Click to choose a condition";
                valueInput.value = "";
                currentPostConditionsList[index] = null;
            }

            // clic sur le slot → choisir quelle "case" on édite et ouvrir le panel
            btn.onclick = () => {
                activeConditionSlotIndex = index;
                if (!panel.classList.contains("open")) {
                    panel.classList.add("open");
                    const toggle = document.getElementById("conditionsPanelToggle");
                    if (toggle) toggle.classList.add("open");
                }
            };

            // Drag & Drop sur les slots
            slot.addEventListener("dragover", (e) => {
                e.preventDefault();
                slot.classList.add("drag-over");
            });

            slot.addEventListener("dragleave", () => {
                slot.classList.remove("drag-over");
            });

            slot.addEventListener("drop", (e) => {
                e.preventDefault();
                slot.classList.remove("drag-over");

                const conditionId = e.dataTransfer.getData("conditionId");
                const conditionImage = e.dataTransfer.getData("conditionImage");
                const conditionTitle = e.dataTransfer.getData("conditionTitle");

                if (conditionId) {
                    // Mettre à jour le slot avec la condition droppée
                    valueInput.value = conditionId;
                    img.src = `/siege/img/conditions/${conditionImage}.webp`;
                    img.title = conditionTitle || "Condition";

                    // Trouver la condition complète pour la stocker
                    const { orderedTypes, byType } = getConditionsByType();
                    let foundCond = null;
                    for (const t of orderedTypes) {
                        for (const c of byType[t]) {
                            if (String(c.id) === String(conditionId)) {
                                foundCond = c;
                                break;
                            }
                        }
                        if (foundCond) break;
                    }

                    currentPostConditionsList[index] = foundCond;

                    // Sauvegarder (le panel reste ouvert)
                    saveCurrentPost();
                }
            });
        });

        // construire le panel unique de conditions
        orderedTypes.forEach(typeKey => {
            const row = document.createElement("div");
            row.className = "condition-row";

            const iconsWrapper = document.createElement("div");
            iconsWrapper.className = "condition-row-icons";

            byType[typeKey].forEach(cond => {
                const icon = document.createElement("img");
                icon.src = `/siege/img/conditions/${cond.image}.webp`;
                icon.className = "condition-icon";
                icon.title = cond.description || cond.name;
                icon.draggable = true;
                icon.dataset.conditionId = cond.id;

                // Drag start
                icon.addEventListener("dragstart", (e) => {
                    e.dataTransfer.setData("conditionId", cond.id);
                    e.dataTransfer.setData("conditionImage", cond.image);
                    e.dataTransfer.setData("conditionTitle", cond.description || cond.name);
                    icon.style.opacity = "0.5";
                });

                icon.addEventListener("dragend", () => {
                    icon.style.opacity = "1";
                });

                icon.addEventListener("click", () => {
                    const slots = postConditionsSlotsWrapper.querySelectorAll(".post-condition-slot");
                    const slot = slots[activeConditionSlotIndex];
                    if (!slot) return;

                    const img = slot.querySelector(".condition-current-icon");
                    const valueInput = slot.querySelector(".condition-value");

                    // Si on clique sur la même condition, on la retire
                    if (valueInput.value === String(cond.id)) {
                        valueInput.value = "";
                        img.src = `/siege/img/conditions/Condition.webp`;
                        img.title = "Click to choose a condition";
                        currentPostConditionsList[activeConditionSlotIndex] = null;
                    } else {
                        // Sinon on l'ajoute
                        valueInput.value = cond.id;
                        img.src = `/siege/img/conditions/${cond.image}.webp`;
                        img.title = cond.description || cond.name || "Condition";
                        currentPostConditionsList[activeConditionSlotIndex] = cond;
                    }

                    saveCurrentPost(); // on sauvegarde directement le post-level
                });

                iconsWrapper.appendChild(icon);
            });

            row.appendChild(iconsWrapper);
            panel.appendChild(row);
        });

        return;
    }

    // -----------------------------
    // CASE 2 : STRONGHOLD / DEFENSE / MAGIC / AUTRES → ancien système 1 condition
    // -----------------------------
    // on masque la bar "3 slots" si elle existe
    if (postConditionsSlotsWrapper) {
        postConditionsSlotsWrapper.style.display = "none";
    }

    // Cacher le bouton toggle pour les tours/stronghold
    if (panelToggle) panelToggle.style.display = "none";

    panel.classList.remove("open");
    panel.innerHTML = "";
    panel.style.display = "";

    if (toggleBtn) toggleBtn.style.display = "";
    if (currentIcon) currentIcon.style.display = "";
    if (hiddenInput) hiddenInput.style.display = "";

    if (!toggleBtn || !currentIcon || !hiddenInput || !panel) return;

    const postTypeStrong = postType;

    // STRONGHOLD
    if (postTypeStrong === "stronghold") {
        groupEl.style.display = "";
        toggleBtn.className = "condition-toggle bg-stronghold";
        renderStrongholdUI(panel, toggleBtn, currentIcon, hiddenInput, data.condition || "");
        return;
    }

    // DEFENSE TOWER
    if (postTypeStrong === "defensetower") {
        groupEl.style.display = "";
        toggleBtn.className = "condition-toggle bg-defensetower";
        renderDefenseTowerUI(panel, toggleBtn, currentIcon, hiddenInput, data.condition || "");
        return;
    }

    // MAGIC TOWER
    if (postTypeStrong === "magictower") {
        groupEl.style.display = "";
        toggleBtn.className = "condition-toggle bg-magictower";
        renderMagicTowerUI(panel, toggleBtn, currentIcon, hiddenInput, data.condition || "");
        return;
    }

    // AUCUNE CONDITION pour shrines / autres types non "post"
    if (postTypeStrong !== "post") {
        groupEl.style.display = "none";
        hiddenInput.value = "";
        return;
    }
}

// Auto-save with debounce
let autoSaveTimeout = null;
function autoSaveCurrentPost() {
    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = setTimeout(() => {
        // Don't save if user is currently typing in an input
        const activeElement = document.activeElement;
        if (activeElement && (
            activeElement.classList.contains('champ-input') ||
            activeElement.tagName === 'INPUT' ||
            activeElement.tagName === 'SELECT'
        )) {
            // Retry after another delay
            autoSaveCurrentPost();
            return;
        }
        saveCurrentPost();
    }, 500); // 500ms debounce
}

function saveCurrentPost() {
    if (!currentRoomId) {
        setStatus("Join or create a room first.", true);
        return;
    }
    if (!currentPostId) {
        setStatus("Choose a post on the map.", true);
        return;
    }

    const teams = getTeamsFromModal();
    const postEl = document.getElementById(currentPostId);
    const postType = postEl ? postEl.dataset.type : "post";

    let data = { teams };

    if (postType === "post") {
        // récupérer les 3 conditions du post
        const slots = postConditionsSlotsWrapper
            ? postConditionsSlotsWrapper.querySelectorAll(".condition-value")
            : [];
        const conditions = Array.from(slots)
            .map(input => input.value.trim())
            .filter(v => v !== "");

        data.conditions = conditions;
    } else {
        const condition = document.getElementById("condition").value;
        data.condition = condition;

        // Sauvegarder le niveau de bâtiment si c'est un bâtiment
        if (isBuildingPost(currentPostId)) {
            const buildingLevelSelect = document.getElementById("buildingLevel");
            if (buildingLevelSelect) {
                data.buildingLevel = parseInt(buildingLevelSelect.value);
            }
        }
    }

    // Check if viewer mode
    if (isViewer()) {
        setStatus("Cannot save in viewer mode.", true);
        alert("You are in viewer mode. Cannot save changes.");
        return;
    }

    const r = ref(db, `rooms/${currentRoomId}/siege/${currentPostId}`);
    set(r, data)
        .then(() => {
            setStatus("✔ Saved", false);
            // Reset unsaved changes flag
            hasUnsavedChanges = false;
            // Update initial state to current state
            initialModalState = captureModalState();

            updateSummaryTable();
            // Si on vient de sauvegarder le stronghold, mettre à jour le bonus sur tous les modals ouverts
            if (currentPostId === "stronghold") {
                updateStrongholdBonus();
            }

            // Si on vient de sauvegarder une tour de magie, mettre à jour l'irradiance
            if (currentPostId.startsWith("magictower")) {
                updateIrradianceDisplay();
            }
        })
        .catch(err => {
            console.error(err);
            setStatus("Save Error : " + err.message, true);
        });
}

function getPostLabel(postId) {
    return postId.replace("post", "Post ").replace("magictower", "Magic Tower ").replace("defensetower", "Defense Tower ").replace("manashrine", "Mana Shrine ").replace("stronghold", "Stronghold");
}

function openPostFromSummary(postId, memberName) {
    // on ouvre le modal normalement
    openModal(postId);

    // on attend que fillModalFromData ait généré toutes les teams
    setTimeout(() => {
        const teamsContainer = document.getElementById("teamsContainer");
        const rows = teamsContainer.querySelectorAll(".team-row");

        for (const row of rows) {
            const mInput = row.querySelector(".member-select");
                if (!mInput) continue;

                if (mInput.value.trim().toLowerCase() === memberName.toLowerCase()) {
                // scroll automatique vers la bonne team
                row.scrollIntoView({ behavior: "smooth", block: "center" });

                // optionnel : highlight
                row.style.outline = "2px solid #00c9ff";
                setTimeout(() => row.style.outline = "", 1200);

                break;
            }
        }
    }, 80); // léger délai le temps que le modal génère le DOM
}

function addDragDropToToggleBtn(toggleBtn, panel, currentIcon, hiddenInput, folder) {
    // Drag & Drop sur le toggle button
    toggleBtn.addEventListener("dragover", (e) => {
        e.preventDefault();
        toggleBtn.classList.add("drag-over");
    });

    toggleBtn.addEventListener("dragleave", () => {
        toggleBtn.classList.remove("drag-over");
    });

    toggleBtn.addEventListener("drop", (e) => {
        e.preventDefault();
        toggleBtn.classList.remove("drag-over");

        const conditionId = e.dataTransfer.getData("conditionId");
        const conditionImage = e.dataTransfer.getData("conditionImage");
        const conditionFolder = e.dataTransfer.getData("conditionFolder");

        if (conditionId && conditionFolder === folder) {
            hiddenInput.value = conditionId;
            currentIcon.src = `/siege/img/${folder}/${conditionImage}.webp`;

            // Mettre à jour la sélection visuelle
            panel.querySelectorAll(".condition-icon.selected").forEach(el => {
                el.classList.remove("selected");
            });
            const droppedIcon = panel.querySelector(`.condition-icon[data-condition-id="${conditionId}"]`);
            if (droppedIcon) droppedIcon.classList.add("selected");

            saveCurrentPost();
        }
    });
}

function getStrongholdLevels() {
    if (!siegeDB) return [];

    try {
        const stmt = siegeDB.prepare(
            "SELECT id, level, image, description FROM stronghold ORDER BY level ASC;"
        );
        const levels = [];
        while (stmt.step()) {
            levels.push(stmt.getAsObject());
        }
        stmt.free();
        return levels; // ex: [{id:1, level:1,...}, {id:2, level:2,...}, {id:3,...}]
    } catch (e) {
        console.error("Erreur getStrongholdLevels", e);
        return [];
    }
}

function renderStrongholdUI(panel, toggleBtn, currentIcon, hiddenInput, currentValue) {
    const levels = getStrongholdLevels(); // 18 lignes SQL
    panel.innerHTML = "";

    // === 1) Grouper par niveau ===
    const grouped = {};
    levels.forEach(lvl => {
        if (!grouped[lvl.level]) grouped[lvl.level] = [];
        grouped[lvl.level].push(lvl);
    });

// === 2) Déterminer l'élément actuellement sélectionné ===

// currentValue = valeur stockée dans Firebase
// Elle peut être soit un ID (nouveau système), soit un LEVEL (ancien système)
let selected = null;

// 1) Essayer de matcher sur l'id
selected = levels.find(l => String(l.id) === String(currentValue));

// 2) Sinon l'ancien système stockait le "level", donc on essaye ça
if (!selected) {
    selected = levels.find(l => String(l.level) === String(currentValue));
}


    if (selected) {
        currentIcon.src = `/siege/img/stronghold/${selected.image}.webp`;
        currentIcon.title = selected.description || "";
        hiddenInput.value = selected.id;
    } else {
        currentIcon.src = `/siege/img/stronghold/Stronghold.webp`;
        currentIcon.title = "Choose a Stronghold level";
        hiddenInput.value = "";
    }

    // === 3) Créer 1 ligne par level ===
    Object.keys(grouped).sort((a,b)=>a-b).forEach(level => {

        const row = document.createElement("div");
        row.className = "condition-row";

        // conteneur pour les 6 icônes
        const iconsWrapper = document.createElement("div");
        iconsWrapper.className = "condition-row-icons";

        grouped[level].forEach(lvl => {
            const icon = document.createElement("img");
            icon.src = `/siege/img/stronghold/${lvl.image}.webp`;
            icon.className = "condition-icon";
            icon.title = lvl.description || "";
            icon.draggable = true;
            icon.dataset.conditionId = lvl.id;

            if (selected && lvl.id === selected.id) icon.classList.add("selected");

            // Drag start
            icon.addEventListener("dragstart", (e) => {
                e.dataTransfer.setData("conditionId", lvl.id);
                e.dataTransfer.setData("conditionImage", lvl.image);
                e.dataTransfer.setData("conditionTitle", lvl.description);
                e.dataTransfer.setData("conditionFolder", "stronghold");
                icon.style.opacity = "0.5";
            });

            icon.addEventListener("dragend", () => {
                icon.style.opacity = "1";
            });

           icon.addEventListener("click", () => {
                panel.querySelectorAll(".condition-icon.selected").forEach(el => {
                    el.classList.remove("selected");
                });

                if (String(hiddenInput.value) === String(lvl.id)) {
                    hiddenInput.value = "";
                    currentIcon.src = `/siege/img/stronghold/Stronghold.webp`;

                    panel.classList.remove("open");

                    saveCurrentPost();
                    return;
                }

                hiddenInput.value = lvl.id;

                icon.classList.add("selected");
                currentIcon.src = `/siege/img/stronghold/${lvl.image}.webp`;

                panel.classList.remove("open");

                saveCurrentPost();
            });

            iconsWrapper.appendChild(icon);
        });

        row.appendChild(iconsWrapper);
        panel.appendChild(row);
    });

    toggleBtn.onclick = () => panel.classList.toggle("open");
    addDragDropToToggleBtn(toggleBtn, panel, currentIcon, hiddenInput, "stronghold");
}

function getDefenseTowerLevels() {
    if (!siegeDB) return [];

    try {
        const stmt = siegeDB.prepare(
            "SELECT id, level, image, description FROM defensetower ORDER BY level ASC;"
        );
        const levels = [];
        while (stmt.step()) {
            levels.push(stmt.getAsObject());
        }
        stmt.free();
        return levels;
    } catch (e) {
        console.error("Erreur getDefenseTowerLevels", e);
        return [];
    }
}

function renderDefenseTowerUI(panel, toggleBtn, currentIcon, hiddenInput, currentValue) {
    const levels = getDefenseTowerLevels();
    panel.innerHTML = "";

    // 1) Grouper par niveau
    const grouped = {};
    levels.forEach(lvl => {
        if (!grouped[lvl.level]) grouped[lvl.level] = [];
        grouped[lvl.level].push(lvl);
    });

    // 2) Déterminer l’élément sélectionné
    let selected = null;

    // nouvelle config par ID
    selected = levels.find(l => String(l.id) === String(currentValue));

    // ancienne config par LEVEL (fallback)
    if (!selected) {
        selected = levels.find(l => String(l.level) === String(currentValue));
    }

    // icône affichée dans le bouton
    if (selected) {
        currentIcon.src = `/siege/img/defensetower/${selected.image}.webp`;
        currentIcon.title = selected.description || "";
        hiddenInput.value = selected.id;
    } else {
        currentIcon.src = `/siege/img/defensetower/DefenseTower.webp`;
        currentIcon.title = "Choose a Defense Tower condition";
        hiddenInput.value = "";
    }

    // 3) Créer 1 ligne par level
    Object.keys(grouped).sort((a,b)=>a-b).forEach(level => {
        const row = document.createElement("div");
        row.className = "condition-row";

        const iconsWrapper = document.createElement("div");
        iconsWrapper.className = "condition-row-icons";

        grouped[level].forEach(lvl => {
            const icon = document.createElement("img");
            icon.src = `/siege/img/defensetower/${lvl.image}.webp`;
            icon.className = "condition-icon";
            icon.title = lvl.description || "";
            icon.draggable = true;
            icon.dataset.conditionId = lvl.id;

            if (selected && lvl.id === selected.id) {
                icon.classList.add("selected");
            }

            // Drag start
            icon.addEventListener("dragstart", (e) => {
                e.dataTransfer.setData("conditionId", lvl.id);
                e.dataTransfer.setData("conditionImage", lvl.image);
                e.dataTransfer.setData("conditionTitle", lvl.description);
                e.dataTransfer.setData("conditionFolder", "defensetower");
                icon.style.opacity = "0.5";
            });

            icon.addEventListener("dragend", () => {
                icon.style.opacity = "1";
            });

            icon.addEventListener("click", () => {

                // retirer anciennes sélections
                panel.querySelectorAll(".condition-icon.selected")
                    .forEach(el => el.classList.remove("selected"));

                // toggle off
                if (String(hiddenInput.value) === String(lvl.id)) {
                    hiddenInput.value = "";
                    currentIcon.src = `/siege/img/defensetower/DefenseTower.webp`;

                    panel.classList.remove("open");
                    saveCurrentPost();
                    return;
                }

                // nouvelle sélection
                hiddenInput.value = lvl.id;
                icon.classList.add("selected");
                currentIcon.src = `/siege/img/defensetower/${lvl.image}.webp`;

                // fermer après clic
                panel.classList.remove("open");

                saveCurrentPost();
            });

            iconsWrapper.appendChild(icon);
        });

        row.appendChild(iconsWrapper);
        panel.appendChild(row);
    });

    toggleBtn.onclick = () => panel.classList.toggle("open");
    addDragDropToToggleBtn(toggleBtn, panel, currentIcon, hiddenInput, "defensetower");
}

function getMagicTowerLevels() {
    if (!siegeDB) return [];

    try {
        const stmt = siegeDB.prepare(
            "SELECT id, level, image, description FROM magictower ORDER BY level ASC;"
        );
        const levels = [];
        while (stmt.step()) {
            levels.push(stmt.getAsObject());
        }
        stmt.free();
        return levels;
    } catch (e) {
        console.error("Erreur getMagicTowerLevels", e);
        return [];
    }
}

function renderMagicTowerUI(panel, toggleBtn, currentIcon, hiddenInput, currentValue) {
    const levels = getMagicTowerLevels();
    panel.innerHTML = "";

    // 1) Grouper par niveau
    const grouped = {};
    levels.forEach(lvl => {
        if (!grouped[lvl.level]) grouped[lvl.level] = [];
        grouped[lvl.level].push(lvl);
    });

    // 2) Déterminer sélection
    let selected = levels.find(l => String(l.id) === String(currentValue));

    if (!selected) {
        selected = levels.find(l => String(l.level) === String(currentValue));
    }

    // icône affichée
    if (selected) {
        currentIcon.src = `/siege/img/magictower/${selected.image}.webp`;
        currentIcon.title = selected.description || "";
        hiddenInput.value = selected.id;
    } else {
        currentIcon.src = `/siege/img/magictower/MagicTower.webp`;
        currentIcon.title = "Choose a Magic Tower condition";
        hiddenInput.value = "";
    }

    // 3) Construire lignes
    Object.keys(grouped).sort((a,b)=>a-b).forEach(level => {
        const row = document.createElement("div");
        row.className = "condition-row";

        const iconsWrapper = document.createElement("div");
        iconsWrapper.className = "condition-row-icons";

        grouped[level].forEach(lvl => {
            const icon = document.createElement("img");
            icon.src = `/siege/img/magictower/${lvl.image}.webp`;
            icon.className = "condition-icon";
            icon.title = lvl.description || "";
            icon.draggable = true;
            icon.dataset.conditionId = lvl.id;

            if (selected && lvl.id === selected.id) {
                icon.classList.add("selected");
            }

            // Drag start
            icon.addEventListener("dragstart", (e) => {
                e.dataTransfer.setData("conditionId", lvl.id);
                e.dataTransfer.setData("conditionImage", lvl.image);
                e.dataTransfer.setData("conditionTitle", lvl.description);
                e.dataTransfer.setData("conditionFolder", "magictower");
                icon.style.opacity = "0.5";
            });

            icon.addEventListener("dragend", () => {
                icon.style.opacity = "1";
            });

            icon.addEventListener("click", () => {

                // Enlever anciennes sélections
                panel.querySelectorAll(".condition-icon.selected")
                    .forEach(el => el.classList.remove("selected"));

                // toggle OFF
                if (String(hiddenInput.value) === String(lvl.id)) {
                    hiddenInput.value = "";
                    currentIcon.src = `/siege/img/magictower/MagicTower.webp`;

                    panel.classList.remove("open");
                    saveCurrentPost();
                    return;
                }

                // nouvelle sélection
                hiddenInput.value = lvl.id;
                icon.classList.add("selected");
                currentIcon.src = `/siege/img/magictower/${lvl.image}.webp`;

                panel.classList.remove("open");
                saveCurrentPost();
            });

            iconsWrapper.appendChild(icon);
        });

        row.appendChild(iconsWrapper);
        panel.appendChild(row);
    });

    toggleBtn.onclick = () => panel.classList.toggle("open");
    addDragDropToToggleBtn(toggleBtn, panel, currentIcon, hiddenInput, "magictower");
}


function updatePostConditionsOnMap(postId) {
    const postEl = document.getElementById(postId);
    if (!postEl || postEl.dataset.type !== "post") return;

    const data = postDataCache[postId] || {};
    const conditionsDiv = postEl.querySelector(".post-conditions");
    if (!conditionsDiv) return;

    // Masquer si le poste est locked et ajouter la classe pour ajuster le label
    if (data.frozen) {
        conditionsDiv.classList.add("hidden");
        postEl.classList.add("post-frozen");
        return;
    } else {
        conditionsDiv.classList.remove("hidden");
        postEl.classList.remove("post-frozen");
    }

    const conditionsArr = Array.isArray(data.conditions) ? data.conditions : [];
    const icons = conditionsDiv.querySelectorAll(".post-cond-icon");

    icons.forEach((icon, index) => {
        const condId = conditionsArr[index];

        if (condId) {
            // Trouver la condition dans la DB
            const { orderedTypes, byType } = getConditionsByType();
            let condRow = null;

            for (const t of orderedTypes) {
                for (const c of byType[t]) {
                    if (String(c.id) === String(condId)) {
                        condRow = c;
                        break;
                    }
                }
                if (condRow) break;
            }

            if (condRow) {
                icon.src = `/siege/img/conditions/${condRow.image}.webp`;
                icon.title = condRow.description || condRow.name || "";
            } else {
                icon.src = "/siege/img/conditions/Condition.webp";
                icon.title = "";
            }
        } else {
            // Pas de condition sélectionnée → fallback
            icon.src = "/siege/img/conditions/Condition.webp";
            icon.title = "";
        }
    });
}

function updateTeamsCountOnMap(postId) {
    const postEl = document.getElementById(postId);
    if (!postEl) return;

    const countDiv = postEl.querySelector(".post-teams-count");
    if (!countDiv) return;

    const data = postDataCache[postId] || {};
    const teams = Array.isArray(data.teams) ? data.teams : [];

    // Compter les équipes qui ont au moins un champion assigné
    const teamsWithMembers = teams.filter(team => {
        return team.c1 || team.c2 || team.c3 || team.c4;
    });

    const count = teamsWithMembers.length;

    // Check if this is a regular post (not tower/shrine/stronghold)
    const postType = postEl.dataset.type;
    const isRegularPost = postType === "post";
    const isBuilding = isBuildingPost(postId);

    // Check if we need to show hourglass (pending arbitration)
    // Conditions: regular post, more than 1 team, no team is validated
    const hasMultipleTeams = count > 1;
    const hasValidatedTeam = isRegularPost && teams.some(team => team.selected === true);
    const showHourglass = isRegularPost && hasMultipleTeams && !hasValidatedTeam;

    // For regular posts, show "x/1" format
    if (isRegularPost) {
        // Set count with optional hourglass icon (red to indicate action needed)
        if (showHourglass) {
            countDiv.innerHTML = `${count}/1 <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-left: 2px;"><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/><path d="M7 22v-4.172a2 2 0 0 1 .586-1.414L12 12 7.586 7.414A2 2 0 0 1 7 6.172V2"/></svg>`;
            countDiv.classList.add("alert"); // Red styling
        } else {
            countDiv.textContent = `${count}/1`;

            // Red styling if 0/1 (empty post)
            if (count === 0) {
                countDiv.classList.add("alert");
            } else {
                countDiv.classList.remove("alert");
            }
        }
    } else if (isBuilding) {
        // Pour les bâtiments, afficher X/max avec sablier si dépassement
        const buildingType = getBuildingTypeFromPostId(postId);
        const buildingLevel = data.buildingLevel || 1;
        const maxSlots = getBuildingSlots(buildingType, buildingLevel);

        const exceedsMax = count > maxSlots;

        if (exceedsMax) {
            countDiv.innerHTML = `${count}/${maxSlots} <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-left: 2px;"><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/><path d="M7 22v-4.172a2 2 0 0 1 .586-1.414L12 12 7.586 7.414A2 2 0 0 1 7 6.172V2"/></svg>`;
            countDiv.classList.add("alert"); // Red styling
        } else {
            countDiv.textContent = `${count}/${maxSlots}`;

            // Red styling if 0/max (empty building)
            if (count === 0) {
                countDiv.classList.add("alert");
            } else {
                countDiv.classList.remove("alert");
            }
        }
    } else {
        // For other types (non-building, non-post), keep old format (just the number)
        countDiv.textContent = count;
        countDiv.classList.remove("alert");
    }

    // Ajouter/retirer la classe 'empty' selon le nombre
    if (count === 0) {
        countDiv.classList.add("empty");
    } else {
        countDiv.classList.remove("empty");
    }
}

let globalTooltip = null;

function createTooltipContent(postId) {
    const data = postDataCache[postId] || {};
    const teams = Array.isArray(data.teams) ? data.teams : [];
    const postEl = document.getElementById(postId);
    const postType = postEl ? postEl.dataset.type : "post";

    // Filtrer les équipes qui ont au moins un champion
    const teamsWithMembers = teams.filter(team => {
        return team.member || team.c1 || team.c2 || team.c3 || team.c4;
    });

    if (teamsWithMembers.length === 0) return null;

    const content = document.createElement("div");

    // Titre avec icône lock/unlock
    const title = document.createElement("div");
    title.className = "post-tooltip-title";

    const isFrozen = data.frozen || false;
    const lockIcon = isFrozen
        ? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 6px;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>'
        : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 6px;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>';

    title.innerHTML = lockIcon + getPostLabel(postId);
    content.appendChild(title);

    // Get selected member from filter
    const memberFilter = document.getElementById("memberFilter");
    const selectedMember = memberFilter ? (memberFilter.dataset.value || "") : "";

    // Afficher toutes les équipes
    teamsWithMembers.forEach((team, index) => {
        // Add group separator for buildings (every 3 teams)
        if (postType !== "post" && index > 0 && index % 3 === 0) {
            const separator = document.createElement("div");
            separator.className = "post-tooltip-group-separator";
            content.appendChild(separator);
        }

        const teamDiv = document.createElement("div");
        teamDiv.className = "post-tooltip-team";

        // Highlight if this is the selected member
        if (selectedMember && team.member === selectedMember) {
            teamDiv.style.background = "rgba(212, 175, 55, 0.25)";
            teamDiv.style.borderRadius = "6px";
        }

        // Add hover effect to highlight this line
        teamDiv.addEventListener("mouseenter", () => {
            teamDiv.style.background = "rgba(212, 175, 55, 0.2)";
            teamDiv.style.borderRadius = "6px";
        });
        teamDiv.addEventListener("mouseleave", () => {
            // Restore the highlight if this is the selected member
            if (selectedMember && team.member === selectedMember) {
                teamDiv.style.background = "rgba(212, 175, 55, 0.25)";
                teamDiv.style.borderRadius = "6px";
            } else {
                teamDiv.style.background = "";
                teamDiv.style.borderRadius = "";
            }
        });

        // Pseudo
        const memberSpan = document.createElement("span");
        memberSpan.className = "post-tooltip-member";
        memberSpan.textContent = team.member || `Team ${index + 1}`;
        teamDiv.appendChild(memberSpan);

        // Icône de condition (seulement pour les posts classiques)
        if (postType === "post" && team.condition) {
            const { orderedTypes, byType } = getConditionsByType();
            let condRow = null;

            for (const t of orderedTypes) {
                for (const c of byType[t]) {
                    if (String(c.id) === String(team.condition)) {
                        condRow = c;
                        break;
                    }
                }
                if (condRow) break;
            }

            if (condRow) {
                const condIcon = document.createElement("img");
                condIcon.className = "post-tooltip-cond-icon";
                condIcon.src = `/siege/img/conditions/${condRow.image}.webp`;
                condIcon.title = condRow.description || condRow.name || "";
                teamDiv.appendChild(condIcon);
            }
        }

        // Champions (images carrées)
        const champsDiv = document.createElement("div");
        champsDiv.className = "post-tooltip-champs";

        for (let i = 1; i <= 4; i++) {
            const champName = team["c" + i];

            if (champName && championsDB) {
                const champ = getChampionByNameExact(champName);

                if (champ && champ.image) {
                    const champImg = document.createElement("img");
                    champImg.className = "post-tooltip-champ-img";
                    champImg.src = `/tools/champions-index/img/champions/${champ.image}.webp`;
                    champImg.title = champName;
                    champsDiv.appendChild(champImg);
                } else {
                    const emptySlot = document.createElement("div");
                    emptySlot.className = "post-tooltip-champ-empty";
                    emptySlot.title = "Champion non trouvé";
                    champsDiv.appendChild(emptySlot);
                }
            } else {
                const emptySlot = document.createElement("div");
                emptySlot.className = "post-tooltip-champ-empty";
                champsDiv.appendChild(emptySlot);
            }
        }

        teamDiv.appendChild(champsDiv);
        content.appendChild(teamDiv);
    });

    return content;
}

function showTooltip(postEl, postId) {
    const content = createTooltipContent(postId);
    if (!content) return;

    if (!globalTooltip) {
        globalTooltip = document.createElement("div");
        globalTooltip.className = "post-tooltip";
        document.body.appendChild(globalTooltip);
    }

    globalTooltip.innerHTML = "";
    globalTooltip.appendChild(content);

    const rect = postEl.getBoundingClientRect();
    const tooltipRect = globalTooltip.getBoundingClientRect();

    // Position de base : à droite du point, centré verticalement
    let left = rect.right + 25;
    let top = rect.top + rect.height / 2;
    let transform = "translateY(-100%)";

    // Vérifier si le tooltip dépasse en haut
    const tooltipHalfHeight = tooltipRect.height / 2;
    if (top - tooltipHalfHeight < 0) {
        // Aligner en haut au lieu de centrer
        top = 8;
        transform = "translateY(0)";
    }

    // Vérifier si le tooltip dépasse en bas
    if (top + tooltipHalfHeight > window.innerHeight) {
        // Aligner en bas au lieu de centrer
        top = window.innerHeight - 8;
        transform = "translateY(-100%)";
    }

    // Vérifier si le tooltip dépasse à droite
    if (left + tooltipRect.width > window.innerWidth) {
        // Positionner à gauche du point au lieu de droite
        left = rect.left - tooltipRect.width - 12;
    }

    globalTooltip.style.position = "fixed";
    globalTooltip.style.left = left + "px";
    globalTooltip.style.top = top + "px";
    globalTooltip.style.transform = transform;
    globalTooltip.style.opacity = "1";
}

function hideTooltip() {
    if (globalTooltip) {
        globalTooltip.style.opacity = "0";
    }
}

function updateTooltipOnMap(postId) {
    const postEl = document.getElementById(postId);
    if (!postEl) return;

    // Retirer les anciens listeners
    postEl.removeEventListener("mouseenter", postEl._tooltipMouseEnter);
    postEl.removeEventListener("mouseleave", postEl._tooltipMouseLeave);

    // Créer les nouveaux handlers
    postEl._tooltipMouseEnter = () => showTooltip(postEl, postId);
    postEl._tooltipMouseLeave = hideTooltip;

    // Ajouter les listeners
    postEl.addEventListener("mouseenter", postEl._tooltipMouseEnter);
    postEl.addEventListener("mouseleave", postEl._tooltipMouseLeave);
}

function updateSummaryTable() {
    // Don't load summary table in viewer mode
    if (isViewer()) {
        return;
    }

    const tbody = document.querySelector("#summaryTable tbody");
    tbody.innerHTML = "";

    const rows = [];

    for (const postId of postIds) {
        const data = postDataCache[postId];
        if (!data || !data.teams) continue;

        // Vérifier le type de post
        const postEl = document.getElementById(postId);
        const postType = postEl ? postEl.dataset.type : "post";

        let teamCounter = 0;
        data.teams.forEach((team, i) => {
            if (!team.member) return;

            // Calculer group et team pour les non-posts
            let group = "-";
            let teamNum = i + 1;

            if (postType !== "post") {
                group = Math.floor(teamCounter / 3) + 1;
                teamNum = (teamCounter % 3) + 1;
            }

            rows.push({
                postId,
                member: team.member,
                group: group,
                teamIndex: teamNum,
                teamCondition: team.condition || "",
                selected: team.selected || false,
                c1: team.c1,
                c2: team.c2,
                c3: team.c3,
                c4: team.c4
            });

            teamCounter++;
        });
    }

    // === METTRE À JOUR LE COMPTEUR DE TEAMS DANS LE TITRE ===
    const summaryTitle = document.getElementById("summaryTitle");
    if (summaryTitle) {
        summaryTitle.textContent = `TEAMS (${rows.length})`;
    }

    // ---- Désaturer / Réactiver les icônes de la map ----
    postIds.forEach(pid => {
        const icon = document.querySelector(`#${pid} .post-icon`);
        if (!icon) return;

        const hasTeam = rows.some(r => r.postId === pid);

        if (hasTeam) {
            icon.classList.remove("desaturated");
        } else {
            icon.classList.add("desaturated");
        }
    });

    // Update active header and direction arrow
    document.querySelectorAll("#summaryTable th.sortable").forEach(th => {
        if (th.dataset.sort === summarySortMode) {
            th.classList.add("active");
            th.classList.toggle("desc", summarySortDirection === "desc");
        } else {
            th.classList.remove("active", "desc");
        }
    });

    // TRI
    if (summarySortMode === "member") {
        rows.sort((a, b) => {
            const result = a.member.localeCompare(b.member);
            return summarySortDirection === "desc" ? -result : result;
        });
    }
    else if (summarySortMode === "post") {

        rows.sort((a, b) => {

            const pa = a.postId;
            const pb = b.postId;

            // extraction du numéro si postX
            const na = pa.startsWith("post") ? parseInt(pa.replace("post", "")) : null;
            const nb = pb.startsWith("post") ? parseInt(pb.replace("post", "")) : null;

            let result;
            // si deux postes classiques : tri numérique correct
            if (na !== null && nb !== null) {
                result = na - nb;
            } else {
                // sinon tri alphabétique standard pour towers/shrines/etc
                result = pa.localeCompare(pb);
            }

            return summarySortDirection === "desc" ? -result : result;
        });
    }
    else if (summarySortMode === "conditions") {
        rows.sort((a, b) => {
            // Get condition for each team (only for classic posts, ignore buildings)
            const getConditionName = (row) => {
                const postEl = document.getElementById(row.postId);
                const type = postEl ? postEl.dataset.type : "post";

                // Only consider classic posts, ignore buildings (stronghold, towers, shrines)
                if (type === "post") {
                    // For classic posts, use team condition
                    if (row.teamCondition) {
                        const { orderedTypes, byType } = getConditionsByType();
                        for (const t of orderedTypes) {
                            for (const c of byType[t]) {
                                if (String(c.id) === String(row.teamCondition)) {
                                    return c.name || "";
                                }
                            }
                        }
                    }
                }
                // Buildings return empty string (will be sorted last)
                return "";
            };

            const condA = getConditionName(a);
            const condB = getConditionName(b);
            const result = condA.localeCompare(condB);
            return summarySortDirection === "desc" ? -result : result;
        });
    }

    // Rendu HTML
    rows.forEach(r => {
        const tr = document.createElement("tr");
        tr.dataset.post = r.postId;        // l’ID du poste (ex: post1)
        tr.dataset.member = r.member;      // pour retrouver la bonne team
        const memberData = clanMembers[r.member];
        const hhIcon = memberData && memberData.link 
            ? `<a href="${memberData.link}" target="_blank" class="hh-table-icon">
                <img src="/siege/img/HH.ico" alt="HH" />
            </a>`
            : "";  
            let condIcon = "";

            const postElForRow = document.getElementById(r.postId);
            const typeForRow = postElForRow ? postElForRow.dataset.type : "post";

            // ------------------------------
            // POST CLASSIQUE UNIQUEMENT → condition par team
            // (Les bâtiments n'affichent plus d'icône de condition)
            // ------------------------------
            if (typeForRow === "post") {
                if (r.teamCondition) {
                    // récupérer la condition dans la table CONDITIONS
                    const { orderedTypes, byType } = getConditionsByType();
                    let condRow = null;

                    for (const t of orderedTypes) {
                        for (const c of byType[t]) {
                            if (String(c.id) === String(r.teamCondition)) {
                                condRow = c;
                                break;
                            }
                        }
                        if (condRow) break;
                    }

                    if (condRow) {
                        condIcon = `<img class="summary-cond-icon" src="/siege/img/conditions/${condRow.image}.webp" />`;
                    }
                }
            }
            // Les bâtiments (stronghold, towers, shrines) n'affichent pas d'icône

        // Selection icon (only for classic posts)
        let selIcon = "";
        if (typeForRow === "post") {
            // Check if there's a selected team on this post
            const postTeams = rows.filter(row => row.postId === r.postId);
            const hasSelection = postTeams.some(team => team.selected === true);

            if (r.selected === true) {
                // This team is selected - checkmark (green)
                selIcon = `<svg class="summary-sel-icon selected" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
            } else if (hasSelection) {
                // Another team is selected - cross (red)
                selIcon = `<svg class="summary-sel-icon rejected" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
            } else {
                // No selection yet - hourglass (amber)
                selIcon = `<svg class="summary-sel-icon pending" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/><path d="M7 22v-4.172a2 2 0 0 1 .586-1.414L12 12 7.586 7.586A2 2 0 0 1 7 6.172V2"/></svg>`;
            }
        } else {
            selIcon = "-";
        }

        // Add rejected class if this team is not selected and another is
        if (typeForRow === "post") {
            const postTeams = rows.filter(row => row.postId === r.postId);
            const hasSelection = postTeams.some(team => team.selected === true);
            if (hasSelection && r.selected !== true) {
                tr.classList.add("rejected");
            }
        }

        // Add status icon (lock/unlock) with colors
        const postData = postDataCache[r.postId];
        const isFrozen = postData && postData.frozen;
        const statusIcon = isFrozen
            ? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>'
            : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>';

        tr.innerHTML = `
            <td>${getPostLabel(r.postId)}</td>
            <td class="summary-status-cell">${statusIcon}</td>
            <td class="summary-group-cell">${r.group || "-"}</td>
            <td class="summary-team-cell">${r.teamIndex || "-"}</td>
            <td class="summary-sel-cell">${selIcon}</td>
            <td class="summary-cond-cell">${condIcon}</td>
            <td>${r.member}</td>
            <td class="summary-hh-cell">${hhIcon}</td>
            <td>${r.c1}</td>
            <td>${r.c2}</td>
            <td>${r.c3}</td>
            <td>${r.c4}</td>
        `;
        tbody.appendChild(tr);

        // Empêcher l'ouverture du modal quand on clique sur le lien HellHades
        const hhLink = tr.querySelector(".hh-table-icon");
        if (hhLink) {
            hhLink.addEventListener("click", (e) => {
                e.stopPropagation();
            });
        }

        tr.addEventListener("click", () => {
            openPostFromSummary(r.postId, r.member);
        });
    });
}

// ==================== VIEWER MODE CONTROLS ====================
function applyViewerRestrictions() {
    // Disable all edit buttons and controls
    const disableSelectors = [
        '#saveBtn',
        '#addTeamBtn',
        '#addMemberBtn',
        '#addPresetBtn',
        '#freezePostBtn',
        '.team-delete-btn',
        '.team-freeze-btn',
        '.team-select-btn',
        '.transfer-dropdown-toggle',
        '.transfer-team-btn',
        '.transfer-menu-item',
        '.delete-team-btn',
        '.move-team-btn',
        '.clear-team-btn',
        '.save-preset-btn',
        '.preset-delete-btn',
        '.view-presets-btn',
        '#conditionsPanelToggle',
        '.post-condition-slot',
        '.member-delete-btn',
        '.member-edit-btn',
        'input[type="text"]',
        'input[type="number"]',
        'select',
        '.champ-slot',
        '.team-member-select',
        '.clear-champ-btn'
    ];

    disableSelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => {
            // Exception: keep member filter active in viewer mode
            if (el.id === 'memberFilter') {
                return;
            }
            el.disabled = true;
            el.style.opacity = '0.5';
            el.style.cursor = 'not-allowed';
            el.style.pointerEvents = 'none';
        });
    });

    // Keep champion slots and images fully visible (important for viewing)
    document.querySelectorAll('.champ-slot').forEach(slot => {
        // Override the disabled opacity for the slot itself
        if (slot.style.opacity === '0.5') {
            slot.style.opacity = '1';
        }
    });

    document.querySelectorAll('.champ-slot img').forEach(img => {
        img.style.opacity = '1';
        img.style.cursor = 'default';
        img.style.pointerEvents = 'none';
    });

    // Keep conditions/bonus icons fully visible
    document.querySelectorAll('.condition-icon, .condition-toggle, .condition-current-icon, .stronghold-bonus-icon').forEach(icon => {
        icon.style.opacity = '1';
        icon.style.cursor = 'default';
        icon.style.pointerEvents = 'none';
    });

    // Disable drag and drop
    document.querySelectorAll('[draggable="true"]').forEach(el => {
        el.draggable = false;
        el.style.cursor = 'not-allowed';
    });
}

function disableViewerControls() {
    // Initial disable
    applyViewerRestrictions();

    // Continuously apply restrictions (for dynamically added elements)
    setInterval(() => {
        if (isViewer()) {
            applyViewerRestrictions();
        }
    }, 500);

    // Add viewer mode class to body
    document.body.classList.add('viewer-mode');

    // Add viewer mode indicator with Lucide icon
    const header = document.querySelector('.top-bar');
    if (header && !document.getElementById('viewerModeIndicator')) {
        const indicator = document.createElement('div');
        indicator.id = 'viewerModeIndicator';
        indicator.style.cssText = 'position: fixed; top: 10px; left: 50%; transform: translateX(-50%); background: rgba(245, 158, 11, 0.2); border: 2px solid #f59e0b; color: #f59e0b; padding: 8px 16px; border-radius: 8px; font-weight: 600; z-index: 9999; display: flex; align-items: center; gap: 8px;';
        indicator.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
            </svg>
            <span>VIEWER MODE (Read Only)</span>
        `;
        document.body.appendChild(indicator);
    }
}

function initializeAppWithRoom(roomId) {
    // Show logout button
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.style.display = 'inline-flex';
    }

    // Show admin controls if admin mode
    if (!isViewer()) {
        const adminControls = document.getElementById('adminControls');
        if (adminControls) {
            adminControls.style.display = 'flex';
        }
    }

    // Update all Firebase listeners to use room-based paths
    // The existing listeners will be updated when connectRoom is called
    connectRoom(roomId);
}

// ==================== BLESSINGS DATABASE QUERIES ====================
function getAllBlessings() {
    if (!championsDB) return null;
    try {
        const stmt = championsDB.prepare(
            "SELECT DISTINCT name, section, rarity, image FROM blessings ORDER BY sectionID, rarity, name;"
        );
        const blessings = [];
        while (stmt.step()) {
            blessings.push(stmt.getAsObject());
        }
        stmt.free();
        return blessings;
    } catch (e) {
        console.error("Error loading blessings", e);
        return null;
    }
}

function getBlessingsBySection() {
    const allBlessings = getAllBlessings();
    if (!allBlessings) return [];

    const sectionsArray = [];
    const sectionsMap = {};

    allBlessings.forEach(blessing => {
        if (!sectionsMap[blessing.section]) {
            sectionsMap[blessing.section] = [];
            // Add section to array to preserve order
            sectionsArray.push({
                section: blessing.section,
                blessings: sectionsMap[blessing.section]
            });
        }
        // Only add if not already in array (deduplicate by name)
        if (!sectionsMap[blessing.section].find(b => b.name === blessing.name)) {
            sectionsMap[blessing.section].push(blessing);
        }
    });
    return sectionsArray;
}

function getBlessingDescription(blessingName, level) {
    if (!championsDB || !blessingName || !level) return null;
    try {
        const stmt = championsDB.prepare(
            "SELECT description FROM blessings WHERE name = ? AND level = ? LIMIT 1;"
        );
        stmt.bind([blessingName, String(level)]);
        let desc = null;
        if (stmt.step()) {
            const result = stmt.getAsObject();
            desc = result.description;
        }
        stmt.free();
        return desc;
    } catch (e) {
        console.error("Error getting blessing description", e);
        return null;
    }
}

function getBlessingData(blessingName) {
    if (!championsDB || !blessingName) return null;
    try {
        const stmt = championsDB.prepare(
            "SELECT name, section, rarity, image FROM blessings WHERE name = ? LIMIT 1;"
        );
        stmt.bind([blessingName]);
        let data = null;
        if (stmt.step()) {
            data = stmt.getAsObject();
        }
        stmt.free();
        return data;
    } catch (e) {
        console.error("Error getting blessing data", e);
        return null;
    }
}

// ==================== BLESSING STARS SYSTEM ====================
function createBlessingStars(championName, blessingLevel = 0) {
    const starsContainer = document.createElement("div");
    starsContainer.className = "blessing-stars";

    // Only show stars if champion has a valid rarity (not common/uncommon)
    if (championName) {
        try {
            if (championsDB && Array.isArray(championsDB)) {
                const champ = championsDB.find(c => c.name && c.name.toLowerCase() === championName.toLowerCase());
                if (champ && champ.rarity &&
                    champ.rarity !== "Common" &&
                    champ.rarity !== "Uncommon") {
                    starsContainer.classList.add("visible");
                }
            }
        } catch (err) {
            console.error("Error checking champion rarity for stars:", err);
        }
    }

    // Create 6 stars
    for (let i = 1; i <= 6; i++) {
        const star = document.createElement("div");
        star.className = "blessing-star";
        star.dataset.level = i;

        const starImg = document.createElement("img");
        // Default to pink star, will be updated based on blessing level
        starImg.src = i <= blessingLevel ?
            "/tools/champions-index/img/stars/Star-Awaken.webp" :
            "/tools/champions-index/img/stars/Star-Ascend.webp";
        starImg.alt = `Star ${i}`;

        star.appendChild(starImg);
        starsContainer.appendChild(star);
    }

    return starsContainer;
}

function updateBlessingStars(starsContainer, level) {
    const stars = starsContainer.querySelectorAll(".blessing-star");
    stars.forEach((star, index) => {
        const starImg = star.querySelector("img");
        if (index < level) {
            starImg.src = "/tools/champions-index/img/stars/Star-Awaken.webp";
        } else {
            starImg.src = "/tools/champions-index/img/stars/Star-Ascend.webp";
        }
    });
}

function createBlessingImage(blessingName = null, blessingRarity = null) {
    // Create container for blessing images
    const blessingContainer = document.createElement("div");
    blessingContainer.className = "blessing-img-container";
    blessingContainer.style.display = "none"; // Hidden by default, shown when blessing level > 0
    blessingContainer.title = "Select blessing";
    blessingContainer.style.cursor = "pointer";

    // Background image (rarity)
    const rarityImg = document.createElement("img");
    rarityImg.className = "blessing-rarity-bg";

    // Icon image (blessing icon overlay)
    const iconImg = document.createElement("img");
    iconImg.className = "blessing-icon-overlay";

    // Determine which images to show
    if (blessingName && blessingRarity) {
        // Specific blessing selected
        rarityImg.src = `/tools/champions-index/img/blessings/${blessingRarity}.webp`;

        // Get blessing data to get the image key
        const blessingData = getBlessingData(blessingName);
        if (blessingData && blessingData.image) {
            iconImg.src = `/tools/champions-index/img/blessings/icons/${blessingData.image}.webp`;
        }

        blessingContainer.dataset.blessing = blessingName;
        blessingContainer.dataset.rarity = blessingRarity;
    } else {
        // No blessing selected yet - show Unselected.webp
        rarityImg.src = "/tools/champions-index/img/blessings/Unselected.webp";
        iconImg.style.display = "none";
    }

    blessingContainer.appendChild(rarityImg);
    blessingContainer.appendChild(iconImg);

    // Click handler to open blessing selection modal
    blessingContainer.addEventListener("click", (e) => {
        e.stopPropagation();
        openBlessingModal(blessingContainer);
    });

    return blessingContainer;
}

function updateBlessingImageVisibility(visual, blessingLevel) {
    const blessingContainer = visual.querySelector(".blessing-img-container");
    if (blessingContainer) {
        if (blessingLevel > 0) {
            blessingContainer.style.display = "block";
        } else {
            blessingContainer.style.display = "none";
        }
    }
}

function openBlessingModal(blessingImgElement) {
    // Get champion slot and info
    const champSlot = blessingImgElement.closest(".champ-slot");
    if (!champSlot) return;

    const input = champSlot.querySelector("input");
    const championName = input ? input.value.trim() : "";

    if (!championName) return;

    // Get champion data to check rarity and blessing level
    const champData = getChampionByNameExact(championName);
    if (!champData) return;

    const visual = champSlot.querySelector(".champ-visual");
    const starsContainer = visual ? visual.querySelector(".blessing-stars") : null;
    const blessingLevel = starsContainer ? parseInt(starsContainer.dataset.currentLevel || "0") : 0;

    // Store reference to blessing image element for later update
    const modal = document.getElementById("blessingModal");
    const modalBody = document.getElementById("blessingModalBody");
    const modalTitle = document.getElementById("blessingModalTitle");

    if (!modal || !modalBody || !modalTitle) return;

    // Update modal title
    modalTitle.textContent = `Select Blessing for ${championName}`;

    // Store data in modal for later use
    modal.dataset.championName = championName;
    modal.dataset.championRarity = champData.rarity;
    modal.dataset.blessingLevel = blessingLevel;
    modal.dataset.currentBlessing = blessingImgElement.dataset.blessing || "";

    // Store reference to the blessing image element to update it later
    modal.blessingImgElement = blessingImgElement;
    // Store reference to the champion slot to access team row later
    modal.championSlot = champSlot;

    // Populate modal body with blessings
    renderBlessingSelection(modalBody, champData.rarity, blessingLevel);

    // Show modal
    modal.classList.add("active");
}

function renderBlessingSelection(container, championRarity, blessingLevel) {
    const sectionsArray = getBlessingsBySection();

    if (sectionsArray.length === 0) {
        container.innerHTML = `<p style="color: #aaa; text-align: center;">No blessings available</p>`;
        return;
    }

    // Rarity order for filtering
    const rarityOrder = ["Rare", "Epic", "Legendary", "Mythical"];
    const maxRarityIndex = rarityOrder.indexOf(championRarity);

    // Create main container with sidebar and content
    const wrapper = document.createElement("div");
    wrapper.className = "blessing-selection-wrapper";

    // Sidebar with sections
    const sidebar = document.createElement("div");
    sidebar.className = "blessing-sections-sidebar";

    // Content area for blessings
    const contentArea = document.createElement("div");
    contentArea.className = "blessing-content-area";

    let firstSectionBlessings = null;

    sectionsArray.forEach((sectionObj, index) => {
        const section = sectionObj.section;
        const blessings = sectionObj.blessings;

        if (index === 0) firstSectionBlessings = blessings;

        const sectionTab = document.createElement("div");
        sectionTab.className = "blessing-section-tab";
        if (index === 0) sectionTab.classList.add("active");
        sectionTab.dataset.section = section;

        // Section image
        const sectionImg = document.createElement("img");
        sectionImg.src = `/tools/champions-index/img/blessings/sections/${section}.webp`;
        sectionImg.alt = section;
        sectionImg.className = "blessing-section-img";
        sectionImg.onerror = () => {
            sectionImg.src = "/tools/champions-index/img/blessings/Unselected.webp"; // Fallback
        };

        // Section name
        const sectionName = document.createElement("span");
        sectionName.textContent = section;
        sectionName.className = "blessing-section-name";

        sectionTab.appendChild(sectionImg);
        sectionTab.appendChild(sectionName);

        // Click handler
        sectionTab.addEventListener("click", () => {
            // Update active tab
            sidebar.querySelectorAll(".blessing-section-tab").forEach(tab => tab.classList.remove("active"));
            sectionTab.classList.add("active");

            // Render blessings for this section
            renderBlessingsGrid(contentArea, blessings, championRarity, maxRarityIndex, blessingLevel);
        });

        sidebar.appendChild(sectionTab);
    });

    wrapper.appendChild(sidebar);
    wrapper.appendChild(contentArea);
    container.innerHTML = "";
    container.appendChild(wrapper);

    // Render first section by default
    if (firstSectionBlessings) {
        renderBlessingsGrid(contentArea, firstSectionBlessings, championRarity, maxRarityIndex, blessingLevel);
    }
}

function renderBlessingsGrid(container, blessings, championRarity, maxRarityIndex, blessingLevel) {
    const rarityOrder = ["Rare", "Epic", "Legendary"];

    // Filter blessings by champion rarity
    const filteredBlessings = blessings.filter(blessing => {
        const blessingRarityIndex = rarityOrder.indexOf(blessing.rarity);
        return blessingRarityIndex <= maxRarityIndex;
    });

    if (filteredBlessings.length === 0) {
        container.innerHTML = `<p style="color: #aaa; text-align: center; padding: 20px;">No blessings available for ${championRarity} champions</p>`;
        return;
    }

    // Sort by rarity (Rare first, then Epic, then Legendary)
    filteredBlessings.sort((a, b) => {
        const rarityIndexA = rarityOrder.indexOf(a.rarity);
        const rarityIndexB = rarityOrder.indexOf(b.rarity);
        return rarityIndexA - rarityIndexB;
    });

    const grid = document.createElement("div");
    grid.className = "blessings-grid";

    // Get current blessing from modal data
    const modal = document.getElementById("blessingModal");
    const currentBlessing = modal ? modal.dataset.currentBlessing : null;

    filteredBlessings.forEach(blessing => {
        const blessingCard = document.createElement("div");
        blessingCard.className = "blessing-card";
        blessingCard.dataset.blessingName = blessing.name;
        blessingCard.dataset.blessingRarity = blessing.rarity;

        // Highlight if this is the currently selected blessing
        if (currentBlessing === blessing.name) {
            blessingCard.classList.add("selected");
        }

        // Blessing image (splash)
        const blessingImg = document.createElement("img");
        blessingImg.src = `/tools/champions-index/img/blessings/splash/${blessing.image}.webp`;
        blessingImg.alt = blessing.name;
        blessingImg.className = "blessing-card-img";
        blessingImg.onerror = () => {
            blessingImg.src = "/tools/champions-index/img/blessings/Unselected.webp"; // Fallback
        };

        // Blessing name
        const blessingName = document.createElement("div");
        blessingName.className = "blessing-card-name";
        blessingName.textContent = blessing.name;

        // Rarity badge
        const rarityBadge = document.createElement("div");
        rarityBadge.className = `blessing-rarity-badge rarity-${blessing.rarity.toLowerCase()}`;
        rarityBadge.textContent = blessing.rarity;

        blessingCard.appendChild(blessingImg);
        blessingCard.appendChild(blessingName);
        blessingCard.appendChild(rarityBadge);

        // Tooltip with description
        if (blessingLevel > 0) {
            const description = getBlessingDescription(blessing.name, blessingLevel);
            if (description) {
                blessingCard.title = description;
            }
        }

        // Click handler with visual feedback
        blessingCard.addEventListener("click", () => {
            // Check if clicking on already selected blessing
            const wasSelected = blessingCard.classList.contains("selected");

            if (wasSelected) {
                // Deselect the blessing
                blessingCard.classList.remove("selected");
                setTimeout(() => {
                    clearBlessing();
                }, 200);
            } else {
                // Remove selected class from all cards
                grid.querySelectorAll(".blessing-card").forEach(card => {
                    card.classList.remove("selected");
                });

                // Add selected class to clicked card
                blessingCard.classList.add("selected");

                // Wait a moment for visual feedback before closing modal
                setTimeout(() => {
                    selectBlessing(blessing.name, blessing.rarity);
                }, 200);
            }
        });

        grid.appendChild(blessingCard);
    });

    container.innerHTML = "";
    container.appendChild(grid);
}

function selectBlessing(blessingName, blessingRarity) {
    const modal = document.getElementById("blessingModal");
    if (!modal) return;

    const blessingContainer = modal.blessingImgElement;
    if (!blessingContainer) return;

    // Update blessing images (rarity background + icon overlay)
    const rarityImg = blessingContainer.querySelector(".blessing-rarity-bg");
    const iconImg = blessingContainer.querySelector(".blessing-icon-overlay");

    if (rarityImg) {
        rarityImg.src = `/tools/champions-index/img/blessings/${blessingRarity}.webp`;
    }

    // Get blessing data to get icon image
    const blessingData = getBlessingData(blessingName);
    if (iconImg && blessingData && blessingData.image) {
        iconImg.src = `/tools/champions-index/img/blessings/icons/${blessingData.image}.webp`;
        iconImg.style.display = "block";
    }

    blessingContainer.dataset.blessing = blessingName;
    blessingContainer.dataset.rarity = blessingRarity;

    // Get champion slot from modal (stored when modal was opened)
    const champSlot = modal.championSlot;
    if (!champSlot) return;

    // Check if we're in presets modal or main modal
    const presetsModal = champSlot.closest("#presetsModal");

    if (presetsModal) {
        // We're in presets modal - save to preset
        const presetRow = champSlot.closest(".preset-row");
        if (!presetRow) return;

        const memberPseudo = presetRow.dataset.memberPseudo;
        const presetId = presetRow.dataset.presetId;
        const slotName = champSlot.dataset.slotName;

        if (!memberPseudo || !presetId || !slotName) return;

        // Update local data
        const member = clanMembers[memberPseudo];
        if (member) {
            if (!member.presets) member.presets = {};
            if (!member.presets[presetId]) member.presets[presetId] = {};

            member.presets[presetId][`${slotName}_blessing`] = blessingName;
            member.presets[presetId][`${slotName}_blessing_rarity`] = blessingRarity;

            // Save to Firebase
            const blessingRef = ref(db, `rooms/${currentRoomId}/siege/members/${memberPseudo}/presets/${presetId}/${slotName}_blessing`);
            set(blessingRef, blessingName);

            const rarityRef = ref(db, `rooms/${currentRoomId}/siege/members/${memberPseudo}/presets/${presetId}/${slotName}_blessing_rarity`);
            set(rarityRef, blessingRarity);
        }
    } else {
        // We're in main modal - save to post team
        const teamRow = champSlot.closest(".team-row");
        if (!teamRow) return;

        const champIndex = champSlot.dataset.champIndex;
        const teamIndex = teamRow.dataset.teamIndex;
        if (!champIndex || teamIndex === undefined) return;

        // Find the team data
        if (!currentPostId) return;

        const postData = postDataCache[currentPostId];
        if (postData && postData.teams && postData.teams[teamIndex]) {
            const teamData = postData.teams[teamIndex];
            teamData[`c${champIndex}_blessing`] = blessingName;
            teamData[`c${champIndex}_blessing_rarity`] = blessingRarity;

            // Save to Firebase in teams array
            const blessingRef = ref(db, `rooms/${currentRoomId}/siege/${currentPostId}/teams/${teamIndex}/c${champIndex}_blessing`);
            set(blessingRef, blessingName);

            const rarityRef = ref(db, `rooms/${currentRoomId}/siege/${currentPostId}/teams/${teamIndex}/c${champIndex}_blessing_rarity`);
            set(rarityRef, blessingRarity);
        }
    }

    // Close modal
    closeBlessingModal();
}

function closeBlessingModal() {
    const modal = document.getElementById("blessingModal");
    if (modal) {
        modal.classList.remove("active");
    }
}

function clearBlessing() {
    const modal = document.getElementById("blessingModal");
    if (!modal) return;

    const blessingContainer = modal.blessingImgElement;
    if (!blessingContainer) return;

    // Clear blessing images - show Unselected.webp
    const rarityImg = blessingContainer.querySelector(".blessing-rarity-bg");
    const iconImg = blessingContainer.querySelector(".blessing-icon-overlay");

    if (rarityImg) {
        rarityImg.src = "/tools/champions-index/img/blessings/Unselected.webp";
        rarityImg.style.display = "";
    }

    if (iconImg) {
        iconImg.src = "";
        iconImg.style.display = "none";
    }

    blessingContainer.dataset.blessing = "";
    blessingContainer.dataset.rarity = "";

    // Get champion slot from modal (stored when modal was opened)
    const champSlot = modal.championSlot;
    if (!champSlot) return;

    // Check if we're in presets modal or main modal
    const presetsModal = champSlot.closest("#presetsModal");

    if (presetsModal) {
        // We're in presets modal - clear preset blessing
        const presetRow = champSlot.closest(".preset-row");
        if (!presetRow) return;

        const memberPseudo = presetRow.dataset.memberPseudo;
        const presetId = presetRow.dataset.presetId;
        const slotName = champSlot.dataset.slotName;

        if (!memberPseudo || !presetId || !slotName) return;

        // Update local data
        const member = clanMembers[memberPseudo];
        if (member && member.presets && member.presets[presetId]) {
            member.presets[presetId][`${slotName}_blessing`] = null;
            member.presets[presetId][`${slotName}_blessing_rarity`] = null;

            // Save to Firebase
            const blessingRef = ref(db, `rooms/${currentRoomId}/siege/members/${memberPseudo}/presets/${presetId}/${slotName}_blessing`);
            set(blessingRef, null);

            const rarityRef = ref(db, `rooms/${currentRoomId}/siege/members/${memberPseudo}/presets/${presetId}/${slotName}_blessing_rarity`);
            set(rarityRef, null);
        }
    } else {
        // We're in main modal - clear post team blessing
        const teamRow = champSlot.closest(".team-row");
        if (!teamRow) return;

        const champIndex = champSlot.dataset.champIndex;
        const teamIndex = teamRow.dataset.teamIndex;
        if (!champIndex || teamIndex === undefined) return;

        // Find the team data
        if (!currentPostId) return;

        const postData = postDataCache[currentPostId];
        if (postData && postData.teams && postData.teams[teamIndex]) {
            const teamData = postData.teams[teamIndex];
            teamData[`c${champIndex}_blessing`] = null;
            teamData[`c${champIndex}_blessing_rarity`] = null;

            // Save to Firebase in teams array
            const blessingRef = ref(db, `rooms/${currentRoomId}/siege/${currentPostId}/teams/${teamIndex}/c${champIndex}_blessing`);
            set(blessingRef, null);

            const rarityRef = ref(db, `rooms/${currentRoomId}/siege/${currentPostId}/teams/${teamIndex}/c${champIndex}_blessing_rarity`);
            set(rarityRef, null);
        }
    }

    // Close modal
    closeBlessingModal();
}

// ==================== SMOOTH SCROLL TO TOP FUNCTION ====================
function smoothScrollToTop() {
    let isScrolling = true;
    let targetPosition = 0;
    let startTime = Date.now();
    let animationFrameId = null;

    const scrollToTop = () => {
        if (!isScrolling) {
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
            }
            return;
        }

        const currentScroll = document.documentElement.scrollTop || document.body.scrollTop;
        const distance = currentScroll - targetPosition;

        if (distance > 1) {
            const newPosition = currentScroll - distance / 8;
            window.scrollTo(0, newPosition);
            animationFrameId = window.requestAnimationFrame(scrollToTop);
        } else {
            window.scrollTo(0, targetPosition);
            isScrolling = false;
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
            }
        }
    };

    // Stop animation if user tries to scroll manually
    const stopScroll = (e) => {
        // Ignore events in the first 200ms (animation start)
        if (Date.now() - startTime < 200) {
            return;
        }

        // Don't stop on very small wheel movements
        if (e.type === 'wheel' && Math.abs(e.deltaY) < 4) {
            return;
        }

        isScrolling = false;
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
        }

        // Remove all listeners
        window.removeEventListener('wheel', stopScroll);
        window.removeEventListener('touchstart', stopScroll);
        window.removeEventListener('keydown', stopScroll);
        window.removeEventListener('mousedown', stopScroll);
    };

    // Add listeners immediately
    window.addEventListener('wheel', stopScroll, { passive: true });
    window.addEventListener('touchstart', stopScroll, { passive: true });
    window.addEventListener('keydown', stopScroll);
    window.addEventListener('mousedown', stopScroll);

    scrollToTop();
}

// --- init ---
window.addEventListener("DOMContentLoaded", () => {
    // Initialize auth UI first
    setupAuthUI(db);

    // Listen for room ready event
    window.addEventListener('roomReady', (e) => {
        const { roomId, accessMode, isViewerMode } = e.detail;

        // Disable UI if viewer mode
        if (isViewerMode) {
            disableViewerControls();
        }

        // Initialize app with room-based data
        initializeAppWithRoom(roomId);
    });

    // Initialize collapsible sections
    document.querySelectorAll(".section-header.collapsible").forEach(header => {
        header.addEventListener("click", () => {
            const targetId = header.dataset.target;
            const content = document.getElementById(targetId);

            if (content) {
                header.classList.toggle("collapsed");
                content.classList.toggle("collapsed");
            }
        });
    });

    // Remplace automatiquement les points roses par les icônes correspondantes
    document.querySelectorAll(".post-point").forEach(pp => {
        const type = pp.dataset.type;
        if (!type) return;

        const iconEl = pp.querySelector(".post-icon");
        if (iconEl) {
            iconEl.src = `/siege/img/posts/${type}.webp`;
        }

        // Setup drop zone for presets
        setupPostDropZone(pp);

        // Ajouter les 3 icônes de conditions pour les posts uniquement
        if (type === "post" && !pp.querySelector(".post-conditions")) {
            const conditionsDiv = document.createElement("div");
            conditionsDiv.className = "post-conditions";

            for (let i = 0; i < 3; i++) {
                const img = document.createElement("img");
                img.className = "post-cond-icon";
                img.dataset.index = i;
                img.src = "/siege/img/conditions/Condition.webp";
                conditionsDiv.appendChild(img);
            }

            // Insérer avant le post-icon
            pp.insertBefore(conditionsDiv, pp.querySelector(".post-icon"));
        }

        // Ajouter le compteur d'équipes pour tous les points
        if (!pp.querySelector(".post-teams-count")) {
            const countDiv = document.createElement("div");
            countDiv.className = "post-teams-count empty";
            countDiv.textContent = "0";
            pp.appendChild(countDiv);
        }
    });

    const copyBtn = document.getElementById("copyLinkBtn");
    const closeModalBtn = document.getElementById("closeModal");
    const addTeamBtn = document.getElementById("addTeamBtn");
    const freezePostBtn = document.getElementById("freezePostBtn");
    const memberFilter = document.getElementById("memberFilter");

    // Custom Select for Member Filter
    if (memberFilter) {
        const trigger = memberFilter.querySelector(".custom-select-trigger");
        const optionsContainer = memberFilter.querySelector(".custom-select-options");

        // Toggle dropdown
        trigger.addEventListener("click", (e) => {
            e.stopPropagation();
            memberFilter.classList.toggle("open");
            // Close condition filter if open
            const conditionFilter = document.getElementById("conditionFilter");
            if (conditionFilter) {
                conditionFilter.classList.remove("open");
            }
        });

        // Close dropdown when clicking outside
        document.addEventListener("click", () => {
            memberFilter.classList.remove("open");
        });

        // Handle option selection
        optionsContainer.addEventListener("click", (e) => {
            const option = e.target.closest(".custom-select-option");
            if (!option) return;

            // Update selected value
            const value = option.dataset.value;
            memberFilter.dataset.value = value;

            // Update selected class
            optionsContainer.querySelectorAll(".custom-select-option").forEach(opt => {
                opt.classList.remove("selected");
            });
            option.classList.add("selected");

            // Update display
            updateMemberFilterDisplay();

            // Close dropdown
            memberFilter.classList.remove("open");

            // Apply filters
            applyFilters();
        });
    }

    // Custom Select for Condition Filter
    const conditionFilter = document.getElementById("conditionFilter");
    if (conditionFilter) {
        const trigger = conditionFilter.querySelector(".custom-select-trigger");
        const optionsContainer = conditionFilter.querySelector(".custom-select-options");

        // Toggle dropdown
        trigger.addEventListener("click", (e) => {
            e.stopPropagation();
            conditionFilter.classList.toggle("open");
            // Close member filter if open
            const memberFilter = document.getElementById("memberFilter");
            if (memberFilter) {
                memberFilter.classList.remove("open");
            }
        });

        // Close dropdown when clicking outside
        document.addEventListener("click", () => {
            conditionFilter.classList.remove("open");
        });

        // Handle option selection
        optionsContainer.addEventListener("click", (e) => {
            const option = e.target.closest(".custom-select-option");
            if (!option) return;

            // Update selected value
            const value = option.dataset.value;
            conditionFilter.dataset.value = value;

            // Update selected class
            optionsContainer.querySelectorAll(".custom-select-option").forEach(opt => {
                opt.classList.remove("selected");
            });
            option.classList.add("selected");

            // Update display
            updateConditionFilterDisplay();

            // Close dropdown
            conditionFilter.classList.remove("open");

            // Apply filters
            applyFilters();
        });
    }

    // Filters Toggle Button
    const filtersToggleBtn = document.getElementById("filtersToggleBtn");
    const filtersContent = document.getElementById("filtersContent");

    if (filtersToggleBtn && filtersContent) {
        filtersToggleBtn.addEventListener("click", () => {
            const isOpen = filtersContent.classList.contains("open");
            if (isOpen) {
                filtersContent.classList.remove("open");
                filtersToggleBtn.classList.remove("active");
            } else {
                filtersContent.classList.add("open");
                filtersToggleBtn.classList.add("active");
                updateStats(); // Update stats when opening
            }
        });
    }

    // Clear Filters Button
    const clearFiltersBtn = document.getElementById("clearFiltersBtn");
    if (clearFiltersBtn) {
        clearFiltersBtn.addEventListener("click", (e) => {
            // Prevent the parent button (filtersToggleBtn) from toggling
            e.stopPropagation();

            // Reset member filter
            const memberFilter = document.getElementById("memberFilter");
            if (memberFilter) {
                memberFilter.dataset.value = "";
                const selectedEl = memberFilter.querySelector(".custom-select-trigger span");
                if (selectedEl) {
                    selectedEl.textContent = "All";
                }
                // Update selected class on options
                const optionsContainer = memberFilter.querySelector(".custom-select-options");
                if (optionsContainer) {
                    optionsContainer.querySelectorAll(".custom-select-option").forEach(opt => {
                        opt.classList.remove("selected");
                    });
                    const allOption = optionsContainer.querySelector('.custom-select-option[data-value=""]');
                    if (allOption) {
                        allOption.classList.add("selected");
                    }
                }
            }

            // Reset condition filter
            const conditionFilter = document.getElementById("conditionFilter");
            if (conditionFilter) {
                conditionFilter.dataset.value = "";
                // Update selected class on options
                const optionsContainer = conditionFilter.querySelector(".custom-select-options");
                if (optionsContainer) {
                    optionsContainer.querySelectorAll(".custom-select-option").forEach(opt => {
                        opt.classList.remove("selected");
                    });
                    const allOption = optionsContainer.querySelector('.custom-select-option[data-value=""]');
                    if (allOption) {
                        allOption.classList.add("selected");
                    }
                }
                // Update the condition filter display to remove icon
                updateConditionFilterDisplay();
            }

            // Hide all persistent tooltips
            document.querySelectorAll('.persistent-tooltip').forEach(t => {
                t.remove();
            });

            // Apply filters to refresh the view
            applyFilters();
        });
    }

    // Teams Presets Toggle Button
    const teamsPresetsBtn = document.getElementById("teamsPresetsBtn");
    const teamsPresetsDropdown = document.getElementById("teamsPresetsDropdown");

    if (teamsPresetsBtn && teamsPresetsDropdown) {
        teamsPresetsBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const isOpen = teamsPresetsDropdown.classList.contains("open");

            if (isOpen) {
                teamsPresetsDropdown.classList.remove("open");
                teamsPresetsBtn.classList.remove("active");
            } else {
                refreshTeamsPresetsDropdown();
                teamsPresetsDropdown.classList.add("open");
                teamsPresetsBtn.classList.add("active");
            }
        });

        // Close dropdown when clicking outside
        document.addEventListener("click", (e) => {
            if (!teamsPresetsBtn.contains(e.target) && !teamsPresetsDropdown.contains(e.target)) {
                teamsPresetsDropdown.classList.remove("open");
                teamsPresetsBtn.classList.remove("active");
            }
        });
    }

    postIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener("click", () => {
            if (!currentRoomId) {
                alert("Please login first.");
                return;
            }
            openModal(id);
        });
    });

    document.getElementById("addMemberBtn").addEventListener("click", () => {
        const pseudo = document.getElementById("newMemberPseudo").value.trim();
        const link = document.getElementById("newMemberLink").value.trim();

        if (!pseudo) return;

        if (isViewer()) {
            alert("Cannot add members in viewer mode.");
            return;
        }

        clanMembers[pseudo] = {
            pseudo,
            link: link || ""
        };

        const refMembers = ref(db, `rooms/${currentRoomId}/siege/members`);
        set(refMembers, clanMembers);

        document.getElementById("newMemberPseudo").value = "";
        document.getElementById("newMemberLink").value = "";
    });

    copyBtn.addEventListener("click", () => {
        if (!currentRoomId) {
            alert("No active room.");
            return;
        }
        const url = new URL(window.location.href);
        url.searchParams.set("room", currentRoomId);
        navigator.clipboard.writeText(url.toString())
            .then(() => setStatus("Link copied ✔"))
            .catch(() => setStatus("Impossible to copy link.", true));
    });

    // Logout button
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            if (confirm('Are you sure you want to logout?')) {
                logout();
            }
        });
    }

    // Admin control buttons
    const changePasswordBtn = document.getElementById('changePasswordBtn');
    const exportBtn = document.getElementById('exportDataBtn');
    const importBtn = document.getElementById('importDataBtn');
    const importFileInput = document.getElementById('importFileInput');

    if (changePasswordBtn) {
        changePasswordBtn.addEventListener('click', () => {
            if (!currentRoomId) {
                alert('No active room.');
                return;
            }
            showChangePasswordModal();
        });
    }

    // Initialize password toggle buttons
    document.querySelectorAll('.password-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.target;
            const input = document.getElementById(targetId);
            if (!input) return;

            if (input.type === 'password') {
                input.type = 'text';
                btn.classList.add('visible');
            } else {
                input.type = 'password';
                btn.classList.remove('visible');
            }
        });
    });

    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            if (!currentRoomId) {
                alert('No active room.');
                return;
            }
            exportSiegeData(db, currentRoomId);
        });
    }

    if (importBtn && importFileInput) {
        importBtn.addEventListener('click', () => {
            if (!currentRoomId) {
                alert('No active room.');
                return;
            }
            importFileInput.click();
        });

        importFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                const content = event.target.result;
                importSiegeData(db, currentRoomId, content);
            };
            reader.readAsText(file);

            // Reset input
            importFileInput.value = '';
        });
    }

    closeModalBtn.addEventListener("click", () => {
        closeModal();
    });

    addTeamBtn.addEventListener("click", () => {
        const teamsContainer = document.getElementById("teamsContainer");
        const index = teamsContainer.children.length; // nouvelle team index
        createTeamRow({}, index);
        // Auto-save after adding team
        autoSaveCurrentPost();
    });

    freezePostBtn.addEventListener("click", () => {
        toggleFreezePost();
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            const overlay = document.getElementById("modalOverlay");
            if (overlay.style.display === "flex") {
                closeModal();
            }
        }
    });

    const overlay = document.getElementById("modalOverlay");
    overlay.addEventListener("click", (e) => {
        // Si on clique l'overlay (et pas le modal lui-même)
        if (e.target === overlay) {
            closeModal();
        }
    });

    // Fermer les menus de transfert quand on clique ailleurs
    document.addEventListener("click", (e) => {
        if (!e.target.closest(".transfer-team-btn") && !e.target.closest(".transfer-menu")) {
            document.querySelectorAll(".transfer-menu.open").forEach(m => {
                m.classList.remove("open");
            });
        }
    });

    // Toggle conditions panel
    const conditionsPanelToggle = document.getElementById("conditionsPanelToggle");
    if (conditionsPanelToggle) {
        conditionsPanelToggle.addEventListener("click", () => {
            const panel = document.getElementById("conditionsPanel");
            if (panel) {
                panel.classList.toggle("open");
                conditionsPanelToggle.classList.toggle("open");
            }
        });
    }

    // Sort by clicking table headers
    document.querySelectorAll("#summaryTable th.sortable").forEach(th => {
        th.addEventListener("click", () => {
            const sortType = th.dataset.sort;

            // Tri par conditions : toujours descendant (Z->A), pas de toggle
            if (sortType === "conditions") {
                summarySortMode = "conditions";
                summarySortDirection = "desc";
            }
            // Autres colonnes : comportement normal avec toggle
            else if (summarySortMode === sortType) {
                summarySortDirection = summarySortDirection === "asc" ? "desc" : "asc";
            } else {
                // Nouvelle colonne, réinitialiser en ascendant
                summarySortMode = sortType;
                summarySortDirection = "asc";
            }

            updateSummaryTable();
        });
    });

    // Sort members table by clicking headers
    document.querySelectorAll("#membersTable th.sortable").forEach(th => {
        th.addEventListener("click", () => {
            const sortType = th.dataset.sort;

            // Si on clique sur la même colonne, toggle la direction
            if (memberSortColumn === sortType) {
                memberSortDirection = memberSortDirection === "asc" ? "desc" : "asc";
            } else {
                // Nouvelle colonne, réinitialiser en ascendant
                memberSortColumn = sortType;
                memberSortDirection = "asc";
            }

            updateMembersList();
        });
    });

    // Room handling is now done by auth system

    // ==================== TEAM PRESETS MODAL ====================
    let currentPresetsMember = null;

    window.openPresetsModal = function(memberPseudo) {
        currentPresetsMember = memberPseudo;
        const modal = document.getElementById("presetsModal");
        const title = document.getElementById("presetsModalTitle");

        title.textContent = `${memberPseudo} - Team Presets`;
        modal.style.display = "flex";

        renderPresets(memberPseudo);
    }

    window.closePresetsModal = function() {
        const modal = document.getElementById("presetsModal");
        modal.style.display = "none";
        currentPresetsMember = null;
    }

    document.getElementById("closePresetsModal").addEventListener("click", closePresetsModal);

    // Close modal on overlay click
    document.getElementById("presetsModal").addEventListener("click", (e) => {
        if (e.target.id === "presetsModal") {
            closePresetsModal();
        }
    });

    // ==================== BLESSING MODAL EVENT LISTENERS ====================
    document.getElementById("closeBlessingModal").addEventListener("click", closeBlessingModal);

    // Close blessing modal on overlay click
    const blessingModal = document.getElementById("blessingModal");
    if (blessingModal) {
        blessingModal.querySelector(".blessing-modal-overlay").addEventListener("click", closeBlessingModal);
    }

    function renderPresets(memberPseudo) {
        const container = document.getElementById("presetsContainer");
        container.innerHTML = "";

        const member = clanMembers[memberPseudo];
        if (!member) return;

        const presets = member.presets || {};
        const presetIds = Object.keys(presets);

        if (presetIds.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: #888; padding: 40px;">No team presets yet. Click "+ ADD TEAM PRESET" to create one.</p>';
            return;
        }

        presetIds.forEach(presetId => {
            const preset = presets[presetId];
            const presetRow = createPresetRow(memberPseudo, presetId, preset);
            container.appendChild(presetRow);
        });

        // Update move buttons after rendering all presets
        updatePresetMoveButtons();
    }

    function createPresetRow(memberPseudo, presetId, preset) {
        const row = document.createElement("div");
        row.className = "preset-row";
        row.draggable = true;
        row.dataset.presetId = presetId; // Add preset ID to identify the row
        row.dataset.memberPseudo = memberPseudo; // Add member pseudo too

        // Drag & drop handlers for preset reordering
        row.addEventListener("dragstart", (e) => {
            // Only start drag if the target is the row itself, not a child element
            if (e.target !== row) {
                e.preventDefault();
                return;
            }

            e.dataTransfer.effectAllowed = "move";
            // Use a custom data type to distinguish from champion drag
            e.dataTransfer.setData("application/x-preset-row", presetId);
            row.classList.add("dragging");
        });

        row.addEventListener("dragend", () => {
            row.classList.remove("dragging");
            // Remove all drag-over classes
            document.querySelectorAll(".preset-row.drag-over").forEach(r => {
                r.classList.remove("drag-over");
            });
        });

        row.addEventListener("dragover", (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            const draggingElement = document.querySelector(".preset-row.dragging");
            if (draggingElement && draggingElement !== row) {
                row.classList.add("drag-over");
            }
        });

        row.addEventListener("dragleave", () => {
            row.classList.remove("drag-over");
        });

        row.addEventListener("drop", (e) => {
            e.preventDefault();
            row.classList.remove("drag-over");

            // Only handle preset row drops, not champion drops
            const presetRowData = e.dataTransfer.getData("application/x-preset-row");
            if (!presetRowData) {
                // This is a champion drop, ignore it
                return;
            }

            const fromPresetId = presetRowData;
            const toPresetId = presetId;

            if (fromPresetId !== toPresetId) {
                // Swap presets in the modal
                const presetsContainer = document.getElementById("presetsContainer");
                const allPresetRows = Array.from(presetsContainer.querySelectorAll(".preset-row"));
                const fromRow = allPresetRows.find(r => r.dataset.presetId === fromPresetId);
                const toRow = allPresetRows.find(r => r.dataset.presetId === toPresetId);

                if (fromRow && toRow) {
                    const fromIndex = allPresetRows.indexOf(fromRow);
                    const toIndex = allPresetRows.indexOf(toRow);

                    // Swap positions in DOM
                    if (fromIndex < toIndex) {
                        toRow.parentNode.insertBefore(fromRow, toRow.nextSibling);
                    } else {
                        toRow.parentNode.insertBefore(fromRow, toRow);
                    }

                    // Update buttons and save
                    updatePresetMoveButtons();
                    savePresetsOrder();
                }
            }
        });

        // Check if this preset is already used in a post
        const usageDetails = findPresetUsageDetailed(memberPseudo, preset);
        if (usageDetails) {
            const { postId, postType, formattedName } = usageDetails;

            // Add class based on post type
            row.classList.add("preset-used");
            row.classList.add(`preset-used-${postType}`);

            // Make row clickable to open the post modal
            row.style.cursor = "pointer";
            row.title = `Click to view in ${formattedName}`;

            row.addEventListener("click", (e) => {
                // Don't trigger if clicking on input fields or buttons
                if (e.target.tagName === "INPUT" || e.target.tagName === "BUTTON" || e.target.closest("button")) {
                    return;
                }

                // Close presets modal
                closePresetsModal();

                // Open post modal with highlight
                openPostFromSummary(postId, memberPseudo);
            });
        }

        // --- Move buttons ---
        const moveButtons = document.createElement("div");
        moveButtons.className = "move-team-btns";

        const moveUpBtn = document.createElement("button");
        moveUpBtn.className = "move-team-btn move-up";
        moveUpBtn.type = "button";
        moveUpBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>`;
        moveUpBtn.title = "Move preset up";

        const moveDownBtn = document.createElement("button");
        moveDownBtn.className = "move-team-btn move-down";
        moveDownBtn.type = "button";
        moveDownBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>`;
        moveDownBtn.title = "Move preset down";

        moveUpBtn.onclick = () => movePresetUp(row);
        moveDownBtn.onclick = () => movePresetDown(row);

        moveButtons.appendChild(moveUpBtn);
        moveButtons.appendChild(moveDownBtn);
        row.appendChild(moveButtons);

        // Team section (champions + lead aura)
        const teamSection = document.createElement("div");
        teamSection.className = "preset-team-section";

        // Create 4 champion slots
        ["champion4", "champion3", "champion2", "lead"].forEach((slot, index) => {
            const champSlot = createPresetChampSlot(memberPseudo, presetId, slot, preset[slot] || "", index);
            teamSection.appendChild(champSlot);
        });

        // Add lead aura display after lead slot
        const leadAuraDisplay = createLeadAuraDisplay(preset.lead || "");
        teamSection.appendChild(leadAuraDisplay);

        row.appendChild(teamSection);

        // Conditions section
        const conditionsSection = document.createElement("div");
        conditionsSection.className = "preset-conditions-section";

        // Add usage indicator above conditions if used
        if (usageDetails) {
            const usageIndicator = document.createElement("div");
            usageIndicator.className = "preset-usage-indicator-modal";
            usageIndicator.classList.add(`indicator-${usageDetails.postType}`);
            usageIndicator.textContent = usageDetails.formattedName.toUpperCase();
            usageIndicator.title = `Already used in ${usageDetails.formattedName}`;
            conditionsSection.appendChild(usageIndicator);
        }

        const conditionsTitle = document.createElement("div");
        conditionsTitle.className = "preset-conditions-title";
        conditionsTitle.textContent = "Conditions";
        conditionsSection.appendChild(conditionsTitle);

        const conditionsGrid = document.createElement("div");
        conditionsGrid.className = "preset-conditions-grid";

        // Get validated conditions (exclude Effects)
        const validatedConditions = getValidatedConditions(preset);
        validatedConditions.forEach(condId => {
            // Skip effects conditions
            const condType = getConditionType(condId);
            if (condType === 'effects' || condType === 'Effects') {
                return;
            }

            const condIcon = getConditionIcon(condId);
            if (condIcon) {
                const img = document.createElement("img");
                img.src = condIcon;
                img.className = "preset-condition-icon";
                img.title = getConditionName(condId);
                conditionsGrid.appendChild(img);
            }
        });

        conditionsSection.appendChild(conditionsGrid);
        row.appendChild(conditionsSection);

        // Actions section (delete button)
        const actionsSection = document.createElement("div");
        actionsSection.className = "preset-actions";

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "delete-preset-btn";
        deleteBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
        `;
        deleteBtn.title = "Delete preset";
        deleteBtn.addEventListener("click", () => deletePreset(memberPseudo, presetId));

        actionsSection.appendChild(deleteBtn);
        row.appendChild(actionsSection);

        return row;
    }

    function createPresetChampSlot(memberPseudo, presetId, slotName, championName, slotIndex) {
        const champSlot = document.createElement("div");
        champSlot.className = "champ-slot";
        champSlot.setAttribute("draggable", true);
        champSlot.dataset.slotName = slotName;
        champSlot.dataset.slotIndex = slotIndex;

        const label = document.createElement("label");
        label.textContent = slotName === "lead" ? "Lead" : `Champ ${5 - slotIndex}`;
        champSlot.appendChild(label);

        // Input field
        const input = document.createElement("input");
        input.type = "text";
        input.value = championName;
        input.placeholder = "Champion";
        input.autocomplete = "off";
        input.addEventListener("input", () => handlePresetChampionInput(input, memberPseudo, presetId, slotName));
        input.addEventListener("change", () => savePresetChampion(memberPseudo, presetId, slotName, input.value.trim()));
        input.addEventListener("blur", () => {
            setTimeout(() => savePresetChampion(memberPseudo, presetId, slotName, input.value.trim()), 200);
        });
        champSlot.appendChild(input);

        // Suggestions container (AFTER input, BEFORE visual)
        const suggestionsDiv = document.createElement("div");
        suggestionsDiv.className = "suggestions";
        const suggestionsList = document.createElement("div");
        suggestionsList.className = "suggestions-list";
        suggestionsDiv.appendChild(suggestionsList);
        champSlot.appendChild(suggestionsDiv);

        // Visual container
        const visual = document.createElement("div");
        visual.className = "champ-visual";

        // Get preset data for blessing level (with safe access)
        let blessingLevel = 0;
        let blessingName = null;
        let blessingRarity = null;
        let member = null;
        if (clanMembers && clanMembers[memberPseudo]) {
            member = clanMembers[memberPseudo];
            const preset = member.presets?.[presetId];
            blessingLevel = preset?.[`${slotName}_blessing_level`] || 0;
            blessingName = preset?.[`${slotName}_blessing`] || null;
            blessingRarity = preset?.[`${slotName}_blessing_rarity`] || null;
        }

        // Create blessing stars
        const blessingStars = createBlessingStars(championName, blessingLevel);

        // Create blessing image
        const blessingImg = createBlessingImage(blessingName, blessingRarity);

        // Add click handlers for stars
        const stars = blessingStars.querySelectorAll(".blessing-star");
        stars.forEach((star, starIndex) => {
            star.addEventListener("click", (e) => {
                e.stopPropagation();
                const clickedLevel = starIndex + 1;
                const currentLevel = parseInt(blessingStars.dataset.currentLevel || "0");

                // If clicking the same level, deactivate (set to 0)
                // Otherwise, set to clicked level
                const newLevel = (clickedLevel === currentLevel) ? 0 : clickedLevel;

                // Update stars visual
                updateBlessingStars(blessingStars, newLevel);
                blessingStars.dataset.currentLevel = newLevel;

                // Show/hide blessing image
                updateBlessingImageVisibility(visual, newLevel);

                // Save blessing level to preset
                const currentMember = clanMembers?.[memberPseudo];
                if (currentMember) {
                    if (!currentMember.presets) currentMember.presets = {};
                    if (!currentMember.presets[presetId]) {
                        currentMember.presets[presetId] = {};
                    }
                    currentMember.presets[presetId][`${slotName}_blessing_level`] = newLevel;

                    // Save to Firebase
                    const presetRef = ref(db, `rooms/${currentRoomId}/siege/members/${memberPseudo}/presets/${presetId}/${slotName}_blessing_level`);
                    set(presetRef, newLevel);
                }
            });
        });

        blessingStars.dataset.currentLevel = blessingLevel;

        // Show blessing image if blessing level > 0
        if (blessingLevel > 0) {
            blessingImg.style.display = "block";
        }

        // Clear button
        const clearBtn = document.createElement("button");
        clearBtn.className = "clear-champ-btn";
        clearBtn.textContent = "✕";
        clearBtn.addEventListener("click", () => {
            input.value = "";
            savePresetChampion(memberPseudo, presetId, slotName, "");
        });

        // Champion image
        const champImg = document.createElement("img");
        champImg.className = "champ-img";

        // Rarity border
        const rarityImg = document.createElement("img");
        rarityImg.className = "rarity-img";

        visual.appendChild(champImg);
        visual.appendChild(rarityImg);
        visual.appendChild(blessingStars);
        visual.appendChild(blessingImg);
        visual.appendChild(clearBtn);

        champSlot.appendChild(visual);

        // Update visual if champion exists
        if (championName) {
            updatePresetChampionVisual(champSlot, championName);
        }

        // Drag & drop handlers
        champSlot.addEventListener("dragstart", handlePresetDragStart);
        champSlot.addEventListener("dragover", handlePresetDragOver);
        champSlot.addEventListener("drop", (e) => handlePresetDrop(e, memberPseudo, presetId));
        champSlot.addEventListener("dragend", handlePresetDragEnd);

        return champSlot;
    }

    function createLeadAuraDisplay(leadName) {
        const display = document.createElement("div");
        display.className = "lead-aura-display";

        if (!leadName || !leadName.trim()) {
            return display;
        }

        const champData = getChampionByNameExact(leadName);
        if (!champData || !champData.aura || !champData.auratext) {
            return display;
        }

        display.style.display = "flex";

        const container = document.createElement("div");
        container.className = "lead-aura-container";

        // Aura icon
        const auraIcon = document.createElement("img");
        auraIcon.className = "lead-aura-icon";
        auraIcon.src = `/tools/champions-index/img/aura/${champData.aura}.webp`;
        container.appendChild(auraIcon);

        // Border
        const auraBorder = document.createElement("img");
        auraBorder.className = "lead-aura-border";
        auraBorder.src = `/tools/champions-index/img/aura/BORDER.webp`;
        container.appendChild(auraBorder);

        display.appendChild(container);

        // Parse aura text to extract zone and value
        const auraText = champData.auratext || '';
        let zone = '';
        let value = '';

        // Extract zone (All Battles, Dungeons, Doom Tower, Arena)
        const zoneMatch = auraText.match(/in (all battles|dungeons|doom tower|arena)/i);
        if (zoneMatch) {
            zone = zoneMatch[1];
        }

        // Extract value (last number with % if present)
        const valueMatch = auraText.match(/by (\d+%?)\s*(?:SPD|ACC|ATK|DEF|HP|C\.RATE|C\.DMG|RES)?$/i);
        if (valueMatch) {
            value = valueMatch[1];
            // Add % if not present but % is in text
            if (!value.includes('%') && auraText.includes('%')) {
                value += '%';
            }
        }

        // Zone text
        const zoneText = document.createElement("div");
        zoneText.className = "lead-aura-zone";
        zoneText.textContent = zone;
        display.appendChild(zoneText);

        // Value text
        const valueText = document.createElement("div");
        valueText.className = "lead-aura-value";
        valueText.textContent = value;
        display.appendChild(valueText);

        // Add pulsing red effect if not "All Battles"
        if (zone && zone.toLowerCase() !== 'all battles') {
            display.classList.add('lead-aura-restricted');
        }

        return display;
    }

    function handlePresetChampionInput(input, memberPseudo, presetId, slotName) {
        const query = input.value.trim();
        const suggestionsDiv = input.parentElement.querySelector(".suggestions-list");

        if (query.length < 2) {
            suggestionsDiv.innerHTML = "";
            return;
        }

        const results = searchChampions(query);
        suggestionsDiv.innerHTML = "";

        results.forEach(c => {
            const div = document.createElement("div");
            div.textContent = c.name;
            div.addEventListener("click", () => {
                input.value = c.name;
                suggestionsDiv.innerHTML = "";
                savePresetChampion(memberPseudo, presetId, slotName, c.name);
            });
            suggestionsDiv.appendChild(div);
        });
    }

    function updatePresetChampionVisual(champSlot, championName) {
        const champImg = champSlot.querySelector(".champ-img");
        const rarityImg = champSlot.querySelector(".rarity-img");
        let affinityImg = champSlot.querySelector(".affinity-img");
        const starsContainer = champSlot.querySelector(".blessing-stars");

        // Get preset info to update conditions after visual update
        const presetRow = champSlot.closest('.preset-row');
        const presetId = presetRow ? presetRow.dataset.presetId : null;
        const memberPseudo = presetRow ? presetRow.dataset.memberPseudo : null;

        if (!championName || !championName.trim()) {
            champImg.style.display = "none";
            rarityImg.style.display = "none";
            if (affinityImg) affinityImg.style.display = "none";

            // Hide stars if no champion
            if (starsContainer) {
                starsContainer.classList.remove("visible");
            }

            // Update conditions when clearing a champion
            if (presetId && memberPseudo) {
                updatePresetConditions(memberPseudo, presetId);
            }
            return;
        }

        const champData = getChampionByNameExact(championName);
        if (champData) {
            champImg.src = `/tools/champions-index/img/champions/${champData.image}.webp`;
            champImg.style.display = "block";
            rarityImg.src = `/tools/champions-index/img/rarity/${champData.rarity}.webp`;
            rarityImg.style.display = "block";

            // Affinity border
            if (champData.affinity) {
                if (!affinityImg) {
                    affinityImg = document.createElement("img");
                    affinityImg.className = "affinity-img";
                    champSlot.querySelector(".champ-visual").appendChild(affinityImg);
                }
                affinityImg.src = `/tools/champions-index/img/affinity/${champData.affinity}.webp`;
                affinityImg.style.display = "block";
            } else if (affinityImg) {
                affinityImg.style.display = "none";
            }

            // Show/hide stars based on rarity
            if (starsContainer) {
                if (champData.rarity === "Common" || champData.rarity === "Uncommon") {
                    starsContainer.classList.remove("visible");
                } else {
                    starsContainer.classList.add("visible");
                }
            }

            // Update conditions immediately when a valid champion is set
            if (presetId && memberPseudo) {
                updatePresetConditions(memberPseudo, presetId);
            }
        } else {
            champImg.style.display = "none";
            rarityImg.style.display = "none";
            if (affinityImg) affinityImg.style.display = "none";

            // Hide stars if champion not found
            if (starsContainer) {
                starsContainer.classList.remove("visible");
            }
        }
    }

    function savePresetChampion(memberPseudo, presetId, slotName, championName) {
        if (isViewer()) {
            alert("Cannot edit presets in viewer mode.");
            return;
        }

        if (!currentRoomId) {
            console.error("❌ No currentRoomId");
            return;
        }

        const member = clanMembers[memberPseudo];
        if (!member) {
            console.error("❌ Member not found:", memberPseudo);
            return;
        }

        if (!member.presets) member.presets = {};
        if (!member.presets[presetId]) member.presets[presetId] = {};

        member.presets[presetId][slotName] = championName;

        // Update Firebase
        const presetRef = ref(db, `rooms/${currentRoomId}/siege/members/${memberPseudo}/presets/${presetId}`);
        update(presetRef, { [slotName]: championName })
            .catch(err => console.error("❌ Firebase error:", err));

        // Update visual - find the correct preset row using data attributes
        const targetPresetRow = document.querySelector(`.preset-row[data-preset-id="${presetId}"][data-member-pseudo="${memberPseudo}"]`);

        if (targetPresetRow) {
            // Find the specific slot within this preset row
            const champSlot = targetPresetRow.querySelector(`[data-slot-name="${slotName}"]`);
            if (champSlot) {
                // updatePresetChampionVisual will also call updatePresetConditions
                updatePresetChampionVisual(champSlot, championName);
            }

            // Update lead aura if it's the lead slot
            if (slotName === "lead") {
                const leadAura = targetPresetRow.querySelector(".lead-aura-display");
                if (leadAura) {
                    const newLeadAura = createLeadAuraDisplay(championName);
                    leadAura.replaceWith(newLeadAura);
                }
            }
        }

        // Update member count in table
        updateMembersList();
    }

    function updatePresetConditions(memberPseudo, presetId) {
        const member = clanMembers[memberPseudo];
        if (!member || !member.presets || !member.presets[presetId]) {
            return;
        }

        const preset = member.presets[presetId];
        const validatedConditions = getValidatedConditions(preset);

        // Cache the validated conditions in the preset
        preset.cachedConditions = validatedConditions;

        // Save to Firebase
        if (currentRoomId) {
            const presetPath = `rooms/${currentRoomId}/siege/members/${memberPseudo}/presets/${presetId}/cachedConditions`;
            set(ref(db, presetPath), validatedConditions).catch(err => console.error("❌ Firebase save conditions error:", err));
        }

        // Find the conditions grid for THIS specific preset only
        const targetPresetRow = document.querySelector(`.preset-row[data-preset-id="${presetId}"][data-member-pseudo="${memberPseudo}"]`);

        if (targetPresetRow) {
            const conditionsGrid = targetPresetRow.querySelector('.preset-conditions-grid');

            if (conditionsGrid) {
                conditionsGrid.innerHTML = "";
                validatedConditions.forEach(condId => {
                    // Skip effects conditions
                    const condType = getConditionType(condId);
                    if (condType === 'effects' || condType === 'Effects') {
                        return;
                    }

                    const condIcon = getConditionIcon(condId);
                    if (condIcon) {
                        const img = document.createElement("img");
                        img.src = condIcon;
                        img.className = "preset-condition-icon";
                        img.title = getConditionName(condId);
                        conditionsGrid.appendChild(img);
                    }
                });
            }
        }
    }

    // Drag & Drop handlers for presets
    let draggedPresetSlot = null;
    let draggedPresetInfo = null; // Store member and preset ID

    function handlePresetDragStart(e) {
        draggedPresetSlot = e.currentTarget;
        e.currentTarget.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";

        // Store the preset info from the closest preset-row
        const presetRow = e.currentTarget.closest('.preset-row');
        if (presetRow) {
            // Extract member and preset ID from the preset row's context
            const teamSection = presetRow.querySelector('.preset-team-section');
            if (teamSection) {
                const firstSlot = teamSection.querySelector('.champ-slot');
                if (firstSlot) {
                    // We'll store this info to compare later
                    draggedPresetInfo = {
                        presetRow: presetRow
                    };
                }
            }
        }
    }

    function handlePresetDragOver(e) {
        e.preventDefault();

        // Only allow drop if dragging within the same preset row
        if (draggedPresetSlot) {
            const targetPresetRow = e.currentTarget.closest('.preset-row');
            const draggedPresetRow = draggedPresetSlot.closest('.preset-row');

            if (targetPresetRow === draggedPresetRow) {
                e.dataTransfer.dropEffect = "move";
                e.currentTarget.classList.add("drag-over");
            } else {
                e.dataTransfer.dropEffect = "none";
            }
        }
    }

    function handlePresetDrop(e, memberPseudo, presetId) {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.classList.remove("drag-over");

        if (!draggedPresetSlot || draggedPresetSlot === e.currentTarget) return;

        // Verify we're dropping within the same preset
        const targetPresetRow = e.currentTarget.closest('.preset-row');
        const draggedPresetRow = draggedPresetSlot.closest('.preset-row');

        if (targetPresetRow !== draggedPresetRow) {
            return;
        }

        const draggedInput = draggedPresetSlot.querySelector("input");
        const targetInput = e.currentTarget.querySelector("input");

        const tempValue = draggedInput.value;
        const draggedSlot = draggedPresetSlot.dataset.slotName;
        const targetSlot = e.currentTarget.dataset.slotName;

        // Swap values in inputs
        draggedInput.value = targetInput.value;
        targetInput.value = tempValue;

        // Update visuals immediately for both slots
        updatePresetChampionVisual(draggedPresetSlot, draggedInput.value);
        updatePresetChampionVisual(e.currentTarget, targetInput.value);

        // Swap blessings - swap the entire containers
        const draggedVisual = draggedPresetSlot.querySelector(".champ-visual");
        const targetVisual = e.currentTarget.querySelector(".champ-visual");

        if (draggedVisual && targetVisual) {
            const draggedBlessingContainer = draggedVisual.querySelector(".blessing-img-container");
            const targetBlessingContainer = targetVisual.querySelector(".blessing-img-container");

            if (draggedBlessingContainer && targetBlessingContainer) {
                // Clone both containers
                const draggedClone = draggedBlessingContainer.cloneNode(true);
                const targetClone = targetBlessingContainer.cloneNode(true);

                // Replace them
                draggedBlessingContainer.parentNode.replaceChild(targetClone, draggedBlessingContainer);
                targetBlessingContainer.parentNode.replaceChild(draggedClone, targetBlessingContainer);
            }

            // Swap blessing stars
            const draggedStarsContainer = draggedVisual.querySelector(".blessing-stars");
            const targetStarsContainer = targetVisual.querySelector(".blessing-stars");

            if (draggedStarsContainer && targetStarsContainer) {
                // Clone both star containers
                const draggedStarsClone = draggedStarsContainer.cloneNode(true);
                const targetStarsClone = targetStarsContainer.cloneNode(true);

                // Replace them
                draggedStarsContainer.parentNode.replaceChild(targetStarsClone, draggedStarsContainer);
                targetStarsContainer.parentNode.replaceChild(draggedStarsClone, targetStarsContainer);
            }
        }

        // Update lead aura immediately if one of the slots is the lead
        if (draggedSlot === "lead" || targetSlot === "lead") {
            const presetRow = e.currentTarget.closest('.preset-row');
            const leadAura = presetRow ? presetRow.querySelector(".lead-aura-display") : null;
            if (leadAura) {
                const leadValue = targetSlot === "lead" ? targetInput.value : draggedInput.value;
                const newLeadAura = createLeadAuraDisplay(leadValue);
                leadAura.replaceWith(newLeadAura);
            }
        }

        // Update local data
        if (isViewer()) {
            alert("Cannot edit presets in viewer mode.");
            return;
        }

        if (!currentRoomId) {
            console.error("❌ No currentRoomId");
            return;
        }

        const member = clanMembers[memberPseudo];
        if (!member) {
            console.error("❌ Member not found:", memberPseudo);
            return;
        }

        if (!member.presets) member.presets = {};
        if (!member.presets[presetId]) member.presets[presetId] = {};

        // Prepare update object for champions
        const updateData = {
            [draggedSlot]: draggedInput.value,
            [targetSlot]: targetInput.value
        };

        // Update both slots in local data
        member.presets[presetId][draggedSlot] = draggedInput.value;
        member.presets[presetId][targetSlot] = targetInput.value;

        // Swap blessing data in local storage and prepare for Firebase
        const draggedBlessingData = {
            blessing: member.presets[presetId][`${draggedSlot}_blessing`],
            blessing_rarity: member.presets[presetId][`${draggedSlot}_blessing_rarity`],
            blessing_level: member.presets[presetId][`${draggedSlot}_blessing_level`]
        };

        const targetBlessingData = {
            blessing: member.presets[presetId][`${targetSlot}_blessing`],
            blessing_rarity: member.presets[presetId][`${targetSlot}_blessing_rarity`],
            blessing_level: member.presets[presetId][`${targetSlot}_blessing_level`]
        };

        // Swap in local data
        member.presets[presetId][`${draggedSlot}_blessing`] = targetBlessingData.blessing;
        member.presets[presetId][`${draggedSlot}_blessing_rarity`] = targetBlessingData.blessing_rarity;
        member.presets[presetId][`${draggedSlot}_blessing_level`] = targetBlessingData.blessing_level;

        member.presets[presetId][`${targetSlot}_blessing`] = draggedBlessingData.blessing;
        member.presets[presetId][`${targetSlot}_blessing_rarity`] = draggedBlessingData.blessing_rarity;
        member.presets[presetId][`${targetSlot}_blessing_level`] = draggedBlessingData.blessing_level;

        // Add blessing data to Firebase update
        updateData[`${draggedSlot}_blessing`] = targetBlessingData.blessing;
        updateData[`${draggedSlot}_blessing_rarity`] = targetBlessingData.blessing_rarity;
        updateData[`${draggedSlot}_blessing_level`] = targetBlessingData.blessing_level;

        updateData[`${targetSlot}_blessing`] = draggedBlessingData.blessing;
        updateData[`${targetSlot}_blessing_rarity`] = draggedBlessingData.blessing_rarity;
        updateData[`${targetSlot}_blessing_level`] = draggedBlessingData.blessing_level;

        // Save all to Firebase in one update
        const presetRef = ref(db, `rooms/${currentRoomId}/siege/members/${memberPseudo}/presets/${presetId}`);
        update(presetRef, updateData).catch(err => console.error("❌ Firebase error:", err));

        // Update lead aura if one of the slots is the lead
        if (draggedSlot === "lead" || targetSlot === "lead") {
            const leadAura = targetPresetRow.querySelector(".lead-aura-display");
            if (leadAura) {
                const leadValue = targetSlot === "lead" ? targetInput.value : draggedInput.value;
                const newLeadAura = createLeadAuraDisplay(leadValue);
                leadAura.replaceWith(newLeadAura);
            }
        }

        // Update conditions display for this preset
        updatePresetConditions(memberPseudo, presetId);

        // Update member count in table
        updateMembersList();
    }

    function handlePresetDragEnd(e) {
        e.currentTarget.classList.remove("dragging");
        document.querySelectorAll(".champ-slot").forEach(slot => {
            slot.classList.remove("drag-over");
        });
        draggedPresetSlot = null;
        draggedPresetInfo = null;
    }

    // Add preset button
    document.getElementById("addPresetBtn").addEventListener("click", () => {
        if (!currentPresetsMember) {
            console.error("No current member selected");
            return;
        }
        addNewPreset(currentPresetsMember);
    });

    function addNewPreset(memberPseudo) {
        if (isViewer()) {
            alert("Cannot add presets in viewer mode.");
            return;
        }

        if (!currentRoomId) {
            console.error("No room ID");
            return;
        }

        const member = clanMembers[memberPseudo];
        if (!member) {
            console.error("Member not found");
            return;
        }

        if (!member.presets) member.presets = {};

        // Generate new preset ID
        const presetId = `preset_${Date.now()}`;
        member.presets[presetId] = {
            champion4: "",
            champion3: "",
            champion2: "",
            lead: "",
            createdAt: Date.now()
        };

        // Save to Firebase
        const presetRef = ref(db, `rooms/${currentRoomId}/siege/members/${memberPseudo}/presets/${presetId}`);
        set(presetRef, member.presets[presetId]);

        // Refresh display
        renderPresets(memberPseudo);
        updateMembersList();
    }

    function deletePreset(memberPseudo, presetId) {
        if (isViewer()) {
            alert("Cannot delete presets in viewer mode.");
            return;
        }

        if (!confirm("Delete this team preset?")) return;
        if (!currentRoomId) return;

        const member = clanMembers[memberPseudo];
        if (!member || !member.presets) return;

        delete member.presets[presetId];

        // Delete from Firebase
        const presetRef = ref(db, `rooms/${currentRoomId}/siege/members/${memberPseudo}/presets/${presetId}`);
        remove(presetRef);

        // Refresh display
        renderPresets(memberPseudo);
        updateMembersList();
    }

    // ==================== SCROLL TO TOP BUTTON ====================
    const scrollToTopBtn = document.getElementById("scrollToTopBtn");
    const mapSection = document.querySelector(".map-section");

    // Show/hide button based on scroll position
    function toggleScrollButton() {
        if (!mapSection || !scrollToTopBtn) return;

        const mapBottom = mapSection.offsetTop + mapSection.offsetHeight;
        const scrollPosition = window.scrollY || document.documentElement.scrollTop;

        if (scrollPosition > mapBottom) {
            scrollToTopBtn.classList.add("visible");
        } else {
            scrollToTopBtn.classList.remove("visible");
        }
    }

    // Add scroll event listener
    window.addEventListener("scroll", toggleScrollButton);

    // Add click event to button
    if (scrollToTopBtn) {
        scrollToTopBtn.addEventListener("click", smoothScrollToTop);
    }

    // Initial check
    toggleScrollButton();
});
