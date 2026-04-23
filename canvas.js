// ─────────────────────────────────────────────────────────────────────────────
// SKETCHBRIDGE — canvas.js  v3  (Parts 6 + 7)
// New over v2:
//   Part 6 — Text tool receiver:
//     • Renders text strokes sent by tablet (tool === 'text')
//     • Text drawn onto canvas with correct font / color / size
//   Part 7 — QR code, dark/light mode, room passwords:
//     • QR popover with tablet join URL + room code pre-filled
//     • Theme toggle persisted in localStorage
//     • Password: room creator can set one; visitors must enter it
// ─────────────────────────────────────────────────────────────────────────────

const FB_APP_SRC = 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js';
const FB_DB_SRC  = 'https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js';

function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

// ── URL param ─────────────────────────────────────────────────────────────────
const params = new URLSearchParams(window.location.search);
const ROOM   = (params.get('room') || '').toUpperCase().trim();
if (!ROOM || ROOM.length !== 6) window.location.href = 'index.html';

const MAX_PAGES = 8;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const canvasEl           = document.getElementById('main-canvas');
const ctx                = canvasEl.getContext('2d');
const canvasArea         = document.getElementById('canvas-area');
const waitingOverlay     = document.getElementById('waiting-overlay');
const waitingCodeDisplay = document.getElementById('waiting-code-display');
const waitingUrl         = document.getElementById('waiting-url');
const roomCodeDisplay    = document.getElementById('room-code-display');
const roomChip           = document.getElementById('room-chip');
const connBadge          = document.getElementById('conn-badge');
const statusText         = document.getElementById('status-text');
const strokeCountEl      = document.getElementById('stroke-count');
const statusTimeEl       = document.getElementById('status-time');
const btnUndo            = document.getElementById('btn-undo');
const btnRedo            = document.getElementById('btn-redo');
const btnClear           = document.getElementById('btn-clear');
const btnDownload        = document.getElementById('btn-download');
const btnHome            = document.getElementById('btn-home');
const btnQr              = document.getElementById('btn-qr');
const btnTheme           = document.getElementById('btn-theme');
const qrPopover          = document.getElementById('qr-popover');
const qrCanvas           = document.getElementById('qr-canvas');
const qrUrlLabel         = document.getElementById('qr-url-label');
const clearModal         = document.getElementById('clear-modal');
const modalCancel        = document.getElementById('modal-cancel');
const modalConfirm       = document.getElementById('modal-confirm');
const pwModal            = document.getElementById('pw-modal');
const pwInput            = document.getElementById('pw-input');
const pwSubmit           = document.getElementById('pw-submit');
const toastContainer     = document.getElementById('toast-container');
const pageStrip          = document.getElementById('page-strip');
const iconDark           = document.getElementById('icon-dark');
const iconLight          = document.getElementById('icon-light');

// ── State ─────────────────────────────────────────────────────────────────────
let db           = null;
let roomRef      = null;
let pagesRef     = null;
let strokesRef   = null;
let metaRef      = null;

let currentPageId = 'page_1';
let pages         = { page_1: { label: 'Page 1', order: 0 } };

const strokeMap  = new Map();
let strokeOrder  = [];
let undoStack    = [];
let _qrGenerated = false;

// ── Theme ─────────────────────────────────────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  iconDark.style.display  = theme === 'dark'  ? 'block' : 'none';
  iconLight.style.display = theme === 'light' ? 'block' : 'none';
  localStorage.setItem('sb_theme', theme);
  // Redraw so canvas bg matches
  redrawAll();
}

btnTheme.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

// ── Canvas resize ─────────────────────────────────────────────────────────────
function resizeCanvas() {
  canvasEl.width  = canvasArea.clientWidth;
  canvasEl.height = canvasArea.clientHeight;
  applyCtxDefaults();
  redrawAll();
}
function applyCtxDefaults() {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.imageSmoothingEnabled = true;
}
window.addEventListener('resize', () => { clearTimeout(window._rt); window._rt = setTimeout(resizeCanvas, 80); });

