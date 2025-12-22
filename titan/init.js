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
