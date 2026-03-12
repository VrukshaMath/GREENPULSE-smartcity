/**
 * site.js — EcoNav Shared JS (runs on every page)
 * Chatbot drawer + Carbon popup trigger + Toast util
 */

// ── Global State ───────────────────────────────────
let chatOpen      = false;
let chatHistory   = [];
let chatMsgId     = 0;
let carbonWindow  = null;
let siteAQI       = null;
let siteRoute     = null;
let siteMode      = null;

// ── Chat Drawer ─────────────────────────────────────
function toggleChat() {
  chatOpen = !chatOpen;
  document.getElementById('chat-drawer').classList.toggle('open', chatOpen);
  document.getElementById('chat-veil').classList.toggle('open', chatOpen);

  const icon = document.getElementById('chat-fab-icon');
  if (icon) icon.textContent = chatOpen ? '✕' : '🌿';

  if (chatOpen) {
    // Add welcome message if first open
    const msgs = document.getElementById('chat-msgs');
    if (msgs && msgs.children.length === 0) {
      appendBubble('assistant', "Hi! I'm GreenPulse AI 🌿 Ask me about air quality, eco routes, or carbon footprint tips.");
    }
    setTimeout(() => {
      if (msgs) msgs.scrollTop = msgs.scrollHeight;
      const input = document.getElementById('chat-in');
      if (input) input.focus();
    }, 150);
  }
}

function quickChat(text) {
  if (!chatOpen) toggleChat();
  setTimeout(() => {
    const input = document.getElementById('chat-in');
    if (input) { input.value = text; sendChat(); }
  }, 200);
}

async function sendChat() {
  const input = document.getElementById('chat-in');
  const btn   = document.getElementById('chat-send-btn');
  const message = (input?.value || '').trim();
  if (!message) return;

  input.value = '';
  appendBubble('user', message);
  chatHistory.push({ role: 'user', content: message });

  if (btn) btn.disabled = true;
  const typingId = appendBubble('assistant', '…', true);

  const context = {
    aqi:         siteAQI?.aqi,
    distance_km: siteRoute?.distance_km,
    mode:        siteMode,
  };

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history: chatHistory, context }),
    });
    const data = await res.json();
    const reply = data.reply || data.error || 'No response.';
    replaceBubble(typingId, reply);
    chatHistory.push({ role: 'assistant', content: reply });
  } catch {
    replaceBubble(typingId, '⚠️ Could not reach AI. Is Flask running?');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Allow Enter key in chat input
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('chat-in');
  if (input) {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') sendChat();
    });
  }
});

function appendBubble(role, text, isTyping = false) {
  const id = `cb${++chatMsgId}`;
  const msgs = document.getElementById('chat-msgs');
  if (!msgs) return id;
  const div = document.createElement('div');
  div.id = id;
  div.className = `chat-bubble ${role}${isTyping ? ' typing' : ''}`;
  div.textContent = text;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return id;
}

function replaceBubble(id, text) {
  const el = document.getElementById(id);
  if (el) { el.textContent = text; el.classList.remove('typing'); }
}

// ── Carbon Popup ────────────────────────────────────
function openCarbonPopup() {
  const w = 480, h = 590;
  const left = Math.round(screen.width  / 2 - w / 2);
  const top  = Math.round(screen.height / 2 - h / 2);
  if (carbonWindow && !carbonWindow.closed) { carbonWindow.focus(); return; }
  carbonWindow = window.open(
    '/carbon', 'EcoNavCarbon',
    `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes,toolbar=no,menubar=no`
  );

  // Pass current state once popup loads
  if (carbonWindow) {
    carbonWindow.addEventListener('load', () => {
      if (siteRoute) {
        carbonWindow.postMessage({
          type: 'route_update',
          route: siteRoute,
          mode: siteMode || 'walking'
        }, '*');
      }
    });
  }
}

// ── Toast ────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const wrap = document.getElementById('toast-wrap');
  if (!wrap) return;
  const t = document.createElement('div');
  t.className = `toast${type === 'error' ? ' error' : type === 'warn' ? ' warn' : ''}`;
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

// ── Listen for messages from carbon popup ────────────
window.addEventListener('message', (e) => {
  if (e.data?.type === 'mode_changed') {
    siteMode = e.data.mode;
    showToast(`Transport mode: ${e.data.mode}`);
  }
});