// ── Drawing ───────────────────────────────────────────────────────────────────
function drawStroke(stroke) {
  if (!stroke) return;

  // TEXT strokes
  if (stroke.tool === 'text') {
    if (!stroke.text || !stroke.pos) return;
    const W = canvasEl.width; const H = canvasEl.height;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle   = stroke.color || '#f0f0f8';
    ctx.font        = `${stroke.fontSize || 18}px ${stroke.fontFamily || 'Inter, sans-serif'}`;
    ctx.fillText(stroke.text, stroke.pos.x * W, stroke.pos.y * H);
    ctx.restore();
    return;
  }

  // DRAW strokes
  if (!stroke.points || stroke.points.length < 2) return;
  const W   = canvasEl.width; const H = canvasEl.height;
  const pts = stroke.points;
  ctx.save();
  ctx.globalAlpha = stroke.opacity != null ? stroke.opacity : 1;
  ctx.strokeStyle = stroke.color || '#f0f0f8';
  ctx.lineWidth   = stroke.width || 3;
  ctx.lineCap     = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0].x * W, pts[0].y * H);
  if (pts.length === 2) {
    ctx.lineTo(pts[1].x * W, pts[1].y * H);
  } else {
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = ((pts[i].x + pts[i + 1].x) / 2) * W;
      const my = ((pts[i].y + pts[i + 1].y) / 2) * H;
      ctx.quadraticCurveTo(pts[i].x * W, pts[i].y * H, mx, my);
    }
    ctx.lineTo(pts[pts.length - 1].x * W, pts[pts.length - 1].y * H);
  }
  ctx.stroke();
  ctx.restore();
}

function redrawAll() {
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
  ctx.fillStyle = theme === 'light' ? '#f4f4f8' : '#08080f';
  ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);

  const undoneIds = new Set(undoStack.map(u => u.id));
  for (const id of strokeOrder) {
    if (undoneIds.has(id)) continue;
    const stroke = strokeMap.get(id);
    if (stroke) drawStroke(stroke);
  }
  const visible = strokeOrder.length - undoStack.length;
  strokeCountEl.textContent = visible + ' stroke' + (visible !== 1 ? 's' : '');
}

