// ─────────────────────────────────────────────────────────────────────────────
// SKETCHBRIDGE — tablet.js  v3  (Parts 6 + 7)
// New over v2:
//   Part 6 — Text tool:
//     • Tap on canvas in text mode → floating input appears at that position
//     • On submit (Enter / tap elsewhere) → sends a 'text' stroke to Firebase
//     • canvas.js renders it as fillText at the normalised position
//   Part 7 — Theme, password, settings drawer:
//     • Light/dark toggle persisted in localStorage, syncs with canvas.html
//     • Room password: SHA-256 hash saved to Firebase meta
//     • Settings drawer: font size, font family, theme, password
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

// ── DOM refs ──────────────────────────────────────────────────────────────────
const canvasEl        = document.getElementById('draw-canvas');
const ctx             = canvasEl.getContext('2d');
const canvasWrap      = document.getElementById('t-canvas-wrap');
const connectOverlay  = document.getElementById('t-connect-overlay');
const overlayRoom     = document.getElementById('overlay-room');
const tRoomDisplay    = document.getElementById('t-room-display');
const connDot         = document.getElementById('t-conn-dot');
const tStatusText     = document.getElementById('t-status-text');
const activeBar       = document.getElementById('t-active-bar');
const toastContainer  = document.getElementById('toast-container');
const colorRow        = document.getElementById('t-color-row');
const sizeSlider      = document.getElementById('size-slider');
const sizeVal         = document.getElementById('size-val');
const brushPreview    = document.getElementById('brush-preview');
const btnPen          = document.getElementById('tool-pen');
const btnHighlight    = document.getElementById('tool-highlight');
const btnText         = document.getElementById('tool-text');
const btnEraser       = document.getElementById('tool-eraser');
const btnUndo         = document.getElementById('t-undo');
const btnRedo         = document.getElementById('t-redo');
const btnClearLocal   = document.getElementById('t-clear-local');
const btnSettings     = document.getElementById('btn-settings');
const tabletShell     = document.getElementById('tablet-shell');
const toolbar         = document.querySelector('.t-toolbar');
const pageStripEl     = document.getElementById('t-page-strip');
const textInput       = document.getElementById('text-input');
const settingsDrawer  = document.getElementById('settings-drawer');
const settingsBackdrop= document.getElementById('settings-backdrop');
const settingsClose   = document.getElementById('settings-close');
const themeToggle     = document.getElementById('theme-toggle');
const fontSizeSlider  = document.getElementById('font-size-slider');
const fontSizeVal     = document.getElementById('font-size-val');
const fontFamilySel   = document.getElementById('font-family-select');
const pwSetInput      = document.getElementById('pw-set-input');
const pwSetBtn        = document.getElementById('pw-set-btn');

// ── Palette ────────────────────────────────────────────────────────────────────
const PALETTE = [
  '#f0f0f8','#ef4444','#f97316','#eab308',
  '#22c55e','#06b6d4','#4f8ef7','#a855f7',
  '#ec4899','#78716c','#000000',
];

// ── State ─────────────────────────────────────────────────────────────────────
let db         = null;
let pagesRef   = null;
let metaRef    = null;
let strokesRef = null;

let currentPageId  = 'page_1';
let pages          = {};

let currentColor   = PALETTE[0];
let currentWidth   = 4;
let currentTool    = 'pen';
let currentFontSize   = 22;
let currentFontFamily = 'Inter, sans-serif';

let isDrawing      = false;
let currentPoints  = [];
let myStrokes      = [];   // [{id, data}]
let undoBuffer     = [];   // [{id, data}]

// Text tool state
let textPos        = null; // {x, y} normalised

