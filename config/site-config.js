/* ============================================================
   Migration localStorage — EXPORT + REDIRECTION (ancien site)
   ------------------------------------------------------------
   À partir de l'heure de bascule, l'ancien site (rsl-x.vercel.app)
   encode TOUT son localStorage dans le hash de l'URL et redirige
   vers le nouveau site, qui réimporte les données au chargement
   (voir l'import dans le site-config.js de la branche v2).

   Garde-fous :
     • ne se déclenche que sur *.vercel.app (jamais en local/dev) ;
     • ne se déclenche qu'à partir de CUTOVER → on peut déployer
       à l'avance, la bascule se fait toute seule à l'heure dite.
   Code temporaire — à retirer une fois la migration terminée.
   ============================================================ */
(function migrateRedirect() {
  var CUTOVER = Date.parse("2026-06-02T14:00:00+02:00"); // bascule (heure de Paris)
  var TARGET  = "https://rsl-x.gg/";
  var onOldSite = /(^|\.)vercel\.app$/.test(location.hostname);

  if (!onOldSite || Date.now() < CUTOVER) return;

  // Splash le temps de la redirection
  try {
    var o = document.createElement("div");
    o.textContent = "RSL-X a déménagé — redirection vers rsl-x.gg…";
    o.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;" +
      "justify-content:center;background:#0a0908;color:#f1ddb1;text-align:center;" +
      "padding:24px;font-family:Inter,system-ui,sans-serif;font-size:18px;letter-spacing:.3px;";
    (document.body || document.documentElement).appendChild(o);
  } catch (e) { /* non bloquant */ }

  try {
    var data = {};
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      data[k] = localStorage.getItem(k);
    }
    // JSON → base64 (UTF-8 safe)
    var b64 = btoa(
      encodeURIComponent(JSON.stringify(data)).replace(/%([0-9A-F]{2})/g, function (_, p) {
        return String.fromCharCode("0x" + p);
      })
    );
    location.replace(TARGET + "#rslx-migrate=" + encodeURIComponent(b64));
  } catch (e) {
    // Si l'export échoue, on bascule quand même (sans les données).
    location.replace(TARGET);
  }
})();

window.siteConfig = {
  title: "RSL-X",
  adBanner: {
    enabled: true,
    imageUrl: "/Ad_Banner.webp",
    link: "https://pl.go-ga.me/7syevz3l"
  }
};