// ── Waiting overlay ───────────────────────────────────────────────────────────
function setWaiting(show) { waitingOverlay.classList.toggle('hidden', !show); }

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast${type ? ' toast-' + type : ''}`;
  el.textContent = msg;
  toastContainer.appendChild(el);
  setTimeout(() => { el.classList.add('removing'); setTimeout(() => el.remove(), 220); }, 2800);
}

// ── Clock ─────────────────────────────────────────────────────────────────────
function updateClock() { statusTimeEl.textContent = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }); }
setInterval(updateClock, 1000); updateClock();

// ── Connection status ─────────────────────────────────────────────────────────
function setStatus(state) {
  if (state === 'connected') {
    statusText.textContent = 'Connected'; statusText.style.color = '#22c55e';
    connBadge.className = 'badge badge-success'; connBadge.style.display = 'inline-flex';
    connBadge.innerHTML = '<span class="dot-live"></span> Live';
  } else if (state === 'disconnected') {
    statusText.textContent = 'Disconnected — retrying…'; statusText.style.color = '#ef4444';
    connBadge.style.display = 'none';
  } else {
    statusText.textContent = 'Connecting…'; statusText.style.color = '';
    connBadge.style.display = 'none';
  }
}

// ── Old stroke cleanup ────────────────────────────────────────────────────────
async function cleanOldStrokes(snapshot) {
  const now = Date.now(); const toDelete = [];
  snapshot.forEach(child => { const v = child.val(); if (v && v.ts && (now - v.ts) > ROOM_EXPIRY_MS) toDelete.push(child.key); });
  for (const key of toDelete) strokesRef.child(key).remove().catch(() => {});
}

// ── QR Code ───────────────────────────────────────────────────────────────────
function generateQR() {
  if (_qrGenerated) return;
  _qrGenerated = true;
  const tabletUrl = `${window.location.origin}/tablet.html?room=${ROOM}`;
  qrUrlLabel.textContent = tabletUrl;
  try {
    // QRCode.js draws onto a canvas element
    new QRCode(qrCanvas, {
      text:           tabletUrl,
      width:          160,
      height:         160,
      colorDark:      '#0f0f1a',
      colorLight:     '#ffffff',
      correctLevel:   QRCode.CorrectLevel.M,
    });
  } catch (e) {
    // Fallback: show URL if library failed
    qrUrlLabel.style.fontSize = '0.75rem';
    qrUrlLabel.style.color    = 'var(--accent)';
    qrCanvas.style.display    = 'none';
  }
}

btnQr.addEventListener('click', (e) => {
  e.stopPropagation();
  const isOpen = qrPopover.classList.toggle('open');
  if (isOpen) generateQR();
});
document.addEventListener('click', (e) => {
  if (!qrPopover.contains(e.target) && e.target !== btnQr) qrPopover.classList.remove('open');
});

// ── Password ──────────────────────────────────────────────────────────────────
let _roomPasswordHash = null; // SHA-256 hex stored in Firebase meta

async function sha256(str) {
  const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function showPasswordModal() {
  pwModal.classList.add('open');
  setTimeout(() => pwInput.focus(), 100);
}

pwSubmit.addEventListener('click', async () => {
  const val = pwInput.value.trim();
  if (!val) return;
  const hash = await sha256(val);
  if (hash === _roomPasswordHash) {
    pwModal.classList.remove('open');
    sessionStorage.setItem(`sb_pw_${ROOM}`, hash);
  } else {
    pwInput.value = '';
    pwInput.style.borderColor = '#ef4444';
    showToast('Incorrect password', 'error');
    setTimeout(() => { pwInput.style.borderColor = ''; }, 1500);
  }
});
pwInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') pwSubmit.click(); });

async function checkPassword(meta) {
  if (!meta || !meta.passwordHash) return; // no password set
  _roomPasswordHash = meta.passwordHash;
  const saved = sessionStorage.getItem(`sb_pw_${ROOM}`);
  if (saved === _roomPasswordHash) return; // already verified this session
  showPasswordModal();
}

// ── Page strip UI ─────────────────────────────────────────────────────────────
function renderPageStrip() {
  pageStrip.innerHTML = '';
  const sorted = Object.entries(pages).sort((a, b) => (a[1].order || 0) - (b[1].order || 0));

  sorted.forEach(([id, page]) => {
    const isActive = id === currentPageId;
    const btn = document.createElement('button');
    btn.textContent = page.label || id;
    btn.style.cssText = [
      'padding:3px 12px','border-radius:6px','border:1px solid','cursor:pointer',
      "font-family:var(--font-body)",'font-size:0.78rem','font-weight:500',
      'transition:all 0.15s','white-space:nowrap',
      `background:${isActive ? 'var(--accent-dim)' : 'transparent'}`,
      `color:${isActive ? 'var(--accent)' : 'var(--text-secondary)'}`,
      `border-color:${isActive ? 'rgba(79,142,247,0.35)' : 'rgba(255,255,255,0.07)'}`,
    ].join(';');
    btn.addEventListener('click', () => switchPage(id));
    pageStrip.appendChild(btn);
  });

  if (sorted.length < MAX_PAGES) {
    const addBtn = document.createElement('button');
    addBtn.title = 'Add page';
    addBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
    addBtn.style.cssText = 'width:26px;height:26px;border-radius:6px;border:1px solid rgba(255,255,255,0.07);background:transparent;color:rgba(255,255,255,0.3);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all 0.15s;';
    addBtn.addEventListener('click', addPage);
    addBtn.onmouseenter = () => { addBtn.style.borderColor='rgba(255,255,255,0.14)'; addBtn.style.color='var(--text-primary)'; };
    addBtn.onmouseleave = () => { addBtn.style.borderColor='rgba(255,255,255,0.07)'; addBtn.style.color='rgba(255,255,255,0.3)'; };
    pageStrip.appendChild(addBtn);
  }

  if (sorted.length > 1) {
    const delBtn = document.createElement('button');
    delBtn.title = 'Delete this page';
    delBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>`;
    delBtn.style.cssText = 'width:26px;height:26px;border-radius:6px;border:1px solid rgba(239,68,68,0.2);background:transparent;color:rgba(239,68,68,0.4);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all 0.15s;margin-left:2px;';
    delBtn.addEventListener('click', deletePage);
    delBtn.onmouseenter = () => { delBtn.style.borderColor='rgba(239,68,68,0.5)'; delBtn.style.color='#ef4444'; };
    delBtn.onmouseleave = () => { delBtn.style.borderColor='rgba(239,68,68,0.2)'; delBtn.style.color='rgba(239,68,68,0.4)'; };
    pageStrip.appendChild(delBtn);
  }
}