// ── Utilities ─────────────────────────────────────────────────────────────────
function showToast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast${type ? ' toast-' + type : ''}`;
  el.textContent = msg;
  toastContainer.appendChild(el);
  setTimeout(() => { el.classList.add('removing'); setTimeout(() => el.remove(), 220); }, 2800);
}

function getNormCoords(e) {
  const rect = canvasEl.getBoundingClientRect();
  const src  = e.touches ? e.touches[0] : e;
  return { x: (src.clientX - rect.left) / rect.width, y: (src.clientY - rect.top) / rect.height };
}

// ── SHA-256 helper ────────────────────────────────────────────────────────────
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Theme ─────────────────────────────────────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  themeToggle.checked = theme === 'light';
  localStorage.setItem('sb_theme', theme);
}

themeToggle.addEventListener('change', () => {
  applyTheme(themeToggle.checked ? 'light' : 'dark');
});

// ── Canvas resize ─────────────────────────────────────────────────────────────
function resizeCanvas() {
  canvasEl.width  = canvasWrap.clientWidth;
  canvasEl.height = canvasWrap.clientHeight;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.imageSmoothingEnabled = true;
}
window.addEventListener('resize', () => { clearTimeout(window._rt); window._rt = setTimeout(resizeCanvas, 80); });

// ── Palette UI ────────────────────────────────────────────────────────────────
function buildPalette() {
  PALETTE.forEach((color, i) => {
    const sw = document.createElement('div');
    sw.className = 't-swatch' + (i === 0 ? ' selected' : '');
    sw.style.cssText = `background:${color};border:${color === '#000000' ? '2px solid #444' : '2px solid transparent'};`;
    sw.addEventListener('click', () => selectColor(color, sw));
    colorRow.appendChild(sw);
  });
  const customWrap = document.createElement('div');
  customWrap.className = 't-swatch-custom';
  customWrap.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg><input type="color" id="custom-color-input" value="#ff6b6b" />`;
  colorRow.appendChild(customWrap);
  customWrap.querySelector('input').addEventListener('input', (e) => {
    customWrap.style.background = e.target.value;
    customWrap.style.borderStyle = 'solid';
    selectColor(e.target.value, customWrap);
  });
}

function selectColor(color, swatchEl) {
  currentColor = color;
  document.querySelectorAll('.t-swatch').forEach(s => s.classList.remove('selected'));
  if (swatchEl?.classList.contains('t-swatch')) swatchEl.classList.add('selected');
  updateBrushPreview();
}

// ── Tool selection ─────────────────────────────────────────────────────────────
function selectTool(tool) {
  currentTool = tool;
  [btnPen, btnHighlight, btnText, btnEraser].forEach(b => b.classList.remove('active'));
  tabletShell.classList.remove('eraser-active', 'text-mode-active');
  ({ pen: btnPen, highlight: btnHighlight, text: btnText, eraser: btnEraser }[tool] || btnPen).classList.add('active');
  if (tool === 'eraser') tabletShell.classList.add('eraser-active');
  if (tool === 'text')   tabletShell.classList.add('text-mode-active');
  // Hide text input when switching away
  if (tool !== 'text') commitTextInput();
  updateBrushPreview();
}

btnPen.addEventListener('click',       () => selectTool('pen'));
btnHighlight.addEventListener('click', () => selectTool('highlight'));
btnText.addEventListener('click',      () => selectTool('text'));
btnEraser.addEventListener('click',    () => selectTool('eraser'));

// ── Brush size ────────────────────────────────────────────────────────────────
function updateBrushPreview() {
  const size = parseInt(sizeSlider.value, 10);
  currentWidth = size;
  const displaySize = Math.min(size, 34);
  brushPreview.style.width  = displaySize + 'px';
  brushPreview.style.height = displaySize + 'px';
  if (currentTool === 'eraser') {
    brushPreview.style.background = 'var(--text-muted)';
    brushPreview.style.border     = '1.5px solid var(--border-hover)';
    brushPreview.style.opacity    = '1';
  } else if (currentTool === 'highlight') {
    brushPreview.style.background = currentColor;
    brushPreview.style.border     = 'none';
    brushPreview.style.opacity    = '0.38';
  } else if (currentTool === 'text') {
    brushPreview.style.background = currentColor;
    brushPreview.style.border     = 'none';
    brushPreview.style.opacity    = '1';
    brushPreview.style.borderRadius = '2px';
  } else {
    brushPreview.style.background  = currentColor;
    brushPreview.style.border      = 'none';
    brushPreview.style.opacity     = '1';
    brushPreview.style.borderRadius = '50%';
  }
  sizeVal.textContent = size;
}
sizeSlider.addEventListener('input', updateBrushPreview);

