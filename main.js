// ─────────────────────────────────────────────────────────────────────────────
// SKETCHBRIDGE — main.js  (landing page logic)
// Handles: tab switching, room code generation, copy, navigation
// ─────────────────────────────────────────────────────────────────────────────

// ── Firebase init ──────────────────────────────────────────────────────────
// Firebase 9 compat CDN loaded via index.html (see bottom of this file's usage)
// We load Firebase lazily to keep index.html simple.
const FIREBASE_CDN = "https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js";
const FIREBASE_DB_CDN = "https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js";

let _fbApp = null;
let _fbDb  = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function getDb() {
  if (_fbDb) return _fbDb;
  await loadScript(FIREBASE_CDN);
  await loadScript(FIREBASE_DB_CDN);
  _fbApp = firebase.initializeApp(FIREBASE_CONFIG);
  _fbDb  = firebase.database();
  return _fbDb;
}

// ── Utilities ──────────────────────────────────────────────────────────────

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/I/1 confusion

function generateCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return code;
}

function showToast(msg, type = '') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast${type ? ' toast-' + type : ''}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('removing');
    setTimeout(() => el.remove(), 220);
  }, 2800);
}

function copyToClipboard(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => showToast('Code copied!', 'success'));
  } else {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('Code copied!', 'success');
  }
}

// Validate & normalise room code input
function normaliseCode(raw) {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

// ── State ──────────────────────────────────────────────────────────────────
let currentCode = generateCode();

// ── DOM refs ───────────────────────────────────────────────────────────────
const generatedCodeEl    = document.getElementById('generated-code');
const copyCodeBtn        = document.getElementById('copy-code-btn');
const regenBtn           = document.getElementById('regen-btn');
const openCanvasBtn      = document.getElementById('open-canvas-btn');
const joinInput          = document.getElementById('join-input');
const joinAsCanvasBtn    = document.getElementById('join-as-canvas-btn');
const joinAsTabletBtn    = document.getElementById('join-as-tablet-btn');
const tabBtns            = document.querySelectorAll('.tab-btn');
const tabPanels          = document.querySelectorAll('.tab-panel');

// ── Tab switching ──────────────────────────────────────────────────────────
tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab;
    tabBtns.forEach(b => b.classList.remove('active'));
    tabPanels.forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + target).classList.add('active');
  });
});

// ── Create tab ─────────────────────────────────────────────────────────────
function refreshCode(code) {
  currentCode = code;
  generatedCodeEl.textContent = code;
}
refreshCode(currentCode);

regenBtn.addEventListener('click', () => {
  refreshCode(generateCode());
});

copyCodeBtn.addEventListener('click', () => {
  copyToClipboard(currentCode);
});

openCanvasBtn.addEventListener('click', async () => {
  openCanvasBtn.disabled = true;
  openCanvasBtn.innerHTML = '<span class="spinner"></span> Opening…';

  try {
    // Mark room as created in Firebase with timestamp
    const db = await getDb();
    await db.ref(`rooms/${currentCode}/meta`).set({
      createdAt: Date.now(),
      host: true
    });
    // Navigate to canvas
    window.location.href = `canvas.html?room=${currentCode}`;
  } catch (err) {
    console.error(err);
    showToast('Could not connect to Firebase. Check firebase-config.js', 'error');
    openCanvasBtn.disabled = false;
    openCanvasBtn.innerHTML = 'Open Canvas <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
  }
});

// ── Join tab ───────────────────────────────────────────────────────────────
joinInput.addEventListener('input', (e) => {
  e.target.value = normaliseCode(e.target.value);
});

joinInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinAsCanvasBtn.click();
});

function validateJoinCode() {
  const code = joinInput.value.trim();
  if (code.length !== 6) {
    showToast('Please enter a 6-character room code', 'error');
    joinInput.focus();
    return null;
  }
  return code;
}

joinAsCanvasBtn.addEventListener('click', () => {
  const code = validateJoinCode();
  if (!code) return;
  window.location.href = `canvas.html?room=${code}`;
});

joinAsTabletBtn.addEventListener('click', () => {
  const code = validateJoinCode();
  if (!code) return;
  window.location.href = `tablet.html?room=${code}`;
});

// ── URL param pre-fill (e.g. QR code link with ?room=XXXX) ─────────────────
(function checkUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const room = params.get('room');
  if (room && room.length === 6) {
    // Switch to Join tab and pre-fill
    document.querySelector('.tab-btn[data-tab="join"]').click();
    joinInput.value = normaliseCode(room);
  }
})();

// ── Firebase connectivity badge ─────────────────────────────────────────────
// We show "Connected" badge after successful Firebase initialisation.
// We try to init Firebase in the background after page load.
window.addEventListener('load', async () => {
  try {
    const db = await getDb();
    const connRef = db.ref('.info/connected');
    connRef.on('value', snap => {
      const navStatus = document.getElementById('nav-status');
      if (snap.val() === true) {
        navStatus.style.display = 'inline-flex';
      } else {
        navStatus.style.display = 'none';
      }
    });
  } catch (_) {
    // Firebase not configured yet — silent fail on landing page
  }
});
