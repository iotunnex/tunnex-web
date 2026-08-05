(function () {
  const WORLD = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json';
  let landPromise = null;

  const libsReady = () =>
    new Promise((res) => {
      const tick = () => (window.d3 && window.topojson ? res() : setTimeout(tick, 40));
      tick();
    });

  const loadLand = () => {
    if (!landPromise) {
      landPromise = fetch(WORLD)
        .then((r) => r.json())
        .then((topo) => window.topojson.feature(topo, topo.objects.countries));
    }
    return landPromise;
  };

  const css =
    '@keyframes tnxMapRun{from{stroke-dashoffset:100}to{stroke-dashoffset:0}}' +
    '@keyframes tnxMapPulse{0%{r:5px;opacity:.7}100%{r:16px;opacity:0}}' +
    '@keyframes tnxMapBlip{0%,100%{opacity:.4}50%{opacity:1}}' +
    '.tnxmap-pulse{animation:tnxMapPulse 2.9s cubic-bezier(.2,.6,.3,1) infinite}' +
    '.tnxmap-run{animation:tnxMapRun 2.8s linear infinite}' +
    '.tnxmap-blip{animation:tnxMapBlip 2s ease-in-out infinite}' +
    '.tnxmap-call{opacity:0;transform:translateY(5px);transition:opacity .75s ease,transform .75s cubic-bezier(.22,.61,.36,1)}' +
    '.tnxmap-call.on{opacity:1;transform:none}' +
    '.tnxmap-lead{opacity:0;transition:opacity .75s ease}' +
    '.tnxmap-lead.on{opacity:1}' +
    '@media (prefers-reduced-motion:reduce){.tnxmap-pulse,.tnxmap-run,.tnxmap-blip{animation:none}}';

  function ensureCss() {
    if (document.getElementById('tnxmap-css')) return;
    const s = document.createElement('style');
    s.id = 'tnxmap-css';
    s.textContent = css;
    document.head.appendChild(s);
  }

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const N = {
    syd: [-33.87, 151.21, 'AWS · SYDNEY'],
    wus: [45.59, -121.18, 'AZURE · WEST US'],
    sfo: [37.77, -122.42],
    lax: [34.05, -118.24],
    den: [39.74, -104.99],
    chi: [41.88, -87.63],
    nyc: [40.71, -74.01],
    tor: [43.65, -79.38],
    mex: [19.43, -99.13],
    bog: [4.71, -74.07],
    gru: [-23.55, -46.63],
    scl: [-33.45, -70.67],
    lon: [51.51, -0.13],
    fra: [50.11, 8.68],
    par: [48.86, 2.35],
    mad: [40.42, -3.7],
    sto: [59.33, 18.06],
    waw: [52.23, 21.01],
    tlv: [32.08, 34.78],
    dxb: [25.2, 55.27],
    los: [6.52, 3.38],
    jnb: [-26.2, 28.05],
    nbo: [-1.29, 36.82],
    bom: [19.08, 72.88],
    blr: [12.97, 77.59],
    sin: [1.35, 103.82],
    hkg: [22.32, 114.17],
    tyo: [35.68, 139.65],
    icn: [37.57, 126.98],
    cgk: [-6.21, 106.85],
    mel: [-37.81, 144.96],
    akl: [-36.85, 174.76],
    per: [-31.95, 115.86],
  };

  const LINKS = [
    ['syd', 'wus', 1],
    ['syd', 'sin'],
    ['syd', 'mel'],
    ['mel', 'akl'],
    ['per', 'sin'],
    ['sin', 'hkg'],
    ['hkg', 'tyo'],
    ['tyo', 'icn'],
    ['sin', 'cgk'],
    ['sin', 'blr'],
    ['bom', 'blr'],
    ['bom', 'dxb'],
    ['dxb', 'fra'],
    ['fra', 'lon'],
    ['fra', 'waw'],
    ['par', 'mad'],
    ['lon', 'par'],
    ['sto', 'waw'],
    ['tlv', 'fra'],
    ['los', 'jnb'],
    ['nbo', 'dxb'],
    ['jnb', 'blr'],
    ['wus', 'sfo'],
    ['sfo', 'lax'],
    ['lax', 'den'],
    ['den', 'chi'],
    ['chi', 'nyc'],
    ['nyc', 'tor'],
    ['lax', 'mex'],
    ['mex', 'bog'],
    ['bog', 'gru'],
    ['gru', 'scl'],
    ['tyo', 'sfo'],
    ['icn', 'wus'],
    ['hkg', 'lax'],
  ];

  const FLOWS = [
    { at: 'fra', line: 'Engineer opens the customer database', ok: true },
    { at: 'icn', line: 'AI agent reads one repository', ok: true },
    { at: 'gru', line: 'Contractor turned away', ok: false },
    { at: 'sin', line: 'Service talks to another service', ok: true },
    { at: 'nyc', line: 'Laptop reconnects from a café', ok: true },
    { at: 'jnb', line: 'Ex-employee’s device turned away', ok: false },
    { at: 'bom', line: 'Mumbai office reaches London', ok: true },
  ];

  class TunnexDottedMap extends HTMLElement {
    connectedCallback() {
      ensureCss();
      this.style.display = 'block';
      this.style.width = '100%';
      this.style.position = 'relative';
      this._markers = Object.keys(N)
        .filter((k) => N[k][2])
        .map((k) => ({ lat: N[k][0], lng: N[k][1], label: N[k][2] }));
      this._mid = this.getAttribute('link-label') || '138 ms';
      libsReady()
        .then(loadLand)
        .then((land) => {
          this._land = land;
          this.draw();
        })
        .catch(() => {});
      this._ro = new ResizeObserver(() => {
        clearTimeout(this._t);
        this._t = setTimeout(() => this.draw(), 140);
      });
      this._ro.observe(this);
    }

    disconnectedCallback() {
      if (this._ro) this._ro.disconnect();
      clearTimeout(this._t);
      clearInterval(this._cyc);
    }

    cycle() {
      clearInterval(this._cyc);
      const calls = Array.from(this.querySelectorAll('.tnxmap-call'));
      const leads = Array.from(this.querySelectorAll('.tnxmap-lead'));
      if (!calls.length) return;
      const shown = Math.min(2, calls.length);
      let i = 0;
      const paint = () => {
        calls.forEach((c, k) => {
          const on =
            Array.from({ length: shown }, (_, s) => (i + s * 3) % calls.length).indexOf(k) > -1;
          c.classList.toggle('on', on);
          if (leads[k]) leads[k].classList.toggle('on', on);
        });
        i = (i + 1) % calls.length;
      };
      paint();
      this._cyc = setInterval(paint, 5200);
    }

    draw() {
      const d3 = window.d3;
      if (!this._land || !d3) return;
      const w = Math.round(this.clientWidth || 0);
      if (w < 40 || w === this._w) return;
      this._w = w;
      const h = Math.max(210, Math.min(400, Math.round(w * 0.44)));

      const proj = d3
        .geoNaturalEarth1()
        .rotate([-160, 0])
        .fitExtent(
          [
            [12, 10],
            [w - 12, h - 10],
          ],
          this._land,
        );

      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff';
      const cpath = d3.geoPath(proj, ctx);
      ctx.beginPath();
      cpath(this._land);
      ctx.fill();
      const px = ctx.getImageData(0, 0, w, h).data;

      const step = w > 760 ? 7 : 6;
      const r = w > 760 ? 1.15 : 1;
      let dots = '';
      for (let y = step; y < h; y += step) {
        for (let x = step; x < w; x += step) {
          if (px[(y * w + x) * 4 + 3] > 120)
            dots += '<circle cx="' + x + '" cy="' + y + '" r="' + r + '"/>';
        }
      }

      const geoPath = d3.geoPath(proj);
      let arcs = '',
        badge = '',
        badgeBox = null;
      LINKS.forEach((lk, i) => {
        const a = N[lk[0]],
          b = N[lk[1]];
        const interp = d3.geoInterpolate([a[1], a[0]], [b[1], b[0]]);
        const coords = d3.range(0, 1.0001, 1 / 72).map((t) => interp(t));
        const d = geoPath({ type: 'LineString', coordinates: coords });
        if (!d) return;
        const delay = ((i * 0.37) % 3.2).toFixed(2);
        if (lk[2]) {
          arcs +=
            '<path d="' +
            d +
            '" fill="none" stroke="rgba(255,255,255,.26)" stroke-width="1.1"/>' +
            '<path class="tnxmap-run" d="' +
            d +
            '" fill="none" stroke="#EDEDEB" stroke-width="1.8" stroke-linecap="round" pathLength="100" style="stroke-dasharray:5 95"/>';
          const mp = proj(interp(0.5));
          if (mp && this._mid) {
            const bw = this._mid.length * 6.4 + 18,
              bh = 19;
            badgeBox = { x: mp[0] - bw / 2, y: mp[1] - bh - 12, w: bw, h: bh };
            badge =
              '<g><rect x="' +
              (mp[0] - bw / 2) +
              '" y="' +
              (mp[1] - bh - 12) +
              '" width="' +
              bw +
              '" height="' +
              bh +
              '" rx="9.5" fill="rgba(14,14,14,.9)" stroke="rgba(255,255,255,.16)"/>' +
              '<text x="' +
              mp[0] +
              '" y="' +
              (mp[1] - 12 - bh / 2 + 3.6) +
              '" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="10" font-weight="600" letter-spacing="1" fill="#D6D6D2">' +
              esc(this._mid) +
              '</text></g>';
          }
        } else {
          arcs +=
            '<path d="' +
            d +
            '" fill="none" stroke="rgba(255,255,255,.13)" stroke-width=".9"/>' +
            '<path class="tnxmap-run" d="' +
            d +
            '" fill="none" stroke="rgba(237,237,235,.85)" stroke-width="1.3" stroke-linecap="round" pathLength="100" style="stroke-dasharray:3 97;animation-delay:-' +
            delay +
            's"/>';
        }
      });

      let nodes = '';
      Object.keys(N).forEach((k, i) => {
        if (N[k][2]) return;
        const p = proj([N[k][1], N[k][0]]);
        if (!p) return;
        nodes +=
          '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="2.4" fill="rgba(237,237,235,.72)"/>';
        if (i % 4 === 0) {
          nodes +=
            '<circle class="tnxmap-pulse" cx="' +
            p[0] +
            '" cy="' +
            p[1] +
            '" r="5" fill="none" stroke="rgba(237,237,235,.3)" stroke-width="1" style="animation-delay:-' +
            ((i * 0.31) % 2.9).toFixed(2) +
            's"/>';
        }
      });

      let marks = '';
      this._markers.forEach((m) => {
        const p = proj([m.lng, m.lat]);
        if (!p) return;
        const x = p[0],
          y = p[1],
          label = esc(m.label);
        const fs = 9.5,
          padX = 9,
          bh = 19;
        const bw = label.length * (fs * 0.64) + padX * 2;
        const bx = x > w * 0.6 ? x - 13 - bw : x + 13;
        marks +=
          '<g>' +
          '<circle class="tnxmap-pulse" cx="' +
          x +
          '" cy="' +
          y +
          '" r="5" fill="none" stroke="rgba(237,237,235,.55)" stroke-width="1.1"/>' +
          '<circle cx="' +
          x +
          '" cy="' +
          y +
          '" r="9" fill="rgba(237,237,235,.10)"/>' +
          '<circle cx="' +
          x +
          '" cy="' +
          y +
          '" r="3.4" fill="#EDEDEB"/>' +
          '<rect x="' +
          bx +
          '" y="' +
          (y - bh / 2) +
          '" width="' +
          bw +
          '" height="' +
          bh +
          '" rx="6" fill="rgba(14,14,14,.88)" stroke="rgba(255,255,255,.14)"/>' +
          '<text x="' +
          (bx + padX) +
          '" y="' +
          (y + 3.4) +
          '" font-family="JetBrains Mono, monospace" font-size="' +
          fs +
          '" font-weight="600" letter-spacing="1" fill="#C9C9C4">' +
          label +
          '</text>' +
          '</g>';
      });

      const stacked = w < 780;
      const cw = 168,
        pad = 10;
      const placed = [];
      if (!stacked) {
        this._markers.forEach((m) => {
          const p = proj([m.lng, m.lat]);
          if (!p) return;
          const bw = m.label.length * 6.1 + 18;
          placed.push({
            x: (p[0] > w * 0.6 ? p[0] - 13 - bw : p[0] + 13) - 6,
            y: p[1] - 16,
            w: bw + 12,
            h: 32,
          });
        });
        if (badgeBox) placed.push(badgeBox);
      }
      const hits = (a) =>
        placed.some(
          (b) =>
            a.x < b.x + b.w + pad &&
            a.x + a.w + pad > b.x &&
            a.y < b.y + b.h + pad &&
            a.y + a.h + pad > b.y,
        );

      let calls = '',
        leads = '';
      FLOWS.forEach((fl) => {
        const g = fl.ok ? '#6E9C7C' : '#C4626C';
        const body =
          '<span class="tnxmap-blip" style="width:5px;height:5px;flex:none;border-radius:99px;background:' +
          g +
          ';margin-top:5px"></span>' +
          '<span style="font:500 11px/1.35 \'Instrument Sans\',sans-serif;color:#C9C9C4">' +
          esc(fl.line) +
          '</span>';
        const shell =
          'display:flex;align-items:flex-start;gap:8px;background:rgba(10,10,10,.86);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.09);border-radius:7px;padding:7px 10px';
        if (stacked) {
          calls += '<div style="' + shell + '">' + body + '</div>';
          return;
        }
        const p = proj([N[fl.at][1], N[fl.at][0]]);
        if (!p) return;
        const lines = Math.max(1, Math.ceil(fl.line.length / Math.floor((cw - 30) / 5.6)));
        const ch = 14 + lines * 15;
        let spot = null;
        const cands = [];
        [1, -1].forEach((side) => {
          [0, -1, 1, -2, 2, -3, 3].forEach((dy) => {
            cands.push({
              x: side > 0 ? p[0] + 16 : p[0] - 16 - cw,
              y: p[1] - ch / 2 + dy * (ch + pad),
              left: side < 0,
            });
          });
        });
        [-1, 1].forEach((dir) => {
          [1, 1.8, 2.6, 3.4].forEach((k) => {
            cands.push({ x: p[0] - cw / 2, y: p[1] + dir * k * (ch + pad), left: false });
            cands.push({ x: p[0] + 16, y: p[1] + dir * k * (ch + pad), left: false });
            cands.push({ x: p[0] - 16 - cw, y: p[1] + dir * k * (ch + pad), left: true });
          });
        });
        [-1, 1].forEach((dir) => {
          [40, 90, 150].forEach((dx) => {
            cands.push({ x: p[0] + dir * dx - cw / 2, y: p[1] - ch / 2, left: dir < 0 });
          });
        });
        for (const c of cands) {
          if (c.x < 6 || c.x + cw > w - 6 || c.y < 6 || c.y + ch > h - 6) continue;
          const box = { x: c.x, y: c.y, w: cw, h: ch };
          if (hits(box)) continue;
          spot = { box: box, left: c.left };
          break;
        }
        if (!spot) return;
        placed.push(spot.box);
        calls +=
          '<div class="tnxmap-call" style="position:absolute;left:' +
          spot.box.x +
          'px;top:' +
          spot.box.y +
          'px;width:' +
          cw +
          'px;pointer-events:none;' +
          shell +
          '">' +
          body +
          '</div>';
        leads +=
          '<g class="tnxmap-lead"><line x1="' +
          p[0] +
          '" y1="' +
          p[1] +
          '" x2="' +
          (spot.left ? spot.box.x + cw : spot.box.x) +
          '" y2="' +
          (spot.box.y + ch / 2) +
          '" stroke="rgba(255,255,255,.18)" stroke-width="1" stroke-dasharray="3 4"/>' +
          '<circle cx="' +
          p[0] +
          '" cy="' +
          p[1] +
          '" r="3" fill="' +
          (fl.ok ? '#EDEDEB' : '#C4626C') +
          '"/></g>';
      });

      const alt =
        'Dotted world map of tunnels between sites on every continent, with the AWS Sydney to Azure West US link highlighted' +
        (this._mid ? ' at ' + this._mid : '') +
        '.';

      this.innerHTML =
        '<svg viewBox="0 0 ' +
        w +
        ' ' +
        h +
        '" width="100%" height="' +
        h +
        '" role="img" aria-label="' +
        esc(alt) +
        '" style="display:block">' +
        '<g fill="rgba(255,255,255,.11)">' +
        dots +
        '</g>' +
        arcs +
        nodes +
        leads +
        marks +
        badge +
        '</svg>' +
        (stacked
          ? '<div style="display:grid;grid-template-columns:1fr;gap:8px;margin-top:12px">' +
            calls +
            '</div>'
          : calls);

      if (!stacked) this.cycle();
      else clearInterval(this._cyc);
    }
  }

  if (!customElements.get('tunnex-dotted-map'))
    customElements.define('tunnex-dotted-map', TunnexDottedMap);
})();
