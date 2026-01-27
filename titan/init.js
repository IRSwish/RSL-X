// Chargement de l'événement Titan basé sur le hash de l'URL
function loadFusionFromHash() {
  let fusionKey = window.location.hash;

  // enlève tous les '#' du début
  fusionKey = fusionKey.replace(/^#+/, '');

  // enlève tous les '/' du début
  fusionKey = fusionKey.replace(/^\/+/, '');

  const fusion = window.fusions[fusionKey];
  if (fusion) {
    document.getElementById('page-title').textContent = fusion.name;
    document.title = `${fusion.name} - ${window.siteConfig.title}`;
    const timelineContainer = document.getElementById('timeline-container');
    timelineContainer.setAttribute('data-json', fusion.json);
    if (typeof window.reloadTimeline === 'function') window.reloadTimeline();
  } else {
    document.getElementById('page-title').textContent = "Unlisted Titan Event";
    document.title = "Unlisted Titan Event - " + window.siteConfig.title;
  }
}

// Au chargement initial
loadFusionFromHash();

// Écoute les changements de hash
window.addEventListener('hashchange', loadFusionFromHash);

// Toggle du slider info
document.getElementById("info-btn")?.addEventListener("click", () => {
  document.getElementById("info-sidebar").classList.toggle("open");
});

// ——— Pin/Unpin Legend & Progress ———
(function initPinToggle() {
  const pinLegendBtn = document.getElementById('pin-legend-btn');
  const pinProgressBtn = document.getElementById('pin-progress-btn');
  const pinnedLegend = document.getElementById('pinned-legend');
  const pinnedProgress = document.getElementById('pinned-progress');
  const pinnedProgressPanel = document.getElementById('pinned-progress-panel');
  const sidebarProgressPanel = document.getElementById('progress-panel');

  if (!pinLegendBtn || !pinProgressBtn) return;

  // Restore from localStorage
  const legendPinned = localStorage.getItem('titan_pin_legend') === 'true';
  const progressPinned = localStorage.getItem('titan_pin_progress') === 'true';

  function applyPin(type, active) {
    if (type === 'legend') {
      pinnedLegend.classList.toggle('visible', active);
      pinLegendBtn.classList.toggle('active', active);
      localStorage.setItem('titan_pin_legend', active);
    } else {
      pinnedProgress.classList.toggle('visible', active);
      pinProgressBtn.classList.toggle('active', active);
      localStorage.setItem('titan_pin_progress', active);
      if (active) syncPinnedProgress();
    }
  }

  // Sync progress panel content from sidebar to pinned
  function syncPinnedProgress() {
    if (sidebarProgressPanel && pinnedProgressPanel) {
      pinnedProgressPanel.innerHTML = sidebarProgressPanel.innerHTML;
    }
  }

  // Observe sidebar progress panel changes to keep pinned in sync
  if (sidebarProgressPanel && pinnedProgressPanel) {
    const observer = new MutationObserver(() => {
      if (localStorage.getItem('titan_pin_progress') === 'true') {
        syncPinnedProgress();
      }
    });
    observer.observe(sidebarProgressPanel, { childList: true, subtree: true, characterData: true });
  }

  // Apply saved state
  applyPin('legend', legendPinned);
  applyPin('progress', progressPinned);

  // Toggle buttons
  pinLegendBtn.addEventListener('click', () => {
    const active = localStorage.getItem('titan_pin_legend') !== 'true';
    applyPin('legend', active);
  });

  pinProgressBtn.addEventListener('click', () => {
    const active = localStorage.getItem('titan_pin_progress') !== 'true';
    applyPin('progress', active);
  });
})();
