// Fill banner with event info (name, type pill, datespan)
function fillTitanBanner(fusionName, data) {
  const nameEl = document.getElementById('banner-champ-name');
  const dateEl = document.getElementById('banner-datespan');

  if (nameEl) nameEl.textContent = (data?.title || fusionName || '').toUpperCase();

  if (dateEl) {
    const events = Array.isArray(data?.events) ? data.events : [];
    if (events.length > 0) {
      const starts = events.map(e => e.start_date).filter(Boolean).sort();
      const ends = events.map(e => e.end_date).filter(Boolean).sort();
      const first = starts[0];
      const last = ends[ends.length - 1];
      dateEl.textContent = first && last ? `${first} → ${last}` : '';
    } else {
      dateEl.textContent = '';
    }
  }
}
window.fillTitanBanner = fillTitanBanner;

// Chargement de l'événement Titan basé sur le hash de l'URL
function loadFusionFromHash() {
  let fusionKey = window.location.hash;
  fusionKey = fusionKey.replace(/^#+/, '').replace(/^\/+/, '');

  if (!fusionKey) return;

  const fusion = window.fusions[fusionKey];
  const nameEl = document.getElementById('banner-champ-name');
  if (fusion) {
    if (nameEl) nameEl.textContent = fusion.name.toUpperCase();
    document.title = `${fusion.name} - ${window.siteConfig.title}`;
    const timelineContainer = document.getElementById('timeline-container');
    timelineContainer.setAttribute('data-json', fusion.json);
    if (typeof window.reloadTimeline === 'function') window.reloadTimeline();
  } else {
    if (nameEl) nameEl.textContent = 'UNLISTED TITAN EVENT';
    document.title = 'Unlisted Titan Event - ' + window.siteConfig.title;
  }
}

loadFusionFromHash();
window.addEventListener('hashchange', loadFusionFromHash);