// ── Stroke style ──────────────────────────────────────────────────────────────
function getStrokeStyle() {
  if (currentTool === 'eraser')    return { color: '#08080f', width: currentWidth * 3, opacity: 1 };
  if (currentTool === 'highlight') return { color: currentColor, width: currentWidth * 4, opacity: 0.35 };
  return { color: currentColor, width: currentWidth, opacity: 1 };
}

// ── Local preview ─────────────────────────────────────────────────────────────
function localDrawSegment(from, to) {
  const W = canvasEl.width; const H = canvasEl.height;
  const style = getStrokeStyle();
  ctx.save();
  ctx.globalAlpha = style.opacity; ctx.strokeStyle = style.color; ctx.lineWidth = style.width;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(from.x * W, from.y * H); ctx.lineTo(to.x * W, to.y * H); ctx.stroke();
  ctx.restore();
}

// ── Point smoothing ───────────────────────────────────────────────────────────
function smoothPoints(pts, tolerance = 0.0008) {
  if (pts.length <= 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = out[out.length - 1];
    const dx   = pts[i].x - prev.x; const dy = pts[i].y - prev.y;
    if (Math.sqrt(dx * dx + dy * dy) >= tolerance) out.push(pts[i]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// ── Text tool ─────────────────────────────────────────────────────────────────
function showTextInput(normX, normY) {
  const rect = canvasEl.getBoundingClientRect();
  const px   = normX * rect.width  + rect.left - canvasWrap.getBoundingClientRect().left;
  const py   = normY * rect.height + rect.top  - canvasWrap.getBoundingClientRect().top;
  textPos = { x: normX, y: normY };
  textInput.style.left     = px + 'px';
  textInput.style.top      = (py - currentFontSize) + 'px';
  textInput.style.fontSize = currentFontSize + 'px';
  textInput.style.fontFamily = currentFontFamily;
  textInput.style.color    = currentColor;
  textInput.value = '';
  textInput.classList.add('active');
  setTimeout(() => textInput.focus(), 30);
}

function commitTextInput() {
  const val = textInput.value.trim();
  textInput.classList.remove('active');
  textInput.blur();
  if (val && textPos && strokesRef) {
    const strokeData = {
      tool: 'text', text: val, pos: textPos,
      color: currentColor, fontSize: currentFontSize,
      fontFamily: currentFontFamily, ts: Date.now(),
    };
    strokesRef.push(strokeData).then(ref => {
      myStrokes.push({ id: ref.key, data: strokeData });
    }).catch(err => { console.error(err); showToast('Text sync error', 'error'); });
  }
  textPos = null;
}

textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); commitTextInput(); }
  if (e.key === 'Escape') { textInput.value = ''; commitTextInput(); }
});
// Commit on blur
textInput.addEventListener('blur', () => { setTimeout(commitTextInput, 80); });

// ── Pointer events ────────────────────────────────────────────────────────────
function onPointerStart(e) {
  e.preventDefault();
  if (currentTool === 'text') {
    const pt = getNormCoords(e);
    commitTextInput(); // commit any existing
    showTextInput(pt.x, pt.y);
    return;
  }
  isDrawing = true; currentPoints = []; undoBuffer = [];
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  currentPoints.push(getNormCoords(e));
  activeBar.classList.add('drawing');
}

function onPointerMove(e) {
  e.preventDefault();
  if (!isDrawing || currentTool === 'text') return;
  const pt   = getNormCoords(e);
  const prev = currentPoints[currentPoints.length - 1];
  const dx   = (pt.x - prev.x) * canvasEl.width;
  const dy   = (pt.y - prev.y) * canvasEl.height;
  if (Math.sqrt(dx * dx + dy * dy) < 2) return;
  currentPoints.push(pt);
  localDrawSegment(prev, pt);
}

