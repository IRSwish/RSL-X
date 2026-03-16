// --- titans.js ---
(() => {
  let timelineData = null;

  // util: parse 'YYYY-MM-DD' en Date locale 00:00
  const parseLocal = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0);
  };

  // --- Chargement JSON + rendu ---
  function fetchAndRenderTimeline() {
    const timelineContainer = document.querySelector('.timeline-container');
    if (!timelineContainer) return;

    // Détermination du JSON à partir du hash
    const hash = window.location.hash.replace('#', '');
    const fusionConfig = window.fusions[hash];

    if (!fusionConfig) {
      console.error('Aucun event titan trouvé pour le hash :', hash);
      const tl = timelineContainer.querySelector('.timeline');
      if (tl) tl.innerHTML = '';
      return;
    }

    const jsonPath = `/titan/${fusionConfig.json}`;
    timelineContainer.dataset.json = jsonPath;

    fetch(`${jsonPath}?v=${Date.now()}`)
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

  // Permet à l'index d'appeler un reload
  window.reloadTimeline = fetchAndRenderTimeline;

  window.addEventListener('load', () => {
    fetchAndRenderTimeline();
    if (typeof loadMenu === 'function') loadMenu();
  });

  // Recharger quand on change de hash
  window.addEventListener('hashchange', () => {
    fetchAndRenderTimeline();
  });

  // Re-rendu responsive
  window.addEventListener('resize', () => {
    if (timelineData) renderTimeline(timelineData);
  });

  // --- Rendu principal ---
  function renderTimeline(data) {
    const timelineContainer = document.querySelector('.timeline-container');
    const timeline = document.querySelector('.timeline');
    if (!timeline || !timelineContainer) return;

    timeline.innerHTML = '';

    // Titre
    const pageTitle = document.getElementById('page-title');
    if (pageTitle) {
      pageTitle.innerHTML = `
        <div class="fusion-title-line">
          ${data.title || ''}
        </div>
      `;
    }

    const events = Array.isArray(data.events) ? data.events : [];
    if (events.length === 0) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const minDate = new Date(Math.min(...events.map(e => parseLocal(e.start_date))));
    const maxDate = new Date(Math.max(...events.map(e => parseLocal(e.end_date))));
    const totalDays = Math.ceil((maxDate - minDate) / (1000 * 60 * 60 * 24)) + 1;

    const savedStates = JSON.parse(LS.getItem('pointStates') || '{}');
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

    // Potion Keep par jour de la semaine (0=dim, 1=lun, ..., 6=sam)
    const KEEP_BY_DOW = [
      { name: 'Void',   cls: 'keep-void'   }, // dimanche
      { name: 'Spirit', cls: 'keep-spirit' }, // lundi
      { name: 'Force',  cls: 'keep-force'  }, // mardi
      { name: 'Magic',  cls: 'keep-magic'  }, // mercredi
      { name: 'Spirit', cls: 'keep-spirit' }, // jeudi
      { name: 'Force',  cls: 'keep-force'  }, // vendredi
      { name: 'Magic',  cls: 'keep-magic'  }, // samedi
    ];

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

      const keep = KEEP_BY_DOW[currentDate.getDay()];
      col.innerHTML = `<span class="day">${day}</span><span class="date">${date}</span><span class="keep-pill ${keep.cls}" title="Potion Keep: ${keep.name}"></span>`;

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

      // auto-sélection du jour courant
      if (
        currentDate.getFullYear() === today.getFullYear() &&
        currentDate.getMonth() === today.getMonth() &&
        currentDate.getDate() === today.getDate()
      ) {
        col.classList.add('date-selected');
        selectedDates.add(isoDate);
      }

      col.addEventListener('click', () => {
        const dateKey = col.dataset.date;
        if (selectedDates.has(dateKey)) selectedDates.delete(dateKey);
        else selectedDates.add(dateKey);
        highlightByDates();
      });

      timeline.appendChild(col);
    }

    highlightByDates();

    // Ligne centrale
    const line = document.createElement('div');
    line.classList.add('timeline-line');
    timeline.appendChild(line);

    // Placement des events — split Tournament / Event
    const isTournament = e => (e.type || '').toLowerCase() === 'tournament';
    const tournamentEvts = events.filter(isTournament);
    const eventEvts = events.filter(e => !isTournament(e));

    const placedTournaments = computeTracks([...tournamentEvts], minDate, dayWidth);
    const placedEventEvts = computeTracks([...eventEvts], minDate, dayWidth);

    const sectionGap = 60;
    let evtOffset = 0;

    if (tournamentEvts.length > 0) {
      const sepTop = document.createElement('div');
      sepTop.className = 'section-separator';
      sepTop.dataset.section = 'tournament';
      sepTop.style.top = '62px';
      sepTop.innerHTML = `<span class="section-separator-label">Tournaments</span>`;
      timeline.appendChild(sepTop);
    }

    if (tournamentEvts.length > 0) {
      const tournamentMaxTrack = placedTournaments.length > 0
        ? Math.max(...placedTournaments.map(i => i.top))
        : 0;
      evtOffset = tournamentMaxTrack + 82 + sectionGap;

      if (eventEvts.length > 0) {
        const sep = document.createElement('div');
        sep.className = 'section-separator';
        sep.dataset.section = 'event';
        sep.style.top = `${100 + tournamentMaxTrack + 82 + 10}px`;
        sep.innerHTML = `<span class="section-separator-label">Events</span>`;
        timeline.appendChild(sep);
      }
    }

    const adjustedEventEvts = placedEventEvts.map(i => ({ ...i, top: i.top + evtOffset }));
    const placedEvents = [...placedTournaments, ...adjustedEventEvts];

    placedEvents.forEach((item) => {
      const event = item.event;
      const top = item.top + 100;
      const start = parseLocal(event.start_date);
      const end = parseLocal(event.end_date);

      const dayStart = ((start - minDate) / (1000 * 60 * 60 * 24)) + 0.5;
      const dayEnd = ((end - minDate) / (1000 * 60 * 60 * 24)) + 0.5;

      const block = document.createElement('div');
      block.classList.add('event-block');
      block.classList.add(isTournament(event) ? 'type-tournament' : 'type-event');
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

      // --- POINTS TITAN ---
      const pointsKey = (data.points || 'default').trim();  // ex: "demonslayer"
      const imgSrc = `/style/img/Misc/points-${pointsKey}.webp`;

      const pointsHTML = (event.points || []).map((p, idx) => {
        const safeName = event.name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
        const id = `${safeName}-${event.start_date}-${event.end_date}-${idx}`;

        let initialState;
        if (today < start) initialState = 'state-upcoming';
        else if (today >= start && today <= end) initialState = 'state-ongoing';
        else initialState = 'state-passed';

        const saved = savedStates[id] || initialState;

        return `
          <div class="point-box ${saved}" data-id="${id}">
            <img src="${imgSrc}" alt="${pointsKey} points"/>
            <span>${p}</span>
          </div>
        `;
      }).join('');

      block.innerHTML = `
        <div class="event-name">${event.name}</div>
        <button class="event-reset" title="Reset this event">↺</button>
        <div class="points-container">${pointsHTML}</div>
      `;

      timeline.appendChild(block);
    });

    // Ajuste la hauteur
    const blocks = document.querySelectorAll('.event-block');
    let maxBottom = 0;
    blocks.forEach(b => {
      const bottom = b.offsetTop + b.offsetHeight;
      if (bottom > maxBottom) maxBottom = bottom;
    });
    timeline.style.height = `${maxBottom + 20}px`;

    // Gestion clics sur points
    document.querySelectorAll('.point-box').forEach(box => {
      box.addEventListener('click', () => {
        const parentEvent = box.closest('.event-block');
        const id = box.dataset.id;

        if (parentEvent && parentEvent.classList.contains('event-ended')) {
          const allStates = ['state-upcoming', 'state-ongoing', 'state-validated', 'state-passed'];
          const isValidated = box.classList.contains('state-validated');
          allStates.forEach(s => box.classList.remove(s));
          box.classList.add(isValidated ? 'state-passed' : 'state-validated');
          savedStates[id] = box.classList.contains('state-validated') ? 'state-validated' : 'state-passed';
          LS.setItem('pointStates', JSON.stringify(savedStates));

          const allPoints = parentEvent.querySelectorAll('.point-box');
          const validatedCount = Array.from(allPoints).filter(p => p.classList.contains('state-validated')).length;
          parentEvent.classList.remove('validated', 'partial');
          if (validatedCount === allPoints.length) parentEvent.classList.add('validated');
          else if (validatedCount > 0) parentEvent.classList.add('partial');

          updateSummary();
          updateProgressPanelFromData(timelineData);
          return;
        }

        const states = ['state-upcoming', 'state-ongoing', 'state-validated', 'state-passed'];
        const currentIndex = states.findIndex(s => box.classList.contains(s));
        const nextIndex = (currentIndex + 1) % states.length;

        states.forEach(s => box.classList.remove(s));
        box.classList.add(states[nextIndex]);
        savedStates[id] = states[nextIndex];
        LS.setItem('pointStates', JSON.stringify(savedStates));

        const allPoints = parentEvent.querySelectorAll('.point-box');
        const validatedCount = Array.from(allPoints).filter(p => p.classList.contains('state-validated')).length;
        parentEvent.classList.remove('validated', 'partial');
        if (validatedCount === allPoints.length && allPoints.length > 0) parentEvent.classList.add('validated');
        else if (validatedCount > 0) parentEvent.classList.add('partial');

        updateSummary();
        updateProgressPanelFromData(timelineData);
      });

      box.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const parentEvent = box.closest('.event-block');
        const id = box.dataset.id;

        if (parentEvent && parentEvent.classList.contains('event-ended')) {
          const allStates = ['state-upcoming', 'state-ongoing', 'state-validated', 'state-passed'];
          const isValidated = box.classList.contains('state-validated');
          allStates.forEach(s => box.classList.remove(s));
          box.classList.add(isValidated ? 'state-passed' : 'state-validated');
          savedStates[id] = box.classList.contains('state-validated') ? 'state-validated' : 'state-passed';
          LS.setItem('pointStates', JSON.stringify(savedStates));

          const allPoints = parentEvent.querySelectorAll('.point-box');
          const validatedCount = Array.from(allPoints).filter(p => p.classList.contains('state-validated')).length;
          parentEvent.classList.remove('validated', 'partial');
          if (validatedCount === allPoints.length) parentEvent.classList.add('validated');
          else if (validatedCount > 0) parentEvent.classList.add('partial');

          updateSummary();
          updateProgressPanelFromData(timelineData);
          return;
        }

        const states = ['state-upcoming', 'state-ongoing', 'state-validated', 'state-passed'];
        const currentIndex = states.findIndex(s => box.classList.contains(s));
        const prevIndex = (currentIndex - 1 + states.length) % states.length;

        states.forEach(s => box.classList.remove(s));
        box.classList.add(states[prevIndex]);
        savedStates[id] = states[prevIndex];
        LS.setItem('pointStates', JSON.stringify(savedStates));

        const allPoints = parentEvent.querySelectorAll('.point-box');
        const validatedCount = Array.from(allPoints).filter(p => p.classList.contains('state-validated')).length;
        parentEvent.classList.remove('validated', 'partial');
        if (validatedCount === allPoints.length && allPoints.length > 0) parentEvent.classList.add('validated');
        else if (validatedCount > 0) parentEvent.classList.add('partial');

        updateSummary();
        updateProgressPanelFromData(timelineData);
      });
    });

    // Reset individuel par event
    document.querySelectorAll('.event-reset').forEach(btn => {
      btn.addEventListener('click', () => {
        const parentEvent = btn.closest('.event-block');
        if (!parentEvent) return;

        const start = parseLocal(parentEvent.dataset.start);
        const end = parseLocal(parentEvent.dataset.end);

        parentEvent.classList.remove('validated', 'partial');

        parentEvent.querySelectorAll('.point-box').forEach(box => {
          const id = box.dataset.id;
          let initialState;
          if (today < start) initialState = 'state-upcoming';
          else if (today >= start && today <= end) initialState = 'state-ongoing';
          else initialState = 'state-passed';

          box.className = `point-box ${initialState}`;
          savedStates[id] = initialState;
        });

        LS.setItem('pointStates', JSON.stringify(savedStates));
        updateSummary();
        updateProgressPanelFromData(timelineData);
      });
    });

    highlightByDates();
    updateSummary();
    updateProgressPanelFromData(timelineData);
  }

  function computeTracks(events, minDate, dayWidth) {
    const tracks = [];
    const placedEvents = [];
    events.sort((a, b) => parseLocal(a.start_date) - parseLocal(b.start_date));

    events.forEach(event => {
      const start = parseLocal(event.start_date);
      const end = parseLocal(event.end_date);
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

  // ——— Résumé chiffres (Acquired / Virtual / Skipped) ———
  function updateSummary() {
    let totalAcquired = 0, totalOngoing = 0, totalPassed = 0;

    document.querySelectorAll('.point-box').forEach(box => {
      const p = parseInt(box.querySelector('span')?.textContent || '0', 10);
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

  // ——— Panneau Progress TITAN ———
  function updateProgressPanelFromData(data) {
    const panel = document.getElementById('progress-panel');
    if (!panel || !data) return;

    const boxes = Array.from(document.querySelectorAll('.point-box'));
    if (boxes.length === 0) {
      panel.innerHTML = '';
      return;
    }

    let totalValidated = 0;
    let totalOngoing = 0;
    let totalSkipped = 0;
    let totalMax = 0;

    // total max = somme de tous les points du JSON
    (data.events || []).forEach(ev => {
      (ev.points || []).forEach(v => {
        totalMax += v;
      });
    });

    boxes.forEach(b => {
      const val = parseInt(b.querySelector('span')?.textContent || '0', 10);
      if (b.classList.contains('state-validated')) totalValidated += val;
      else if (b.classList.contains('state-ongoing')) totalOngoing += val;
      else if (b.classList.contains('state-passed')) totalSkipped += val;
    });

    const totalVirtual = totalValidated + totalOngoing;
    const percent = totalMax > 0 ? Math.min((totalValidated / totalMax) * 100, 100) : 0;

    const pointsKey = (data.points || 'default').trim();
    const imgSrc = `/style/img/Misc/points-${pointsKey}.webp`;

    panel.innerHTML = `
      <div class="stat">
        <img class="stat-icon" src="${imgSrc}" alt="${pointsKey} points"/>
        <div style="width:100%">
          <span class="label">Titan Points</span>
          <span class="value">${totalValidated} / ${totalMax}</span>
          <div class="frag-bar">
            <div class="frag-fill" style="width:${percent}%"></div>
          </div>
          <div style="font-size:12px;opacity:.8">
            Virtual: ${totalVirtual} • Skipped: ${totalSkipped}
          </div>
        </div>
      </div>
    `;
  }

})();
