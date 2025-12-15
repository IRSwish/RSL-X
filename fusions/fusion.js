// --- fusion.js ---
(() => {
  let timelineData = null;

  // util: parse 'YYYY-MM-DD' en Date locale 00:00
  const parseLocal = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0);
  };

    // clé unique pour stocker le choix d'extra fragments d'un event
  const makeExtraKey = (event) => {
    const safeName = (event.name || '').replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
    return `extra_${safeName}_${event.start_date}_${event.end_date}`;
  };

  // mappe "Rare"/"Epic"/"Fragments" -> vrais noms/images selon le JSON + type
  function resolveRewardName(raw, dataType, data) {
    const r = (raw || '').trim();
    const upper = r.toUpperCase();

    // Évite les champs d'affinité
    if (['RAREAFF','EPICAFF'].includes(upper)) return r;

    if (dataType === 'CLASSIC') {
      if (upper === 'RARE')  return data?.Rare || 'Rare';
      if (upper === 'EPIC')  return data?.Epic || 'Epic';
      if (upper === 'RARE1') return data?.Rare1 || 'Rare1';
      if (upper === 'RARE2') return data?.Rare2 || 'Rare2';
      if (upper === 'RARE3') return data?.Rare3 || 'Rare3';
      if (upper === 'RARE4') return data?.Rare4 || 'Rare4';
    }

    if (upper.includes('FRAG')) return 'Fragments';
    return r;
  }


  function fetchAndRenderTimeline() {
    const timelineContainer = document.querySelector('.timeline-container');
    if (!timelineContainer) return;

    let hashRaw = window.location.hash;

    // enlève tous les '#' du début
    hashRaw = hashRaw.replace(/^#+/, '');

    // enlève tous les '/' du début (si #/Kroz, #//Kroz, etc.)
    hashRaw = hashRaw.replace(/^\/+/, '');

    const hash = hashRaw;
    
    const fusionConfig = window.fusions[hash];
    if (!fusionConfig) {
      console.error('Aucune fusion trouvée pour le hash :', hash);
      const tl = timelineContainer.querySelector('.timeline');
      if (tl) tl.innerHTML = '';
      return;
    }

    const jsonPath = `/fusions/${fusionConfig.json}`;
    timelineContainer.dataset.json = jsonPath;

    fetch(jsonPath)
      .then(res => {
        if (!res.ok) throw new Error(`Erreur HTTP ${res.status}`);
        return res.json();
      })
      .then(data => {
        timelineData = data;
        renderTimeline(data);
      })
      .catch(err => {
        console.error('Erreur lors du chargement du JSON :', err);
        const tl = timelineContainer.querySelector('.timeline');
        if (tl) tl.innerHTML = '';
      });
  }

  window.reloadTimeline = fetchAndRenderTimeline;
  window.addEventListener('load', () => { fetchAndRenderTimeline(); loadMenu(); });
  window.addEventListener('hashchange', fetchAndRenderTimeline);
  window.addEventListener('resize', () => { if (timelineData) renderTimeline(timelineData); });

  // --- Rendu principal ---
  function renderTimeline(data) {
    const timelineContainer = document.querySelector('.timeline-container');
    const timeline = document.querySelector('.timeline');
    if (!timeline || !timelineContainer) return;

    timeline.innerHTML = '';

    const pageTitle = document.getElementById('page-title');
    if (pageTitle) {
      const type = (data.type || '').toUpperCase();
      const dateSpan = data.datespan || '';
      const typeLabel = type ? `${type} FUSION` : 'FUSION';

      pageTitle.innerHTML = `
        <div class="fusion-title-line">
          ${data.title || ''}${typeLabel ? ` • ${typeLabel}` : ''}${dateSpan ? ` • ${dateSpan}` : ''}
        </div>
      `;
    }

    const events = Array.isArray(data.events) ? data.events : [];
    if (events.length === 0) return;

    const today = new Date(); today.setHours(0,0,0,0);

    const minDate = new Date(Math.min(...events.map(e => parseLocal(e.start_date))));
    const maxDate = new Date(Math.max(...events.map(e => parseLocal(e.end_date))));
    const totalDays = Math.ceil((maxDate - minDate) / (1000 * 60 * 60 * 24)) + 1;

    const savedStates = JSON.parse(localStorage.getItem('pointStates') || '{}');
    const horizontalGap = 16;

    const containerStyle = getComputedStyle(timelineContainer);
    const usableWidth = timelineContainer.clientWidth
      - parseFloat(containerStyle.paddingLeft)
      - parseFloat(containerStyle.paddingRight);
    const dayWidth = usableWidth / totalDays;

    const selectedDates = new Set();

    function highlightByDates() {
      document.querySelectorAll('.date-column').forEach(col => {
        const date = col.dataset.date;
        col.classList.toggle('date-selected', selectedDates.has(date));
      });

      document.querySelectorAll('.event-block').forEach(block => {
        const start = parseLocal(block.dataset.start);
        const end = parseLocal(block.dataset.end);
        let highlighted = false;
        selectedDates.forEach(dateStr => {
          const d = parseLocal(dateStr);
          if (d >= start && d <= end) highlighted = true;
        });
        block.classList.toggle('event-highlight', highlighted);
      });
    }

    // Colonnes de dates
    for (let i = 0; i < totalDays; i++) {
      const currentDate = new Date(minDate);
      currentDate.setDate(minDate.getDate() + i);

      const isoDate = [
        currentDate.getFullYear(),
        String(currentDate.getMonth() + 1).padStart(2, '0'),
        String(currentDate.getDate()).padStart(2, '0')
      ].join('-');

      const day = currentDate.toLocaleDateString('en-US', { weekday: 'short' });
      const date = currentDate.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });

      const col = document.createElement('div');
      col.classList.add('date-column');
      col.style.width = `${dayWidth}px`;
      col.dataset.date = isoDate;

      col.innerHTML = `<span class="day">${day}</span><span class="date">${date}</span>`;

      if (i > 0) {
        const leftLine = document.createElement('div');
        leftLine.classList.add('grid-line');
        leftLine.style.left = '0';
        col.appendChild(leftLine);
      }
      if (i < totalDays - 1) {
        const rightLine = document.createElement('div');
        rightLine.classList.add('grid-line');
        rightLine.style.right = '0';
        col.appendChild(rightLine);
      }

      if (
        currentDate.getFullYear() === today.getFullYear() &&
        currentDate.getMonth() === today.getMonth() &&
        currentDate.getDate() === today.getDate()
      ) {
        col.classList.add('date-selected');
        selectedDates.add(isoDate);
      }

      col.addEventListener('click', () => {
        const date = col.dataset.date;
        if (selectedDates.has(date)) selectedDates.delete(date);
        else selectedDates.add(date);
        highlightByDates();
      });

      timeline.appendChild(col);
    }

    highlightByDates();

    // Ligne centrale
    const line = document.createElement('div');
    line.classList.add('timeline-line');
    timeline.appendChild(line);

    // Placement des events
    const placedEvents = computeTracks(events, minDate, dayWidth);
    placedEvents.forEach((item) => {
      const event = item.event;
      const top = item.top + 100;
      const start = parseLocal(event.start_date);
      const end = parseLocal(event.end_date);

      const dayStart = ((start - minDate) / (1000 * 60 * 60 * 24)) + 0.5;
      const dayEnd = ((end - minDate) / (1000 * 60 * 60 * 24)) + 0.5;

      const block = document.createElement('div');
      block.classList.add('event-block');
      block.dataset.start = event.start_date;
      block.dataset.end = event.end_date;

      const left = Math.round(dayStart * dayWidth + horizontalGap / 2);
      const width = Math.round((dayEnd - dayStart) * dayWidth - horizontalGap);

      block.style.left = `${left}px`;
      block.style.width = `${width}px`;
      block.style.top = `${top}px`;

      // États fin d'événement
      if (end.getTime() < today.getTime()) {
        block.classList.add('event-ended');
        const allPoints = (event.points || []).length;
        const allIds = Array.from({ length: allPoints }, (_, idx) => {
          const safeName = event.name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
          return `${safeName}-${event.start_date}-${event.end_date}-${idx}`;
        });
        const validatedCount = allIds.filter(pid => savedStates[pid] === 'state-validated').length;
        if (validatedCount === allPoints && allPoints > 0) block.classList.add('validated');
        else if (validatedCount > 0) block.classList.add('partial');
      }

      // ——— POINTS (avec mapping Rare/Epic -> noms concrets) ———
      const rewardTokens = (event.reward || '').split(',').map(r => r.trim());
      const type = (data.type || '').toUpperCase();
      const pointsHTML = (event.points || []).map((p, idx) => {
        const safeName = event.name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
        const id = `${safeName}-${event.start_date}-${event.end_date}-${idx}`;
        let initialState;
        if (today < start) initialState = 'state-upcoming';
        else if (today >= start && today <= end) initialState = 'state-ongoing';
        else initialState = 'state-passed';

        const saved = savedStates[id] || initialState;

        // mapping du token reward -> vrai nom image+compte
        const tokenRaw = rewardTokens[idx] || 'default';
        const rewardName = resolveRewardName(tokenRaw, type, data); // <= clé
        const imgName = rewardName; // on suppose <Nom>.webp ou 'Fragments'

        return `<div class="point-box ${saved}" data-id="${id}" data-reward="${rewardName}">
                  <img src="/tools/champions-index/img/champions/${imgName}.webp" alt="${rewardName}"/>
                  <span>${p}</span>
                </div>`;
      }).join('');

            block.innerHTML = `
        <div class="event-name">${event.name}</div>
        <button class="event-reset" title="Reset"><i data-lucide="rotate-cw"></i></button>
        <div class="points-container">${pointsHTML}</div>
      `;

      // --- Extra rewards (classement 1st/2nd place) uniquement pour les fusions Fragment ---
      const fusionType = (data.type || '').toUpperCase();
      if (fusionType === 'FRAGMENT' && Array.isArray(event.extra_choices) && event.extra_choices.length > 0) {
        const extraKey = makeExtraKey(event);
        const savedValue = parseInt(localStorage.getItem(extraKey) || '0', 10);

        const extraDiv = document.createElement('div');
        extraDiv.className = 'extra-choices';

        const title = document.createElement('div');
        title.className = 'extra-title';
        title.textContent = 'Extra reward (choose one)';
        extraDiv.appendChild(title);

        event.extra_choices.forEach(choice => {
          const val = parseInt(choice.fragments || 0, 10);
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'extra-choice';
          btn.dataset.value = String(val);
          btn.textContent = `${choice.label} (+${val})`;

          if (savedValue === val && val > 0) {
            btn.classList.add('active');
          }

          btn.addEventListener('click', () => {
            const current = parseInt(localStorage.getItem(extraKey) || '0', 10);
            const newValue = (current === val ? 0 : val);

            localStorage.setItem(extraKey, String(newValue));

            // visuel : un seul choix actif
            extraDiv.querySelectorAll('.extra-choice').forEach(el => el.classList.remove('active'));
            if (newValue > 0) btn.classList.add('active');

            // met à jour uniquement les panneaux qui utilisent les fragments
            updateProgressPanelFromData(timelineData);
          });

          extraDiv.appendChild(btn);
        });

        // --- Extra rewards (classement 1st/2nd) version compact corner ---
        if (fusionType === 'FRAGMENT' && Array.isArray(event.extra_choices) && event.extra_choices.length > 0) {
            const extraKey = makeExtraKey(event);
            const savedValue = parseInt(localStorage.getItem(extraKey) || '0', 10);

            const corner = document.createElement('div');
            corner.className = 'extra-corner';

            event.extra_choices.forEach((choice, index) => {
              const val = parseInt(choice.fragments || 0, 10);
              const btn = document.createElement('div');
              btn.className = 'extra-corner-btn';
              btn.dataset.value = String(val);

              // Emoji 🥇 / 🥈
              btn.innerHTML = `
                <span class="medal">${index === 0 ? '🥇' : '🥈'}</span>
                <img class="frag-mini" src="/tools/champions-index/img/champions/Fragments.webp" />
                <span class="frag-val">+${val}</span>
              `;

              if (savedValue === val && val > 0) {
                btn.classList.add('active');
              }

              btn.addEventListener('click', () => {
                const current = parseInt(localStorage.getItem(extraKey) || '0', 10);
                const newValue = (current === val ? 0 : val);
                localStorage.setItem(extraKey, String(newValue));

                corner.querySelectorAll('.extra-corner-btn').forEach(el => el.classList.remove('active'));
                if (newValue > 0) btn.classList.add('active');

                updateProgressPanelFromData(timelineData);
              });

              corner.appendChild(btn);
            });

            block.appendChild(corner);
        }

      }

      timeline.appendChild(block);
    });

    // Ajuste la hauteur
    const blocks = document.querySelectorAll('.event-block');
    let maxBottom = 0;
    blocks.forEach(b => { const bottom = b.offsetTop + b.offsetHeight; if (bottom > maxBottom) maxBottom = bottom; });
    timeline.style.height = `${maxBottom + 20}px`;

    // Clicks sur points
    document.querySelectorAll('.point-box').forEach(box => {
      box.addEventListener('click', (e) => {
        const parentEvent = box.closest('.event-block');
        const id = box.dataset.id;

        if (parentEvent && parentEvent.classList.contains('event-ended')) {
          if (box.classList.contains('state-validated')) {
            box.classList.remove('state-validated'); box.classList.add('state-passed');
          } else {
            box.classList.remove('state-passed'); box.classList.add('state-validated');
          }
          savedStates[id] = box.classList.contains('state-validated') ? 'state-validated' : 'state-passed';
          localStorage.setItem('pointStates', JSON.stringify(savedStates));

          const allPoints = parentEvent.querySelectorAll('.point-box');
          const validatedCount = Array.from(allPoints).filter(p => p.classList.contains('state-validated')).length;
          parentEvent.classList.remove('validated', 'partial');
          if (validatedCount === allPoints.length) parentEvent.classList.add('validated');
          else if (validatedCount > 0) parentEvent.classList.add('partial');

          updateSummary();
          updateProgressPanelFromData(timelineData);
          buildResourcesPanel(timelineData);
          return;
        }

        const states = ['state-upcoming', 'state-ongoing', 'state-validated', 'state-passed'];
        const currentIndex = states.findIndex(s => box.classList.contains(s));
        const nextIndex = (e.ctrlKey || e.metaKey)
          ? (currentIndex - 1 + states.length) % states.length
          : (currentIndex + 1) % states.length;

        states.forEach(s => box.classList.remove(s));
        box.classList.add(states[nextIndex]);
        savedStates[id] = states[nextIndex];
        localStorage.setItem('pointStates', JSON.stringify(savedStates));

        updateSummary();
        updateProgressPanelFromData(timelineData);
        buildResourcesPanel(timelineData);
      });
    });

    // Reset individuel
    document.querySelectorAll('.event-reset').forEach(btn => {
      btn.addEventListener('click', () => {
        const parentEvent = btn.closest('.event-block');
        if (!parentEvent) return;

        const boxes = parentEvent.querySelectorAll('.point-box');
        const start = new Date(parentEvent.dataset.start);
        const end = new Date(parentEvent.dataset.end);

        boxes.forEach(box => {
          const id = box.dataset.id;
          let initialState;
          if (today < start) initialState = 'state-upcoming';
          else if (today >= start && today <= end) initialState = 'state-ongoing';
          else initialState = 'state-passed';
          box.className = `point-box ${initialState}`;
          savedStates[id] = initialState;
        });

        parentEvent.classList.remove('validated', 'partial');
        localStorage.setItem('pointStates', JSON.stringify(savedStates));
        updateSummary();
        updateProgressPanelFromData(timelineData);
        buildResourcesPanel(timelineData);
      });
    });

    // Reset global (petit bouton ↺ ajouté si besoin)
    const summaryBox = document.querySelector('.summary-box'); // (si tu l'utilises encore ailleurs)
    if (summaryBox && !document.getElementById('reset-global')) {
      const globalBtn = document.createElement('button');
      globalBtn.id = 'reset-global';
      globalBtn.className = 'global-reset';
      globalBtn.textContent = '↺';
      summaryBox.appendChild(globalBtn);

      globalBtn.addEventListener('click', () => {
        if (!confirm('Reset all points ?')) return;

        document.querySelectorAll('.point-box').forEach(box => {
          const parent = box.closest('.event-block');
          const start = new Date(parent.dataset.start);
          const end = new Date(parent.dataset.end);
          let initialState;
          if (today < start) initialState = 'state-upcoming';
          else if (today >= start && today <= end) initialState = 'state-ongoing';
          else initialState = 'state-passed';
          box.className = `point-box ${initialState}`;
          savedStates[box.dataset.id] = initialState;
        });

        document.querySelectorAll('.event-block').forEach(ev => ev.classList.remove('validated', 'partial'));
        localStorage.setItem('pointStates', JSON.stringify(savedStates));
        updateSummary();
        updateProgressPanelFromData(timelineData);
        buildResourcesPanel(timelineData);
      });
    }

    highlightByDates();
    updateSummary();
    updateProgressPanelFromData(timelineData);
    buildResourcesPanel(timelineData);

    // (Re)dessine les icônes Lucide pour les éléments créés dynamiquement
    if (window.lucide && lucide.createIcons) {
      lucide.createIcons();
    }
  }

  function computeTracks(events, minDate, dayWidth) {
    const tracks = [];
    const placedEvents = [];
    events.sort((a, b) => new Date(a.start_date) - new Date(b.start_date));
    events.forEach(event => {
      const start = new Date(event.start_date);
      const end = new Date(event.end_date);
      const startPx = (start - minDate) / (1000 * 60 * 60 * 24) * dayWidth;
      const endPx = (end - minDate) / (1000 * 60 * 60 * 24) * dayWidth;
      let placed = false;
      for (let i = 0; i < tracks.length; i++) {
        const line = tracks[i];
        if (!line.some(e => (startPx < e.endPx && endPx > e.startPx))) {
          line.push({ startPx, endPx });
          placedEvents.push({ event, top: i * 110 });
          placed = true;
          break;
        }
      }
      if (!placed) {
        tracks.push([{ startPx, endPx }]);
        placedEvents.push({ event, top: (tracks.length - 1) * 110 });
      }
    });
    return placedEvents;
  }

  function updateSummary() {
    let totalAcquired = 0, totalOngoing = 0, totalPassed = 0;
    document.querySelectorAll('.point-box').forEach(box => {
      const p = parseInt(box.querySelector('span').textContent) || 0;
      if (box.classList.contains('state-validated')) totalAcquired += p;
      else if (box.classList.contains('state-ongoing')) totalOngoing += p;
      else if (box.classList.contains('state-passed')) totalPassed += p;
    });
    const elAcquired = document.getElementById('points-acquired');
    if (elAcquired) elAcquired.textContent = totalAcquired;
    const elVirtual = document.getElementById('points-virtual');
    if (elVirtual) elVirtual.textContent = totalAcquired + totalOngoing;
    const elPassed = document.getElementById('points-passed');
    if (elPassed) elPassed.textContent = totalPassed;
  }

  // ——— Panneau Progress adaptatif ———
  function updateProgressPanelFromData(data) {
    const panel = document.getElementById('progress-panel');
    if (!panel || !data) return;

    const type = (data.type || '').toUpperCase();
    const boxes = Array.from(document.querySelectorAll('.point-box'));

    // Compteurs visuels globaux (pour le reste de la page)
    const elA = document.getElementById('points-acquired');
    const elV = document.getElementById('points-virtual');
    const elS = document.getElementById('points-passed');

    // Ajout affinités pour cohérence d'affichage
    const rareAff = (data.RareAff || 'magic').toLowerCase();
    const epicAff = (data.EpicAff || 'magic').toLowerCase();

    // === FRAGMENT / HYBRID ===
       if (type === 'FRAGMENT' || type === 'HYBRID') {
      let fragsValidated = 0;
      let fragsOngoing = 0;
      let fragsSkipped = 0;

      // fragments provenant des events classiques (points)
      boxes.forEach(b => {
        if ((b.dataset.reward || '').toLowerCase().includes('fragment')) {
          const val = parseInt(b.querySelector('span')?.textContent || '0', 10);
          if (b.classList.contains('state-validated')) fragsValidated += val;
          else if (b.classList.contains('state-ongoing')) fragsOngoing += val;
          else if (b.classList.contains('state-passed')) fragsSkipped += val;
        }
      });

      // fragments EXTRA provenant du classement (1st / 2nd place)
      if (type === 'FRAGMENT' && Array.isArray(data.events)) {
        data.events.forEach(ev => {
          if (!Array.isArray(ev.extra_choices) || ev.extra_choices.length === 0) return;
          const extraKey = makeExtraKey(ev);
          const val = parseInt(localStorage.getItem(extraKey) || '0', 10);
          if (val > 0) {
            // on les considère comme des fragments validés (obtenus)
            fragsValidated += val;
          }
        });
      }

      const totalVirtual = fragsValidated + fragsOngoing;
      const target = type === 'HYBRID' ? 400 : 100;
      const percent = Math.min((fragsValidated / target) * 100, 100);

      let statusClass = '';

      // 💚 Priorité au vert : si tu as assez de fragments, on s'en fout des skips
      if (fragsValidated >= target) {
        statusClass = 'status-green';
      } else if (fragsSkipped > 0) {
        // 🔴 Rouge uniquement si tu n'as PAS encore le total nécessaire
        statusClass = 'status-red';
      }

      panel.innerHTML = `
        <div class="stat ${statusClass}">
          <img class="stat-icon" src="/tools/champions-index/img/champions/Fragments.webp" alt="Fragments"/>
          <div style="width:100%">
            <span class="label">${type === 'HYBRID' ? 'Epic Fragments' : 'Fusion Fragments'}</span>
            <span class="value">${fragsValidated} / ${target}</span>
            <div class="frag-bar">
              <div class="frag-fill" style="width:${percent}%"></div>
            </div>
            <div style="font-size:12px;opacity:.8">
              Virtual: ${totalVirtual} • Skipped: ${fragsSkipped}
            </div>
          </div>
        </div>
      `;
      return;
    }

    if (type === 'CLASSIC') {
      const rareKeys = Object.keys(data).filter(k => k.toUpperCase().startsWith('RARE'));
      const multiRare = rareKeys.length > 1;
      const epicName = data.Epic;

      const countValidated = (name) =>
        boxes.filter(b => b.dataset.reward === name && b.classList.contains('state-validated')).length;
      const countOngoing = (name) =>
        boxes.filter(b => b.dataset.reward === name && b.classList.contains('state-ongoing')).length;
      const countSkipped = (name) =>
        boxes.filter(b => b.dataset.reward === name && b.classList.contains('state-passed')).length;

      const allRares = rareKeys.length
        ? rareKeys.map(k => data[k]).filter(Boolean)
        : (data.Rare ? [data.Rare] : []);

      // additionne toutes les copies rares validées
      const raresValidated = allRares.reduce((a, n) => a + countValidated(n), 0);
      const raresOngoing   = allRares.reduce((a, n) => a + countOngoing(n), 0);
      const raresSkipped   = allRares.reduce((a, n) => a + countSkipped(n), 0);

      const epicsValidated = countValidated(epicName);
      const epicsOngoing   = countOngoing(epicName);
      const epicsSkipped   = countSkipped(epicName);

      const totalEquivalent = raresValidated + (4 * epicsValidated);
      const complete = totalEquivalent >= 16 && (raresValidated >= 12 || epicsValidated >= 1);

      const rareStatus = complete ? 'status-green' : '';
      const epicStatus = complete ? 'status-green' : '';

      panel.innerHTML = `
        <div class="progress-grid">
          <div class="stat ${rareStatus}">
            <img class="stat-icon" src="/tools/champions-index/img/champions/${allRares[0]}.webp" alt="Rares"/>
            <div>
              <span class="label">${allRares[0]} (Rare)</span>
              <br />
              <span class="value">${raresValidated} / 16</span>
            </div>
          </div>
          <div class="stat ${epicStatus}">
            <img class="stat-icon" src="/tools/champions-index/img/champions/${epicName}.webp" alt="${epicName}"/>
            <div>
              <span class="label">${epicName} (Epic)</span>
              <br />
              <span class="value">${epicsValidated} / 1</span>
            </div>
          </div>
        </div>
        <div style="font-size:12px;opacity:.8;margin-top:6px">
          Virtual: ${raresValidated + raresOngoing + (4 * (epicsValidated + epicsOngoing))} • Skipped: ${raresSkipped + epicsSkipped}
        </div>
      `;
    }

  }

})();

