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