// ── Page operations ────────────────────────────────────────────────────────────
async function addPage() {
  const sorted = Object.entries(pages).sort((a, b) => (a[1].order||0) - (b[1].order||0));
  const newId  = 'page_' + Date.now();
  const newPage = { label: 'Page ' + (sorted.length + 1), order: sorted.length };
  try {
    await pagesRef.child(newId).set(newPage);
    pages[newId] = newPage; renderPageStrip(); switchPage(newId);
  } catch { showToast('Could not add page', 'error'); }
}

async function deletePage() {
  const sorted = Object.entries(pages).sort((a, b) => (a[1].order||0) - (b[1].order||0));
  if (sorted.length <= 1) return;
  if (!window.confirm(`Delete "${pages[currentPageId]?.label}"? All strokes will be lost.`)) return;
  const deletingId = currentPageId;
  const idx    = sorted.findIndex(([id]) => id === deletingId);
  const nextId = sorted[idx === 0 ? 1 : idx - 1]?.[0];
  if (nextId) await switchPage(nextId);
  try {
    await pagesRef.child(deletingId).remove();
    await db.ref(`rooms/${ROOM}/strokes_${deletingId}`).remove();
    delete pages[deletingId]; renderPageStrip();
  } catch { showToast('Could not delete page', 'error'); }
}

// ── Page switching ─────────────────────────────────────────────────────────────
function switchPage(pageId) {
  if (pageId === currentPageId && strokesRef) return;
  if (strokesRef) strokesRef.off();
  strokeMap.clear(); strokeOrder = []; undoStack = [];
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
  setWaiting(true);
  currentPageId = pageId;
  strokesRef    = db.ref(`rooms/${ROOM}/strokes_${pageId}`);
  renderPageStrip();
  attachStrokeListeners();
}

// ── Firebase stroke listeners ─────────────────────────────────────────────────
function attachStrokeListeners() {
  if (!strokesRef) return;
  strokesRef.on('value', (snapshot) => {
    strokeMap.clear(); strokeOrder = []; undoStack = [];
    if (snapshot.exists()) {
      const entries = Object.entries(snapshot.val()).sort((a, b) => (a[1].ts||0) - (b[1].ts||0));
      for (const [id, stroke] of entries) {
        if (stroke && (stroke.points || stroke.tool === 'text')) { strokeMap.set(id, stroke); strokeOrder.push(id); }
      }
      setWaiting(strokeOrder.length === 0);
      cleanOldStrokes(snapshot);
    } else { setWaiting(true); }
    redrawAll();
  });

  strokesRef.on('child_added', (snapshot) => {
    const id = snapshot.key; const stroke = snapshot.val();
    if (!stroke || strokeMap.has(id)) return;
    if (!stroke.points && stroke.tool !== 'text') return;
    strokeMap.set(id, stroke); strokeOrder.push(id);
    setWaiting(false); drawStroke(stroke);
    const visible = strokeOrder.length - undoStack.length;
    strokeCountEl.textContent = visible + ' stroke' + (visible !== 1 ? 's' : '');
  });

  strokesRef.on('child_removed', (snapshot) => {
    const id = snapshot.key;
    strokeMap.delete(id); strokeOrder = strokeOrder.filter(s => s !== id);
    undoStack = undoStack.filter(u => u.id !== id);
    setWaiting(strokeOrder.length === 0); redrawAll();
  });
}

// ── Undo / Redo ────────────────────────────────────────────────────────────────
function undo() {
  const undoneIds = new Set(undoStack.map(u => u.id));
  const visible   = strokeOrder.filter(id => !undoneIds.has(id));
  if (!visible.length) return;
  const lastId = visible[visible.length - 1];
  const data   = strokeMap.get(lastId);
  if (!data) return;
  undoStack.push({ id: lastId, data });
  redrawAll();
  strokesRef.child(lastId).remove().catch(console.error);
}

