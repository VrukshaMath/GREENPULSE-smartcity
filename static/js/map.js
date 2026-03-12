/**
 * map.js — EcoNav Map Module
 * Handles: Leaflet init, live location tracking, route drawing, markers
 */

const MapModule = (() => {
  // ─── State ───────────────────────────────────────────
  let map = null;
  let userMarker = null;
  let destMarker = null;
  let routeLayer = null;
  let watchId   = null;
  let currentPos = null;   // { lat, lon }

  // ─── Tile Layer URL (OpenStreetMap) ──────────────────
  // NOTE: For production, consider a dark tile provider like:
  //   Stadia Maps: https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png
  //   (Requires free API key at https://stadiamaps.com/)
  const TILE_URL  = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  const TILE_ATTR = '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>';

  // ─── Custom Marker HTML Factories ────────────────────
  const makeUserIcon = () => L.divIcon({
    className: '',
    html: '<div class="user-marker"></div>',
    iconSize:   [20, 20],
    iconAnchor: [10, 10],
  });

  const makeDestIcon = () => L.divIcon({
    className: '',
    html: '<div class="dest-marker"></div>',
    iconSize:   [18, 18],
    iconAnchor: [9, 9],
  });

  // ─── Init ─────────────────────────────────────────────
  function init() {
    // Default center: world center; will snap to user location once GPS fires
    map = L.map('map', {
      center: [20, 0],
      zoom: 3,
      zoomControl: false,
      attributionControl: false,
    });

    // Tile layer
    L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(map);

    // Custom attribution bottom-right
    L.control.attribution({ position: 'bottomright', prefix: false })
      .addAttribution(TILE_ATTR)
      .addTo(map);

    // Custom zoom controls (top-left to avoid overlap)
    L.control.zoom({ position: 'topleft' }).addTo(map);

    // Start live location tracking
    _startLiveTracking();

    console.log('[MapModule] Initialized');
    return map;
  }

  // ─── Live GPS Tracking ────────────────────────────────
  function _startLiveTracking() {
    if (!navigator.geolocation) {
      MainApp.showToast('Geolocation not supported by this browser.', 'error');
      return;
    }

    const options = {
      enableHighAccuracy: true,
      maximumAge: 5000,      // Accept cached position up to 5s old
      timeout: 10000,
    };

    // First immediate fix
    navigator.geolocation.getCurrentPosition(_onPosition, _onGeoError, options);

    // Continuous watch
    watchId = navigator.geolocation.watchPosition(_onPosition, _onGeoError, options);
  }

  function _onPosition(pos) {
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    const accuracy = pos.coords.accuracy;
    const speed    = pos.coords.speed;     // m/s or null
    const heading  = pos.coords.heading;   // degrees or null

    currentPos = { lat, lon, accuracy, speed, heading };

    // Place or move user marker
    if (!userMarker) {
      userMarker = L.marker([lat, lon], { icon: makeUserIcon(), zIndexOffset: 1000 }).addTo(map);
      map.setView([lat, lon], 15);
    } else {
      userMarker.setLatLng([lat, lon]);
    }

    // Update coordinate readout
    document.getElementById('coords-lat').textContent = lat.toFixed(5);
    document.getElementById('coords-lon').textContent = lon.toFixed(5);

    // Update live stats bar
    const speedKmh = speed != null ? (speed * 3.6).toFixed(1) : '—';
    const headingStr = heading != null ? `${Math.round(heading)}°` : '—';
    document.getElementById('stat-speed').textContent  = speedKmh;
    document.getElementById('stat-heading').textContent = headingStr;
    document.getElementById('stat-acc').textContent    = `±${Math.round(accuracy)}m`;

    // Notify page controller about updated position
    if (typeof NavPage !== 'undefined') NavPage.onLocationUpdate(currentPos);
    else if (typeof MainApp !== 'undefined') MainApp.onLocationUpdate(currentPos);
  }

  function _onGeoError(err) {
    console.warn('[MapModule] Geolocation error:', err.message);
    MainApp.showToast('Location error: ' + err.message, 'error');
  }

  // ─── Draw Route ───────────────────────────────────────
  function drawRoute(coordinates) {
    // coordinates: array of [lon, lat] from ORS / mock
    // Leaflet uses [lat, lon] — we reverse here
    const latlngs = coordinates.map(c => [c[1], c[0]]);

    // Remove old route
    if (routeLayer) {
      map.removeLayer(routeLayer);
    }

    // Draw animated dashed route line
    routeLayer = L.polyline(latlngs, {
      color: '#39d353',
      weight: 4,
      opacity: 0.85,
      dashArray: '10, 6',
      lineCap: 'round',
    }).addTo(map);

    // Also draw a subtle glow line underneath
    L.polyline(latlngs, {
      color: '#39d353',
      weight: 12,
      opacity: 0.1,
    }).addTo(map);

    // Fit map to route bounds with padding
    map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] });
  }

  // ─── Place Destination Marker ─────────────────────────
  function placeDestMarker(lat, lon, label) {
    if (destMarker) map.removeLayer(destMarker);
    destMarker = L.marker([lat, lon], { icon: makeDestIcon() })
      .addTo(map)
      .bindPopup(`<b style="color:#f5a623">📍 ${label || 'Destination'}</b>`, {
        className: 'eco-popup'
      });
  }

  // ─── Clear Route ──────────────────────────────────────
  function clearRoute() {
    if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
    if (destMarker) { map.removeLayer(destMarker); destMarker = null; }
  }

  // ─── Pan to User ──────────────────────────────────────
  function recenterOnUser() {
    if (currentPos) {
      map.setView([currentPos.lat, currentPos.lon], 15, { animate: true });
    } else {
      MainApp.showToast('Waiting for GPS fix…', 'warn');
    }
  }

  // ─── Geocode Address → [lon, lat] ────────────────────
  // Uses Nominatim (OSM free geocoding). No API key needed.
  async function geocode(address) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`;
    try {
      const res = await fetch(url, {
        headers: { 'Accept-Language': 'en', 'User-Agent': 'EcoNavApp/1.0' }
      });
      const data = await res.json();
      if (data.length === 0) return null;
      return {
        lon: parseFloat(data[0].lon),
        lat: parseFloat(data[0].lat),
        display_name: data[0].display_name
      };
    } catch (e) {
      console.error('[MapModule] Geocode error:', e);
      return null;
    }
  }

  // ─── Getters ──────────────────────────────────────────
  function getCurrentPos() { return currentPos; }
  function getMap()        { return map; }

  // ─── Public API ───────────────────────────────────────
  return { init, drawRoute, placeDestMarker, clearRoute, recenterOnUser, geocode, getCurrentPos, getMap };
})();