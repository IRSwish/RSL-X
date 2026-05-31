/* ============================================================
   Migration localStorage — IMPORT (côté rsl-x.gg / v2)
   ------------------------------------------------------------
   L'ancien site (rsl-x.vercel.app) encode tout son localStorage
   dans le hash de l'URL : https://rsl-x.gg/#rslx-migrate=<base64>.
   On le décode et on réinjecte les clés ici, une seule fois.
   Code temporaire — à retirer après la fenêtre de migration.
   ============================================================ */
(function migrateImport() {
  try {
    var MARKER = "#rslx-migrate=";
    var idx = window.location.hash.indexOf(MARKER);
    if (idx === -1) return;

    var b64 = window.location.hash.slice(idx + MARKER.length);
    // Nettoie le hash tout de suite (évite le re-traitement / le bookmark).
    var cleanHash = window.location.hash.slice(0, idx);
    history.replaceState(null, "", window.location.pathname + window.location.search + cleanHash);

    if (localStorage.getItem("rslx_migrated") === "1") return; // déjà fait

    // base64 → JSON (UTF-8 safe)
    var json = decodeURIComponent(
      atob(decodeURIComponent(b64))
        .split("")
        .map(function (c) { return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2); })
        .join("")
    );
    var data = JSON.parse(json);

    Object.keys(data).forEach(function (k) {
      // On ne réécrit pas une clé déjà présente localement (données plus récentes).
      if (localStorage.getItem(k) === null) localStorage.setItem(k, data[k]);
    });
    localStorage.setItem("rslx_migrated", "1");
  } catch (e) {
    console.warn("[rslx-migrate] import failed:", e);
  }
})();

window.siteConfig = {
  title: "RSL-X",
  adBanner: {
    enabled: true,
    imageUrl: "/Ad_Banner.webp",
    link: "https://pl.go-ga.me/0ogmpbrq"
  }
};