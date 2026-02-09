// Load fusion based on URL hash
function loadFusionFromHash() {
  let fusionKey = window.location.hash;

  // Remove all '#' from beginning
  fusionKey = fusionKey.replace(/^#+/, '');

  // Remove all '/' from beginning
  fusionKey = fusionKey.replace(/^\/+/, '');

  const fusion = window.fusions[fusionKey];
  if (fusion) {
    document.getElementById('page-title').textContent = fusion.name;
    document.title = `${fusion.name} - ${window.siteConfig.title}`;
    const timelineContainer = document.getElementById('timeline-container');
    timelineContainer.setAttribute('data-json', fusion.json);
    if (typeof window.reloadTimeline === 'function') window.reloadTimeline();
  } else {
    document.getElementById('page-title').textContent = "Unlisted fusion yet";
    document.title = "Unlisted fusion - " + window.siteConfig.title;
  }
}

// Initial load
loadFusionFromHash();

// Listen to hash changes
window.addEventListener('hashchange', loadFusionFromHash);

// Auto-open sidebar on desktop only
if (window.innerWidth > 700) {
  document.getElementById("info-sidebar")?.classList.add("open");
}

// Toggle sidebar on button click
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
  const legendPinned = localStorage.getItem('fusion_pin_legend') === 'true';
  const progressPinned = localStorage.getItem('fusion_pin_progress') === 'true';

  function applyPin(type, active) {
    if (type === 'legend') {
      pinnedLegend.classList.toggle('visible', active);
      pinLegendBtn.classList.toggle('active', active);
      localStorage.setItem('fusion_pin_legend', active);
    } else {
      pinnedProgress.classList.toggle('visible', active);
      pinProgressBtn.classList.toggle('active', active);
      localStorage.setItem('fusion_pin_progress', active);
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
      if (localStorage.getItem('fusion_pin_progress') === 'true') {
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
    const active = localStorage.getItem('fusion_pin_legend') !== 'true';
    applyPin('legend', active);
  });

  pinProgressBtn.addEventListener('click', () => {
    const active = localStorage.getItem('fusion_pin_progress') !== 'true';
    applyPin('progress', active);
  });
})();