function onPointerEnd(e) {
  e.preventDefault();
  if (!isDrawing || currentTool === 'text') return;
  isDrawing = false;
  activeBar.classList.remove('drawing');
  if (!currentPoints.length) return;
  if (currentPoints.length === 1) currentPoints.push({ x: currentPoints[0].x + 0.0001, y: currentPoints[0].y + 0.0001 });
  sendStroke(smoothPoints(currentPoints));
}

// ── Firebase send (draw) ──────────────────────────────────────────────────────
async function sendStroke(points) {
  if (!strokesRef || points.length < 2) return;
  const style = getStrokeStyle();
  const strokeData = { points, color: style.color, width: style.width, opacity: style.opacity, tool: currentTool, ts: Date.now() };
  try {
    const ref = await strokesRef.push(strokeData);
    myStrokes.push({ id: ref.key, data: strokeData });
  } catch (err) { console.error(err); showToast('Sync error', 'error'); }
}

// ── Undo / Redo ────────────────────────────────────────────────────────────────
btnUndo.addEventListener('click', async () => {
  if (!myStrokes.length) { showToast('Nothing to undo', ''); return; }
  const entry = myStrokes.pop();
  undoBuffer.push(entry);
  try { await strokesRef.child(entry.id).remove(); }
  catch { myStrokes.push(entry); undoBuffer.pop(); showToast('Undo failed', 'error'); }
});

btnRedo.addEventListener('click', async () => {
  if (!undoBuffer.length) { showToast('Nothing to redo', ''); return; }
  const entry = undoBuffer.pop();
  try {
    const ref = await strokesRef.push(entry.data);
    myStrokes.push({ id: ref.key, data: entry.data });
  } catch { undoBuffer.push(entry); showToast('Redo failed', 'error'); }
});

// ── Clear own strokes ──────────────────────────────────────────────────────────
btnClearLocal.addEventListener('click', async () => {
  if (!myStrokes.length) { showToast('No strokes to clear', ''); return; }
  const toDelete = myStrokes.splice(0); undoBuffer = [];
  try {
    await Promise.all(toDelete.map(e => strokesRef.child(e.id).remove()));
    showToast('Your strokes cleared', 'success');
  } catch { showToast('Clear error', 'error'); }
});

// ── Events ────────────────────────────────────────────────────────────────────
function attachEvents() {
  canvasEl.addEventListener('touchstart',  onPointerStart, { passive: false });
  canvasEl.addEventListener('touchmove',   onPointerMove,  { passive: false });
  canvasEl.addEventListener('touchend',    onPointerEnd,   { passive: false });
  canvasEl.addEventListener('touchcancel', onPointerEnd,   { passive: false });
  canvasEl.addEventListener('mousedown',   onPointerStart);
  canvasEl.addEventListener('mousemove',   onPointerMove);
  canvasEl.addEventListener('mouseup',     onPointerEnd);
  canvasEl.addEventListener('mouseleave',  (e) => { if (isDrawing) onPointerEnd(e); });
  canvasEl.addEventListener('contextmenu', e => e.preventDefault());
  document.body.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
}

// ── Settings drawer ───────────────────────────────────────────────────────────
btnSettings.addEventListener('click', () => settingsDrawer.classList.add('open'));
settingsClose.addEventListener('click',    () => settingsDrawer.classList.remove('open'));
settingsBackdrop.addEventListener('click', () => settingsDrawer.classList.remove('open'));

fontSizeSlider.addEventListener('input', () => {
  currentFontSize = parseInt(fontSizeSlider.value, 10);
  fontSizeVal.textContent = currentFontSize;
});

fontFamilySel.addEventListener('change', () => {
  currentFontFamily = fontFamilySel.value;
});

pwSetBtn.addEventListener('click', async () => {
  const val = pwSetInput.value.trim();
  try {
    if (!val) {
      await metaRef.update({ passwordHash: null });
      showToast('Password removed', 'success');
    } else {
      const hash = await sha256(val);
      await metaRef.update({ passwordHash: hash });
      sessionStorage.setItem(`sb_pw_${ROOM}`, hash);
      showToast('Password set', 'success');
    }
    pwSetInput.value = '';
    settingsDrawer.classList.remove('open');
  } catch { showToast('Could not save password', 'error'); }
});

