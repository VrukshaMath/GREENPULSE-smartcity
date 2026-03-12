/**
 * navigate.js — Map navigation page logic
 * Handles: routing, AQI, suggestion rendering for /navigate page
 */

const NavPage = (() => {
  const API = '';

  // Called by MapModule when GPS updates
  function onLocationUpdate(pos) {
    document.getElementById('coords-lat').textContent = pos.lat.toFixed(5);
    document.getElementById('coords-lon').textContent = pos.lon.toFixed(5);
    const spd = pos.speed != null ? (pos.speed * 3.6).toFixed(1) : '—';
    document.getElementById('stat-speed').textContent   = spd;
    document.getElementById('stat-heading').textContent = pos.heading != null ? `${Math.round(pos.heading)}°` : '—';
    document.getElementById('stat-acc').textContent     = `±${Math.round(pos.accuracy)}m`;

    // Fetch AQI once per minute
    if (!NavPage._lastAqi || Date.now() - NavPage._lastAqi > 60_000) {
      NavPage._lastAqi = Date.now();
      _fetchAQI(pos.lat, pos.lon);
    }
  }

  async function _fetchAQI(lat, lon) {
    try {
      const res  = await fetch(`${API}/api/aqi?lat=${lat}&lon=${lon}`);
      const data = await res.json();
      if (data.error) return;
      siteAQI = data;  // update shared site state

      // Update topnav pill
      document.getElementById('nav-aqi-text').textContent = `AQI ${data.aqi} · ${data.category}`;

      // Update AQI mini card
      const mini = document.getElementById('aqi-mini');
      if (mini) mini.style.setProperty('--aqi-clr', data.color);
      _setText('aqi-num',         data.aqi);
      _setText('aqi-cat',         data.category);
      _setText('aqi-emoji-nav',   data.emoji);
      _setText('aqi-advice-nav',  data.advice);

      // Pollutant mini grid
      const c = data.components || {};
      const items = [
        {l:'PM2.5', v:c.pm2_5}, {l:'PM10', v:c.pm10},
        {l:'O₃',   v:c.o3   }, {l:'NO₂',  v:c.no2 },
        {l:'CO',   v:c.co   }, {l:'SO₂',  v:c.so2 },
        {l:'NH₃',  v:c.nh3  }, {l:'NO',   v:c.no  },
      ];
      const compsEl = document.getElementById('aqi-comps-nav');
      if (compsEl) {
        compsEl.innerHTML = items.map(x => `
          <div class="aqi-comp-sm">
            <div class="aqi-comp-sm-label">${x.l}</div>
            <div class="aqi-comp-sm-val">${x.v != null ? x.v.toFixed(1) : '–'}</div>
          </div>
        `).join('');
      }

      // Refresh suggestion if route loaded
      if (siteRoute) _fetchSuggestion(siteRoute.distance_km, data.aqi);

    } catch (e) {
      console.error('[NavPage AQI]', e);
    }
  }

  async function handleRoute() {
    const fromVal = document.getElementById('input-from').value.trim();
    const toVal   = document.getElementById('input-to').value.trim();
    if (!toVal) { showToast('Enter a destination', 'warn'); return; }

    const btn = document.getElementById('btn-route');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Routing…';

    try {
      let fromCoords;
      if (!fromVal || fromVal.toLowerCase() === 'my location') {
        const pos = MapModule.getCurrentPos();
        if (!pos) { showToast('Waiting for GPS…', 'warn'); return; }
        fromCoords = { lon: pos.lon, lat: pos.lat };
      } else {
        fromCoords = await MapModule.geocode(fromVal);
        if (!fromCoords) { showToast(`Could not find "${fromVal}"`, 'error'); return; }
      }

      const toCoords = await MapModule.geocode(toVal);
      if (!toCoords) { showToast(`Could not find "${toVal}"`, 'error'); return; }

      MapModule.placeDestMarker(toCoords.lat, toCoords.lon, toVal);

      const routeRes = await fetch(`${API}/api/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: [fromCoords.lon, fromCoords.lat],
          to:   [toCoords.lon, toCoords.lat],
          mode: 'foot-walking'
        }),
      });
      const routeData = await routeRes.json();
      if (routeData.error) throw new Error(routeData.error);

      siteRoute = routeData;  // update shared site state
      MapModule.drawRoute(routeData.coordinates);

      document.getElementById('route-distance').textContent = routeData.distance_km;
      document.getElementById('route-duration').textContent = routeData.duration_min;
      document.getElementById('route-result').style.display = 'flex';

      const aqi = siteAQI?.aqi ?? 1;
      await _fetchSuggestion(routeData.distance_km, aqi);

      showToast(`Route: ${routeData.distance_km} km · ${routeData.duration_min} min`);

      // Notify carbon popup
      if (typeof carbonWindow !== 'undefined' && carbonWindow && !carbonWindow.closed) {
        carbonWindow.postMessage({ type: 'route_update', route: routeData, mode: siteMode }, '*');
      }

    } catch (err) {
      showToast('Routing failed: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Get Eco Route';
    }
  }

  async function _fetchSuggestion(distKm, aqi) {
    try {
      const res  = await fetch(`${API}/api/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ distance_km: distKm, aqi }),
      });
      const data = await res.json();
      siteMode = data.mode;  // update shared state

      _setText('s-icon', data.icon);
      _setText('s-mode', data.label);
      _setText('s-why',  data.reason);
      _setText('s-co2',  data.carbon === 0 ? '✨ Zero direct emissions' : `~${data.carbon} gCO₂/km`);

      const sec = document.getElementById('suggest-sec');
      if (sec) sec.style.display = 'block';
    } catch (e) {
      console.error('[NavPage suggest]', e);
    }
  }

  function _setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  // ── Init ──────────────────────────────────────────
  function init() {
    MapModule.init();

    document.getElementById('btn-route')?.addEventListener('click', handleRoute);
    document.getElementById('input-to')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') handleRoute();
    });

    console.log('[NavPage] Ready');
  }

  return { init, onLocationUpdate };
})();

// Bootstrap
document.addEventListener('DOMContentLoaded', () => NavPage.init());