// ==================== RESOURCES (linked to timeline) ====================

// Tables coûts (par transition)
const RARE_STEPS = [
  { affL:4, arcL:2, affG:0, arcG:0 }, // 0->1
  { affL:6, arcL:3, affG:0, arcG:0 }, // 1->2
  { affL:0, arcL:0, affG:2, arcG:1 }, // 2->3
  { affL:0, arcL:0, affG:2, arcG:1 }, // 3->4
];

const EPIC_STEPS = [
  { affG:4, arcG:3, affS:0, arcS:0 }, // 0->1
  { affG:7, arcG:5, affS:0, arcS:0 }, // 1->2
  { affG:9, arcG:7, affS:0, arcS:0 }, // 2->3
  { affG:0, arcG:0, affS:3, arcS:1 }, // 3->4
  { affG:0, arcG:0, affS:3, arcS:2 }, // 4->5
];

// Helpers coûts cumulés de from -> target
function sumRareCosts(fromStars) {
  const sum = { affL:0, arcL:0, affG:0, arcG:0, affS:0, arcS:0, chk3:0, chk4:0 };
  for (let i=fromStars; i<4; i++) {
    const s = RARE_STEPS[i];
    sum.affL += s.affL; sum.arcL += s.arcL; sum.affG += s.affG; sum.arcG += s.arcG;
  }
  // Chickens fixes par rare (3× 3★)
  sum.chk3 = 3; sum.chk4 = 0;
  return sum;
}

