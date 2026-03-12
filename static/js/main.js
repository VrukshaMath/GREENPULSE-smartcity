/**
 * main.js — EcoNav Dashboard Logic
 * Chatbot drawer, AQI, routing, carbon popup
 */

// ─── Chat Drawer State ─────────────────────────────
let chatOpen = false;
let chatHistory = [];
let chatMsgCount = 0;
let carbonWindow = null;

// ─── App State ─────────────────────────────────────
const state = {
  currentPos: null,
  aqiData: null,
  routeData: null,
  suggestion: null,
};

const API = '';

// ─── Init ──────────────────────────────────────────
const MainApp = {
  init() {
    MapModule.init();
    _bindEvents();
    _addWelcomeMessage();
    console.log('🌿 EcoNav Dashboard ready');
  },

  onLocationUpdate(pos) {
    state.currentPos = pos;

    // Coordinates in topbar
    document.getElementById('coords-lat').textContent = pos.lat.toFixed(4);
    document.getElementById('coords-lon').textContent = pos.lon.toFixed(4);

    // Live stats bar
    const speedKmh = pos.speed != null ? (pos.speed * 3.6).toFixed(1) : '—';
    document.getElementById('stat-speed').textContent   = speedKmh;
    document.getElementById('stat-heading').textContent = pos.heading != null ? `${Math.round(pos.heading)}°` : '—';
    document.getElementById('stat-acc').textContent     = `±${Math.round(pos.accuracy)}m`;

    // AQI fetch (rate limited to once per 60s)
    if (!state._lastAqi || Date.now() - state._lastAqi > 60_000) {
      state._lastAqi = Date.now();
      _fetchAQI(pos.lat, pos.lon);
    }

    _postToPopup({ type: 'location_update', pos });
  },

  showToast(msg, type = 'info') {
    const c = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = `toast${type === 'error' ? ' error' : type === 'warn' ? ' warn' : ''}`;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }
};

// ─── Bind UI Events ────────────────────────────────
function _bindEvents() {
  document.getElementById('btn-route').addEventListener('click', _handleRoute);
  document.getElementById('input-to').addEventListener('keydown', e => {
    if (e.key === 'Enter') _handleRoute();
  });
  document.getElementById('btn-recenter').addEventListener('click', () => MapModule.recenterOnUser());
  document.getElementById('btn-carbon-popup').addEventListener('click', _openCarbonPopup);
  document.getElementById('btn-chat-send').addEventListener('click', handleChatSend);
  document.getElementById('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleChatSend();
  });
}

// ─── Chat Drawer Toggle ────────────────────────────
function toggleChat() {
  chatOpen = !chatOpen;
  document.getElementById('chat-drawer').classList.toggle('open', chatOpen);
  document.getElementById('chat-backdrop').classList.toggle('open', chatOpen);

  // Change FAB icon
  const icon = document.getElementById('chat-fab-icon');
  icon.textContent = chatOpen ? '✕' : '🌿';

  // Auto scroll to bottom when opening
  if (chatOpen) {
    const msgs = document.getElementById('chat-messages');
    setTimeout(() => msgs.scrollTop = msgs.scrollHeight, 100);
  }
}

// Inject prompt from quick chips
function injectChat(text) {
  document.getElementById('chat-input').value = text;
  handleChatSend();
}