async function redo() {
  if (!undoStack.length) return;
  const entry = undoStack.pop();
  try {
    const ref = await strokesRef.push(entry.data);
    strokeMap.delete(entry.id); strokeOrder = strokeOrder.filter(id => id !== entry.id);
    strokeMap.set(ref.key, entry.data); strokeOrder.push(ref.key);
    redrawAll();
  } catch { undoStack.push(entry); showToast('Redo failed', 'error'); }
}

btnUndo.addEventListener('click', undo);
btnRedo.addEventListener('click', redo);
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey||e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  if ((e.ctrlKey||e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
});

// ── Clear ─────────────────────────────────────────────────────────────────────
btnClear.addEventListener('click', () => clearModal.classList.add('open'));
modalCancel.addEventListener('click', () => clearModal.classList.remove('open'));
modalConfirm.addEventListener('click', async () => {
  clearModal.classList.remove('open');
  try { await strokesRef.remove(); showToast('Canvas cleared', 'success'); }
  catch { showToast('Error clearing canvas', 'error'); }
});
clearModal.addEventListener('click', (e) => { if (e.target === clearModal) clearModal.classList.remove('open'); });

// ── Download ──────────────────────────────────────────────────────────────────
btnDownload.addEventListener('click', () => {
  const off = document.createElement('canvas');
  off.width = canvasEl.width; off.height = canvasEl.height;
  const octx = off.getContext('2d');
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  octx.fillStyle = theme === 'light' ? '#f4f4f8' : '#08080f';
  octx.fillRect(0, 0, off.width, off.height);
  octx.drawImage(canvasEl, 0, 0);
  const link = document.createElement('a');
  link.download = `sketchbridge-${ROOM}-${currentPageId}-${Date.now()}.png`;
  link.href = off.toDataURL('image/png'); link.click();
  showToast('Downloaded!', 'success');
});

btnHome.addEventListener('click', () => { window.location.href = 'index.html'; });
roomChip.addEventListener('click', () => { navigator.clipboard?.writeText(ROOM).then(() => showToast('Room code copied!', 'success')); });

// ── Firebase init ─────────────────────────────────────────────────────────────
async function init() {
  try {
    await loadScript(FB_APP_SRC);
    await loadScript(FB_DB_SRC);
    let app;
    try { app = firebase.app(); } catch (_) { app = firebase.initializeApp(FIREBASE_CONFIG); }
    db       = firebase.database();
    roomRef  = db.ref(`rooms/${ROOM}`);
    pagesRef = db.ref(`rooms/${ROOM}/pages`);
    metaRef  = db.ref(`rooms/${ROOM}/meta`);

    db.ref('.info/connected').on('value', snap => setStatus(snap.val() ? 'connected' : 'disconnected'));

    // Check password from meta
    metaRef.once('value', snap => {
      if (snap.exists()) checkPassword(snap.val());
    });

    // Pages listener
    pagesRef.on('value', (snapshot) => {
      if (snapshot.exists()) { pages = snapshot.val(); }
      else { pages = { page_1: { label: 'Page 1', order: 0 } }; pagesRef.set(pages); }
      renderPageStrip();
      if (!pages[currentPageId]) {
        const first = Object.entries(pages).sort((a, b) => (a[1].order||0) - (b[1].order||0))[0];
        if (first) switchPage(first[0]);
      }
    });

    strokesRef = db.ref(`rooms/${ROOM}/strokes_${currentPageId}`);
    attachStrokeListeners();
    metaRef.update({ canvasLastSeen: Date.now() });

  } catch (err) {
    console.error(err);
    setStatus('disconnected');
    showToast('Firebase connection failed. Check firebase-config.js', 'error');
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
(function boot() {
  // Theme
  const savedTheme = localStorage.getItem('sb_theme') || 'dark';
  applyTheme(savedTheme);

  roomCodeDisplay.textContent    = ROOM;
  waitingCodeDisplay.textContent = ROOM;
  waitingUrl.textContent         = window.location.origin + '/';
  document.title                 = `SketchBridge — Room ${ROOM}`;

  canvasEl.width  = canvasArea.clientWidth  || window.innerWidth;
  canvasEl.height = canvasArea.clientHeight || window.innerHeight - 120;
  applyCtxDefaults();
  setWaiting(true);
  init();
})();