function sumEpicCosts(fromStars) {
  const sum = { affL:0, arcL:0, affG:0, arcG:0, affS:0, arcS:0, chk3:0, chk4:0 };
  for (let i=fromStars; i<5; i++) {
    const s = EPIC_STEPS[i];
    sum.affG += s.affG; sum.arcG += s.arcG; sum.affS += s.affS; sum.arcS += s.arcS;
  }
  // Chickens fixes par epic (4× 4★)
  sum.chk3 = 0; sum.chk4 = 4;
  return sum;
}

// path images
function potionIcon(aff, tier) {
  return `/style/img/Misc/${aff.toLowerCase()}-${tier}.webp`;
}
function arcaneIcon(tier) {
  return `/style/img/Misc/arcane-${tier}.webp`;
}
function chickenIcon(rarity) {
  return `/style/img/Misc/chicken-${rarity}.webp`;
}

// key stockage local
function resKeyStars(fusionKey, name) { return `resStars_${fusionKey}_${name}`; }
function resKeyBuilt(fusionKey, name) { return `resBuilt_${fusionKey}_${name}`; }

// Comptage depuis la timeline : combien de copies validées / planned par champion
function collectTimelineCounts() {
  const map = new Map(); // name -> { validated, planned }
  document.querySelectorAll('.point-box').forEach(b => {
    const name = b.dataset.reward || '';
    if (!name) return;
    const rec = map.get(name) || { validated:0, planned:0 };
    const val = parseInt(b.querySelector("span")?.textContent || "0", 10);

    if (b.classList.contains('state-validated')) rec.validated += val;
    else if (b.classList.contains('state-ongoing')) rec.planned += val;
    map.set(name, rec);
  });
  return map;
}

