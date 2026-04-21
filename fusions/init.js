// Load champions.db once, cached promise
let championsDbPromise = null;
function loadChampions() {
  if (championsDbPromise) return championsDbPromise;
  championsDbPromise = window.initSqlJs({
    locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
  }).then(SQL =>
    fetch(`/tools/champions-index/champions.db?v=${Date.now()}`)
      .then(res => res.arrayBuffer())
      .then(buffer => {
        const db = new SQL.Database(new Uint8Array(buffer));
        const result = db.exec("SELECT name, faction, affinity, type, image FROM champions;");
        if (!result.length) return [];
        return result[0].values.map(r => ({
          name: r[0], faction: r[1], affinity: r[2], type: r[3], image: r[4]
        }));
      })
  ).catch(err => { console.error("champions.db load failed:", err); return []; });
  return championsDbPromise;
}
window.loadChampions = loadChampions;

// Load fusion based on URL hash
function loadFusionFromHash() {
  let fusionKey = window.location.hash;
  fusionKey = fusionKey.replace(/^#+/, '').replace(/^\/+/, '');
  if (!fusionKey) return;

  const fusion = window.fusions[fusionKey];
  if (fusion) {
    document.title = `${fusion.name} - ${window.siteConfig.title}`;
    const timelineContainer = document.getElementById('timeline-container');
    timelineContainer.setAttribute('data-json', fusion.json);
    if (typeof window.reloadTimeline === 'function') window.reloadTimeline();
  } else {
    const nameEl = document.getElementById('banner-champ-name');
    if (nameEl) nameEl.textContent = "Unlisted fusion";
    document.title = "Unlisted fusion - " + window.siteConfig.title;
  }
}

loadChampions();
loadFusionFromHash();
window.addEventListener('hashchange', loadFusionFromHash);
