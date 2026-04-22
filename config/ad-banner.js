// Ad Banner Injector
// Injects the ad banner at the bottom of every page

(function() {
  'use strict';

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectAdBanner);
  } else {
    injectAdBanner();
  }

  function injectAdBanner() {
    // Check if config exists and banner is enabled
    if (!window.siteConfig || !window.siteConfig.adBanner || !window.siteConfig.adBanner.enabled) {
      return;
    }

    // Check if banner already exists
    if (document.querySelector('.ad-banner-footer')) {
      return;
    }

    const config = window.siteConfig.adBanner;

    // Create banner element
    const banner = document.createElement('div');
    banner.className = 'ad-banner-footer';

    const link = document.createElement('a');
    link.href = config.link;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';

    const img = document.createElement('img');
    img.src = config.imageUrl;
    img.alt = 'Advertisement';

    link.appendChild(img);
    banner.appendChild(link);

    // Append to body
    document.body.appendChild(banner);
  }
})();

// === Background grain texture (canvas-generated white noise) ===
(function() {
  'use strict';

  function generateGrain() {
    const SIZE = 256;
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(SIZE, SIZE);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = (Math.random() * 255) | 0;
      img.data[i] = img.data[i+1] = img.data[i+2] = v;
      img.data[i+3] = (Math.random() * 10) | 0;
    }
    ctx.putImageData(img, 0, 0);
    document.documentElement.style.setProperty('--rslx-grain', `url(${c.toDataURL()})`);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', generateGrain);
  } else {
    generateGrain();
  }
})();
