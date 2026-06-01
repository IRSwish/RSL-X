/* ============================================================
   Migration localStorage — EXPORT + REDIRECTION (ancien site)
   ------------------------------------------------------------
   À partir de l'heure de bascule, l'ancien site (rsl-x.vercel.app)
   affiche une page « We've moved! », encode TOUT son localStorage
   dans le hash de l'URL et redirige vers le nouveau site, qui
   réimporte les données au chargement (import dans le site-config.js
   de la branche v2).

   Garde-fous :
     • ne se déclenche que sur *.vercel.app (jamais en local/dev) ;
     • ne se déclenche qu'à partir de CUTOVER → déployable à l'avance,
       la bascule se fait toute seule à l'heure dite.
   Code temporaire — à retirer une fois la migration terminée.
   ============================================================ */
(function migrateRedirect() {
  var CUTOVER = Date.parse("2026-06-01T14:00:00+02:00"); // bascule (heure de Paris)
  var TARGET  = "https://rsl-x.gg/";
  var DELAY   = 2500; // ms avant redirection auto
  var onOldSite = /(^|\.)vercel\.app$/.test(location.hostname);
  var preview   = /[?&]rslxpreview\b/.test(location.search); // ?rslxpreview=1 → aperçu local, sans redirection

  if (!preview && (!onOldSite || Date.now() < CUTOVER)) return;

  // --- Construit l'URL de destination avec les données ---
  var dest = TARGET;
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
    dest = TARGET + "#rslx-migrate=" + encodeURIComponent(b64);
  } catch (e) { /* on bascule quand même, sans les données */ }

  var go = function () { location.replace(dest); };

  // --- Page brandée « We've moved! » ---
  var css = document.createElement("style");
  css.textContent =
    "@font-face{font-family:'MiddAges';src:url('/style/MiddAges.ttf') format('truetype');font-display:swap}" +
    "@keyframes rslxDots{0%,20%{opacity:0}50%{opacity:1}100%{opacity:0}}" +
    "@keyframes rslxGlow{0%,100%{opacity:.55}50%{opacity:1}}" +
    "#rslx-moved{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;" +
      "justify-content:center;padding:24px;color:#e8e0d2;font-family:'Inter',system-ui,sans-serif;" +
      "background:radial-gradient(circle at 50% 30%,rgba(201,169,106,.10),transparent 55%)," +
      "linear-gradient(160deg,#050505,#0c0b0a 45%,#14110f)}" +
    "#rslx-moved .card{position:relative;max-width:520px;width:100%;text-align:center;" +
      "padding:48px 44px;background:linear-gradient(180deg,rgba(22,18,16,.96),rgba(8,7,7,.94));" +
      "border:1px solid rgba(255,228,170,.14);box-shadow:0 25px 70px rgba(0,0,0,.75),inset 0 0 30px rgba(201,169,106,.05)}" +
    "#rslx-moved .card::before{content:'';position:absolute;inset:10px;border:1px solid rgba(201,169,106,.72);" +
      "box-shadow:0 0 8px rgba(201,169,106,.22);animation:rslxGlow 4.8s ease-in-out infinite;pointer-events:none}" +
    "#rslx-moved h1{margin:0 0 6px;font-family:'MiddAges','Cormorant Garamond',serif;font-size:3.2rem;line-height:1.05;text-transform:uppercase;letter-spacing:1px;" +
      "background:linear-gradient(to bottom,#feeec1,#e09f40);-webkit-background-clip:text;background-clip:text;" +
      "-webkit-text-fill-color:transparent;color:transparent;text-shadow:0 0 18px rgba(201,169,106,.25)}" +
    "#rslx-moved .sub{margin:0 0 22px;font-size:.8rem;letter-spacing:3px;text-transform:uppercase;color:rgba(241,221,177,.55)}" +
    "#rslx-moved p{margin:0 0 26px;font-size:1.02rem;line-height:1.7;color:#cfc6b6}" +
    "#rslx-moved strong{color:#f2e3c4}" +
    "#rslx-moved .go{display:inline-block;padding:12px 26px;font-size:.95rem;font-weight:600;letter-spacing:.5px;" +
      "text-transform:uppercase;text-decoration:none;color:#f2e3c4;border:1px solid rgba(201,169,106,.5);" +
      "background:rgba(201,169,106,.06);transition:background .18s,border-color .18s,transform .18s}" +
    "#rslx-moved .go:hover{background:rgba(201,169,106,.16);border-color:rgba(201,169,106,.9);transform:translateY(-1px)}" +
    "#rslx-moved .redir{margin-top:18px;font-size:.85rem;color:rgba(232,224,210,.5)}" +
    "#rslx-moved .redir b{animation:rslxDots 1.4s infinite}" +
    "#rslx-moved .redir b:nth-child(2){animation-delay:.2s}#rslx-moved .redir b:nth-child(3){animation-delay:.4s}";
  (document.head || document.documentElement).appendChild(css);

  var ov = document.createElement("div");
  ov.id = "rslx-moved";
  ov.innerHTML =
    "<div class='card'>" +
      "<div class='sub'>We've moved</div>" +
      "<h1>RSL-X is now<br>rsl-x.gg</h1>" +
      "<p>The site has a brand-new home at <strong>rsl-x.gg</strong>.<br>" +
      "We're bringing all your saved data along with you.</p>" +
      "<a class='go' href='" + dest.replace(/'/g, "%27") + "'>Take me there &rarr;</a>" +
      "<div class='redir'>Redirecting<b>.</b><b>.</b><b>.</b></div>" +
    "</div>";
  (document.body || document.documentElement).appendChild(ov);

  if (!preview) setTimeout(go, DELAY);
})();

window.siteConfig = {
  title: "RSL-X",
  adBanner: {
    enabled: true,
    imageUrl: "/Ad_Banner.webp",
    link: "https://pl.go-ga.me/7syevz3l"
  }
};