// ── Page strip UI ─────────────────────────────────────────────────────────────
function renderPageStrip() {
  pageStripEl.innerHTML = '';
  const sorted = Object.entries(pages).sort((a, b) => (a[1].order||0) - (b[1].order||0));
  sorted.forEach(([id, page]) => {
    const isActive = id === currentPageId;
    const btn = document.createElement('button');
    btn.textContent = page.label || id;
    btn.style.cssText = [
      'padding:2px 10px','border-radius:5px','border:1px solid','cursor:pointer',
      "font-family:var(--font-body)",'font-size:0.72rem','font-weight:500',
      'white-space:nowrap','transition:all 0.15s','-webkit-tap-highlight-color:transparent',
      `background:${isActive ? 'var(--accent-dim)' : 'transparent'}`,
      `color:${isActive ? 'var(--accent)' : 'var(--text-secondary)'}`,
      `border-color:${isActive ? 'rgba(79,142,247,0.35)' : 'rgba(255,255,255,0.07)'}`,
    ].join(';');
    btn.addEventListener('click', () => switchPage(id));
    pageStripEl.appendChild(btn);
  });
  const countEl = document.createElement('span');
  countEl.style.cssText = 'font-family:var(--font-mono);font-size:0.65rem;color:var(--text-muted);margin-left:4px;white-space:nowrap;';
  countEl.textContent = sorted.length + '/8';
  pageStripEl.appendChild(countEl);
}

// ── Page switching ─────────────────────────────────────────────────────────────
function switchPage(pageId) {
  if (pageId === currentPageId && strokesRef) return;
  if (strokesRef) strokesRef.off();
  myStrokes = []; undoBuffer = [];
  currentPageId = pageId;
  strokesRef    = db.ref(`rooms/${ROOM}/strokes_${pageId}`);
  renderPageStrip();
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
}

// ── Firebase init ─────────────────────────────────────────────────────────────
async function init() {
  try {
    await loadScript(FB_APP_SRC);
    await loadScript(FB_DB_SRC);
    let app;
    try { app = firebase.app(); } catch (_) { app = firebase.initializeApp(FIREBASE_CONFIG); }
    db       = firebase.database();
    pagesRef = db.ref(`rooms/${ROOM}/pages`);
    metaRef  = db.ref(`rooms/${ROOM}/meta`);

    db.ref('.info/connected').on('value', snap => {
      const live = snap.val() === true;
      connDot.classList.toggle('live', live);
      tStatusText.textContent = live ? 'Live' : 'Reconnecting…';
      if (live) connectOverlay.classList.add('hidden');
    });

    pagesRef.on('value', (snapshot) => {
      if (snapshot.exists()) { pages = snapshot.val(); }
      else { pages = { page_1: { label: 'Page 1', order: 0 } }; }
      renderPageStrip();
      if (!pages[currentPageId]) {
        const first = Object.entries(pages).sort((a, b) => (a[1].order||0) - (b[1].order||0))[0];
        if (first) switchPage(first[0]);
      }
    });

    strokesRef = db.ref(`rooms/${ROOM}/strokes_${currentPageId}`);
    metaRef.update({ tabletLastSeen: Date.now() });

  } catch (err) {
    console.error(err);
    tStatusText.textContent = 'Connection failed';
    showToast('Firebase error — check firebase-config.js', 'error');
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
(function boot() {
  // Theme
  const savedTheme = localStorage.getItem('sb_theme') || 'dark';
  applyTheme(savedTheme);

  tRoomDisplay.textContent = ROOM;
  overlayRoom.textContent  = ROOM;
  document.title           = `SketchBridge — Draw (${ROOM})`;
  resizeCanvas();
  buildPalette();
  selectTool('pen');
  updateBrushPreview();
  attachEvents();
  init();
})();