// ==================== BUILD RESOURCES PANEL (individual champion boxes) ====================
function buildResourcesPanel(data) {
  const wrap = document.getElementById('resources-panel-wrapper');
  const panel = document.getElementById('resources-panel');
  if (!wrap || !panel || !data) return;

  const type = (data.type || '').toUpperCase();
  if (type === 'FRAGMENT') {
    wrap.style.display = 'none';
    panel.innerHTML = '';
    return;
  }

  wrap.style.display = '';
  panel.innerHTML = '';

  let fusionKey = window.location.hash;

  // enlève tous les '#' du début
  fusionKey = fusionKey.replace(/^#+/, '');

  // enlève tous les '/' du début
  fusionKey = fusionKey.replace(/^\/+/, '');

  if (!fusionKey) fusionKey = 'default';

  const rareAff = (data.RareAff || 'magic').toLowerCase();
  const epicAff = (data.EpicAff || 'magic').toLowerCase();
  const counts = collectTimelineCounts();

  // --- Construire la liste d’instances individuelles (1 carte = 1 exemplaire) ---
  const entries = [];
  const pushCopies = (name, kind, aff, starsMax, count) => {
    for (let i = 1; i <= count; i++) {
      entries.push({ id: `${name}-${i}`, name, kind, aff, starsMax });
    }
  };

  if (type === 'CLASSIC') {
    const rareKeys = Object.keys(data).filter(k => k.toUpperCase().startsWith('RARE'));
    const rareNames = rareKeys.length
      ? rareKeys.map(k => data[k]).filter(Boolean)
      : (data.Rare ? [data.Rare] : []);

    let totalRareCopies = 0;

    rareNames.forEach(name => {
      const c = counts.get(name);
      if (!c) return;
      const total = (c.validated || 0) + (c.planned || 0);
      totalRareCopies += total;
      pushCopies(name, 'RARE', rareAff, 4, total);
    });

    // ⚙️ Épics obtenus :
let epicsTotal = 0;
if (data.Epic) {

  // Copies physiques obtenues via events
  const ce = counts.get(data.Epic);
  const fromEvents = ce ? (ce.validated || 0) + (ce.planned || 0) : 0;

  // Comptage des rares réellement BUILT (rank max + asc max)
  let raresBuilt = 0;
  entries.forEach(ent => {
    if (ent.kind === 'RARE') {

      const rank = parseInt(localStorage.getItem(`resRank_${fusionKey}_${ent.id}`) || '0', 10);
      const asc  = parseInt(localStorage.getItem(`resAsc_${fusionKey}_${ent.id}`)  || '0', 10);

      // Rare built = rank max *et* asc max
      if (rank >= ent.starsMax && asc >= ent.starsMax) {
        raresBuilt++;
      }
    }
  });

  // 1 epic gratuit pour 4 rares built
  const fromRares = Math.floor(raresBuilt / 4);

  // Total final = copies event + épics gratuits
  epicsTotal = fromEvents + fromRares;

  // Ajout dans la ressource
  if (epicsTotal > 0) {
    pushCopies(data.Epic, 'EPIC', epicAff, 5, epicsTotal);
  }
}
  } else if (type === 'HYBRID' && data.Epic) {
    const cf = counts.get('Fragments') || { validated: 0, planned: 0 };
    const totalEpics = Math.floor(((cf.validated || 0) + (cf.planned || 0)) / 100);
    if (totalEpics > 0) pushCopies(data.Epic, 'EPIC', epicAff, 5, totalEpics);
  }

  // 🟦 HYBRID : toujours afficher le panneau, même si tu n'as pas encore 100 fragments
  if (type === 'HYBRID') {
    wrap.style.display = ''; // panneau visible
  } else {
    // CLASSIC et FRAGMENT : comportement normal
    if (entries.length === 0) {
      wrap.style.display = 'none';
      return;
    }
  }

  // helpers icônes
  const imgPath = (n) => `/tools/champions-index/img/champions/${n.replace(/\s+/g,'-').replace(/[^a-zA-Z0-9-]/g,'')}.webp`;

  // on construit d’abord toutes les cartes, puis on fera le résumé global
  const cards = [];

  entries.forEach(e => {
    const card = document.createElement('div');
    card.className = 'res-card';

    // image
    const img = document.createElement('img');
    img.className = 'champ';
    img.src = imgPath(e.name);
    img.alt = e.name;
    card.appendChild(img);

    // storage keys (par exemplaire)
    const storeRankKey = `resRank_${fusionKey}_${e.id}`;
    const storeAscKey  = `resAsc_${fusionKey}_${e.id}`;

    // états init
    let rankVal = parseInt(localStorage.getItem(storeRankKey) || (e.kind === 'RARE' ? 3 : 4), 10);
    let ascVal  = parseInt(localStorage.getItem(storeAscKey)  || '0', 10);

    // fabrique une ligne d’étoiles : boutons wrapper + <i data-lucide="star">
    const makeStarsLine = (count, cls, min, getValue, onChange) => {
      const line = document.createElement('div');
      line.className = `res-stars ${cls}`;

      const refresh = () => {
        const active = getValue();
        line.querySelectorAll('.star-btn').forEach((b, idx) => {
          b.classList.toggle('active', idx + 1 <= active);
        });
      };

      for (let i = 1; i <= count; i++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `star-btn ${cls}-star`;
        btn.dataset.i = i;
        const icon = document.createElement('i');
        icon.setAttribute('data-lucide', 'star');
        btn.appendChild(icon);

        btn.addEventListener('click', () => {
        const current = getValue();

        if (cls === 'rank') {

          const next = (i === current && i > min) ? i - 1 : Math.max(i, min);
          rankVal = next;
          if (ascVal > rankVal) ascVal = rankVal;

          localStorage.setItem(storeRankKey, rankVal);
          localStorage.setItem(storeAscKey, ascVal);

          render();
          updateGlobal();

          // 🔁 IMPORTANT — Reconstruit tout le panel Resources
          buildResourcesPanel(data);

        } else { // ascension

          ascVal = i;
          if (rankVal < ascVal) rankVal = ascVal;

          localStorage.setItem(storeRankKey, rankVal);
          localStorage.setItem(storeAscKey, ascVal);

          render();
          updateGlobal();

          // 🔁 IMPORTANT ici aussi !
          buildResourcesPanel(data);
        }
      });

        line.appendChild(btn);
      }

      requestAnimationFrame(refresh);
      return line;
    };

    const minRank = (e.kind === 'RARE') ? 3 : 4;
    const rankLine = makeStarsLine(e.starsMax, 'rank', minRank, () => rankVal);
    const ascLine  = makeStarsLine(e.starsMax, 'asc',  0,       () => ascVal);

    // reset : reviens aux valeurs par défaut
    const resetBtn = document.createElement('button');
    resetBtn.className = 'res-reset';
    resetBtn.innerHTML = '<i data-lucide="rotate-cw"></i>';
    resetBtn.title = 'Reset';
    resetBtn.addEventListener('click', () => {
      rankVal = (e.kind === 'RARE') ? 3 : 4;
      ascVal = 0;
      localStorage.setItem(storeRankKey, String(rankVal));
      localStorage.setItem(storeAscKey,  String(ascVal));
      render(true);
      updateGlobal();
      buildResourcesPanel(data);
    });

    const render = (uncompact = false) => {
      // maj classes actives
      const rankBtns = rankLine.querySelectorAll('.star-btn');
      rankBtns.forEach((b, idx) => {
        const i = idx + 1;
        b.classList.toggle('active', i <= rankVal);
      });
      const ascBtns = ascLine.querySelectorAll('.star-btn');
      ascBtns.forEach((b, idx) => {
        const i = idx + 1;
        b.classList.toggle('active', i <= ascVal);
      });

      // compact si full (rank max & ascension max)
      const fullRank = (rankVal >= e.starsMax);
      const fullAsc  = (ascVal  >= e.starsMax);
      const isFull   = fullRank && fullAsc;

      card.innerHTML = '';
      if (isFull && !uncompact) {
        card.classList.add('compact');
        const mini = document.createElement('div');
        mini.className = 'mini-line';
        mini.textContent = `${e.name} ✅`;
        card.appendChild(img);
        card.appendChild(mini);
        card.appendChild(resetBtn);
      } else {
        card.classList.remove('compact');
        card.appendChild(img);
        card.appendChild(rankLine);
        card.appendChild(ascLine);
      }

      // (re)crée les icônes Lucide à chaque render
      if (window.lucide && lucide.createIcons) lucide.createIcons();
    };

    card.appendChild(rankLine);
    card.appendChild(ascLine);

    panel.appendChild(card);
    cards.push({ e, card, get rank(){return rankVal;}, get asc(){return ascVal;}, resetBtn });

    render();
  });

  // ——— Résumé global (1ʳᵉ “carte” en tête de grille) ———
  const header = document.createElement('div');
  header.className = 'res-card global';
  header.innerHTML = `
    <div class="global-line">Champions built: <span id="glob-built"></span> / ${entries.length}</div>
    <div class="total-icons" id="glob-icons"></div>
  `;
  panel.prepend(header);

  function totalsFromCards() {
    // On sépare bien les RARES et les EPICS
    const totalsRare = { affL:0,arcL:0,affG:0,arcG:0,affS:0,arcS:0,chk3:0,chk4:0 };
    const totalsEpic = { affL:0,arcL:0,affG:0,arcG:0,affS:0,arcS:0,chk3:0,chk4:0 };
    let builtCount = 0;

    cards.forEach(({ e, rank, asc }) => {
      const fullRank = (rank >= e.starsMax);
      const fullAsc  = (asc  >= e.starsMax);
      if (fullRank && fullAsc) { builtCount += 1; return; } // rien à préparer

      // potions manquantes (à partir d’asc)
      const unit = (e.kind === 'RARE') ? sumRareCosts(asc) : sumEpicCosts(asc);
      const tgt  = (e.kind === 'RARE') ? totalsRare       : totalsEpic;

      tgt.affL += unit.affL; tgt.arcL += unit.arcL;
      tgt.affG += unit.affG; tgt.arcG += unit.arcG;
      tgt.affS += unit.affS; tgt.arcS += unit.arcS;

      // chickens si pas rank max
      if (e.kind === 'RARE' && rank < 4) tgt.chk3 += 3;
      if (e.kind === 'EPIC' && rank < 5) tgt.chk4 += 4;
    });

    return { totalsRare, totalsEpic, builtCount };
  }

  function updateGlobal() {
    const { totalsRare, totalsEpic, builtCount } = totalsFromCards();
    const builtEl = document.getElementById('glob-built');
    if (builtEl) builtEl.textContent = String(builtCount);

    const iconsDiv = document.getElementById('glob-icons');
    if (iconsDiv) {
      iconsDiv.innerHTML = '';
      const addIco = (qty, src) => {
        if (!qty) return;
        const d = document.createElement('div');
        d.className = 'ico';
        d.innerHTML = `<img src="${src}" alt=""><span>×${qty}</span>`;
        iconsDiv.appendChild(d);
      };

      // potions affinité RARES
      addIco(totalsRare.affL, potionIcon(rareAff, 'lesser'));
      addIco(totalsRare.affG, potionIcon(rareAff, 'greater'));
      addIco(totalsRare.affS, potionIcon(rareAff, 'superior'));

      // potions affinité EPICS
      addIco(totalsEpic.affL, potionIcon(epicAff, 'lesser'));
      addIco(totalsEpic.affG, potionIcon(epicAff, 'greater'));
      addIco(totalsEpic.affS, potionIcon(epicAff, 'superior'));

      // arcane (commun RARE+EPIC)
      addIco(totalsRare.arcL + totalsEpic.arcL, arcaneIcon('lesser'));
      addIco(totalsRare.arcG + totalsEpic.arcG, arcaneIcon('greater'));
      addIco(totalsRare.arcS + totalsEpic.arcS, arcaneIcon('superior'));

      // chickens
      addIco(totalsRare.chk3, chickenIcon('3'));
      addIco(totalsEpic.chk4, chickenIcon('4'));
    }
  }

  updateGlobal();
  if (window.lucide && lucide.createIcons) lucide.createIcons();
}



function multiplyCosts(unit, count) {
  return {
    affL: unit.affL * count,
    arcL: unit.arcL * count,
    affG: unit.affG * count,
    arcG: unit.arcG * count,
    affS: unit.affS * count,
    arcS: unit.arcS * count,
    chk3: unit.chk3 * count,
    chk4: unit.chk4 * count,
  };
}

function appendCostIcon(container, qty, src) {
  if (!qty) return;
  const div = document.createElement('div');
  div.className = 'ico';
  const img = document.createElement('img');
  img.src = src;
  img.alt = '';
  div.appendChild(img);
  const span = document.createElement('span');
  span.textContent = `×${qty}`;
  div.appendChild(span);
  container.appendChild(div);
}

function pushPart(arr, qty, label) { if (qty) arr.push(`${qty} ${label}`); }

function updateResourcesSummary(entries, data = timelineData) {
  const header = document.getElementById('resources-summary');
  if (!header) return;

  header.innerHTML = ''; // reset

  // Y = total validés
  const totalOwned = entries.reduce((a,e) => a + e.validated, 0);
  const totalPlanned = entries.reduce((a,e) => a + e.planned, 0);

  // X = somme des "built"
  let totalBuilt = 0;
  const fusionKey = (location.hash || '#').slice(1) || 'default';
  entries.forEach(e => {
    const built = Math.min(parseInt(localStorage.getItem(resKeyBuilt(fusionKey, e.name)) || '0', 10), e.validated);
    totalBuilt += Math.max(0, built);
  });

  // Conteneur global
  const global = document.createElement('div');
  global.id = 'resources-global';

  // Ligne Built
  const line = document.createElement('div');
  line.className = 'global-line';
  line.textContent = `Champions built : ${totalBuilt} / ${totalOwned}${totalPlanned ? ` (${totalPlanned} planned)` : ''}`;
  global.appendChild(line);

  // Totaux de ressources (séparés rare / epic)
  const totalsRare = { affL:0, arcL:0, affG:0, arcG:0, affS:0, arcS:0, chk3:0, chk4:0 };
  const totalsEpic = { affL:0, arcL:0, affG:0, arcG:0, affS:0, arcS:0, chk3:0, chk4:0 };

  entries.forEach(e => {
    const curStars = parseInt(localStorage.getItem(resKeyStars(fusionKey, e.name)) || '0', 10);
    const built = Math.min(parseInt(localStorage.getItem(resKeyBuilt(fusionKey, e.name)) || '0', 10), e.validated);
    const copiesNow = Math.max(0, e.validated - built);
    if (!copiesNow) return;

    const unit = (e.kind === 'RARE') ? sumRareCosts(curStars) : sumEpicCosts(curStars);
    const costs = multiplyCosts(unit, copiesNow);
    const tgt = (e.kind === 'RARE') ? totalsRare : totalsEpic;

    for (const k in tgt) {
      tgt[k] += costs[k];
    }
  });

  // Ligne d’icônes totales
  const iconsDiv = document.createElement('div');
  iconsDiv.className = 'total-icons';

  const rareAff = (entries.find(e => e.kind === 'RARE')?.aff || data.RareAff || 'magic').toLowerCase();
  const epicAff = (entries.find(e => e.kind === 'EPIC')?.aff || data.EpicAff || 'magic').toLowerCase();

  const addIco = (qty, src) => {
    if (!qty) return;
    const d = document.createElement('div');
    d.className = 'ico';
    const img = document.createElement('img');
    img.src = src; img.alt = '';
    d.appendChild(img);
    const span = document.createElement('span');
    span.textContent = `×${qty}`;
    d.appendChild(span);
    iconsDiv.appendChild(d);
  };

  // Potions RARES (affinité)
  addIco(totalsRare.affL, potionIcon(rareAff, 'lesser'));
  addIco(totalsRare.affG, potionIcon(rareAff, 'greater'));
  addIco(totalsRare.affS, potionIcon(rareAff, 'superior'));

  // Potions EPICS (affinité EPIC)
  addIco(totalsEpic.affL, potionIcon(epicAff, 'lesser'));
  addIco(totalsEpic.affG, potionIcon(epicAff, 'greater'));
  addIco(totalsEpic.affS, potionIcon(epicAff, 'superior'));

  // Arcane (commun)
  addIco(totalsRare.arcL + totalsEpic.arcL, arcaneIcon('lesser'));
  addIco(totalsRare.arcG + totalsEpic.arcG, arcaneIcon('greater'));
  addIco(totalsRare.arcS + totalsEpic.arcS, arcaneIcon('superior'));

  // Chickens
  addIco(totalsRare.chk3, chickenIcon('3'));
  addIco(totalsEpic.chk4, chickenIcon('4'));

  global.appendChild(iconsDiv);
  header.appendChild(global);
  if (window.lucide && lucide.createIcons) setTimeout(() => lucide.createIcons(), 0);
}

function makeStarButtons({ min=0, max=4, value=0, onChange }) {
  const wrap = document.createElement('div');
  for (let s=min; s<=max; s++) {
    const b = document.createElement('div');
    b.className = 'star-btn' + (s===value ? ' active':'');
    b.textContent = s; // lisible et rapide
    b.addEventListener('click', () => {
      value = s;
      Array.from(wrap.children).forEach(c => c.classList.remove('active'));
      b.classList.add('active');
      onChange?.(value);
    });
    wrap.appendChild(b);
  }
  return wrap;
}