// ─── AQI ───────────────────────────────────────────
async function _fetchAQI(lat, lon) {
  try {
    const res = await fetch(`${API}/api/aqi?lat=${lat}&lon=${lon}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    state.aqiData = data;
    _renderAQI(data);
    if (state.routeData) _fetchSuggestion(state.routeData.distance_km, data.aqi);
  } catch (err) {
    console.error('[AQI]', err);
  }
}

function _renderAQI(data) {
  // Set CSS color variable
  const card = document.getElementById('card-aqi') || document.querySelector('.dash-card:nth-child(2)');
  document.documentElement.style.setProperty('--aqi-color', data.color);

  document.getElementById('aqi-value').textContent  = data.aqi;
  document.getElementById('aqi-label').textContent  = data.category;
  document.getElementById('aqi-emoji').textContent  = data.emoji;
  document.getElementById('aqi-advice').textContent = data.advice;

  // AQI bar width: scale 1-5 → 20%-100%
  const barPct = (data.aqi / 5) * 100;
  document.getElementById('aqi-bar').style.width = barPct + '%';
  document.getElementById('aqi-bar').style.background = data.color;

  // Topbar pill
  document.getElementById('aqi-pill-text').textContent = `AQI ${data.aqi} · ${data.category}`;

  // Pollutant components
  const c = data.components || {};
  const comps = [
    { label: 'PM2.5', val: c.pm2_5 }, { label: 'PM10', val: c.pm10 },
    { label: 'O₃',   val: c.o3    }, { label: 'NO₂',  val: c.no2  },
    { label: 'CO',   val: c.co    }, { label: 'SO₂',  val: c.so2  },
    { label: 'NH₃',  val: c.nh3   }, { label: 'NO',   val: c.no   },
  ];
  document.getElementById('aqi-components').innerHTML = comps.map(x => `
    <div class="aqi-comp">
      <div class="aqi-comp-name">${x.label}</div>
      <div class="aqi-comp-val">${x.val != null ? x.val.toFixed(1) : '–'}</div>
    </div>
  `).join('');

  _postToPopup({ type: 'aqi_update', aqi: data });
}

// ─── Routing ───────────────────────────────────────
async function _handleRoute() {
  const fromVal = document.getElementById('input-from').value.trim();
  const toVal   = document.getElementById('input-to').value.trim();
  if (!toVal) { MainApp.showToast('Enter a destination', 'warn'); return; }

  const btn = document.getElementById('btn-route');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Routing…';

  try {
    // Resolve From
    let fromCoords;
    if (!fromVal || fromVal.toLowerCase() === 'my location') {
      const pos = MapModule.getCurrentPos();
      if (!pos) { MainApp.showToast('Waiting for GPS…', 'warn'); return; }
      fromCoords = { lon: pos.lon, lat: pos.lat };
    } else {
      fromCoords = await MapModule.geocode(fromVal);
      if (!fromCoords) { MainApp.showToast(`Could not find "${fromVal}"`, 'error'); return; }
    }

    // Resolve To
    const toCoords = await MapModule.geocode(toVal);
    if (!toCoords) { MainApp.showToast(`Could not find "${toVal}"`, 'error'); return; }

    MapModule.placeDestMarker(toCoords.lat, toCoords.lon, toVal);

    // Get route
    const routeRes = await fetch(`${API}/api/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: [fromCoords.lon, fromCoords.lat], to: [toCoords.lon, toCoords.lat], mode: 'foot-walking' }),
    });
    const routeData = await routeRes.json();
    if (routeData.error) throw new Error(routeData.error);

    state.routeData = routeData;
    MapModule.drawRoute(routeData.coordinates);

    // Show route stats
    document.getElementById('route-distance').textContent = routeData.distance_km;
    document.getElementById('route-duration').textContent = routeData.duration_min;
    document.getElementById('route-stats').style.display = 'flex';

    const aqi = state.aqiData?.aqi ?? 1;
    await _fetchSuggestion(routeData.distance_km, aqi);
    MainApp.showToast(`Route: ${routeData.distance_km} km · ${routeData.duration_min} min`);

    _postToPopup({ type: 'route_update', route: routeData, mode: state.suggestion?.mode });

  } catch (err) {
    MainApp.showToast('Routing failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Get Route';
  }
}

// ─── Transport Suggestion ──────────────────────────
async function _fetchSuggestion(distKm, aqi) {
  try {
    const res = await fetch(`${API}/api/suggest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ distance_km: distKm, aqi }),
    });
    const data = await res.json();
    state.suggestion = data;

    document.getElementById('suggestion-icon').textContent   = data.icon;
    document.getElementById('suggestion-mode').textContent   = data.label;
    document.getElementById('suggestion-reason').textContent = data.reason;
    document.getElementById('suggestion-carbon').textContent =
      data.carbon === 0 ? '✨ Zero direct emissions'
                        : `~${data.carbon} gCO₂/km`;

    document.getElementById('card-suggest').style.display = 'block';
    _postToPopup({ type: 'suggestion_update', suggestion: data });
  } catch (err) {
    console.error('[Suggest]', err);
  }
}

// ─── Carbon Popup ──────────────────────────────────
function _openCarbonPopup() {
  const w = 480, h = 580;
  const left = Math.round(screen.width / 2 - w / 2);
  const top  = Math.round(screen.height / 2 - h / 2);
  if (carbonWindow && !carbonWindow.closed) { carbonWindow.focus(); return; }
  carbonWindow = window.open('/carbon', 'EcoNavCarbon',
    `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`);
}

function _postToPopup(data) {
  if (carbonWindow && !carbonWindow.closed) carbonWindow.postMessage(data, '*');
}

window.addEventListener('message', (e) => {
  if (e.data?.type === 'mode_changed') {
    state.suggestion = { ...state.suggestion, mode: e.data.mode };
    MainApp.showToast(`Mode updated: ${e.data.mode}`);
  }
});

// ─── AI Chat ───────────────────────────────────────
function _addWelcomeMessage() {
  _appendMsg('assistant', "Hi! I'm EcoNav AI 🌿 Ask me about air quality, your route, or eco-friendly travel tips.");
}

async function handleChatSend() {
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message) return;

  input.value = '';
  _appendMsg('user', message);
  chatHistory.push({ role: 'user', content: message });

  const typingId = _appendMsg('assistant', '…', true);

  const context = {
    aqi: state.aqiData?.aqi,
    distance_km: state.routeData?.distance_km,
    mode: state.suggestion?.mode,
  };

  try {
    const res = await fetch(`${API}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history: chatHistory, context }),
    });
    const data = await res.json();
    const reply = data.reply || data.error || 'No response.';
    _replaceMsg(typingId, reply);
    chatHistory.push({ role: 'assistant', content: reply });
  } catch {
    _replaceMsg(typingId, '⚠️ Could not reach AI. Check your connection.');
  }
}

function _appendMsg(role, text, isTyping = false) {
  const id = `m${++chatMsgCount}`;
  const msgs = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.id = id;
  div.className = `chat-msg ${role}${isTyping ? ' typing' : ''}`;
  div.textContent = text;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return id;
}

function _replaceMsg(id, text) {
  const el = document.getElementById(id);
  if (el) { el.textContent = text; el.classList.remove('typing'); }
}

// ─── Bootstrap ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => MainApp.init());