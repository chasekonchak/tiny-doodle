// ===================================================================
// Tiny Doodle renderer
// Model: an offscreen "art" canvas holds the drawing at DEVICE-pixel
// resolution (1 art px = 1 physical px at zoom 1). The visible #board
// is a *view* onto the art with a zoom + pan transform, drawn with
// nearest-neighbor so pixels stay crisp when magnified.
// ===================================================================

// ---------- Window controls ----------
const pinBtn = document.getElementById('pinBtn');
const minBtn = document.getElementById('minBtn');
const closeBtn = document.getElementById('closeBtn');

let pinned = false;
pinBtn.addEventListener('click', () => {
  pinned = !pinned;
  pinBtn.classList.toggle('pinned', pinned);
  window.electronAPI.togglePin(pinned);
});
minBtn.addEventListener('click', () => window.electronAPI.minimize());
closeBtn.addEventListener('click', () => window.electronAPI.close());

// ---------- Canvas / view setup ----------
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const wrap = document.getElementById('canvasWrap');
const brushCursor = document.getElementById('brushCursor');
const zoomIndicator = document.getElementById('zoomIndicator');

let dpr = window.devicePixelRatio || 1;

// Offscreen artwork (device-pixel resolution). Starts 1x1 and grows.
const art = document.createElement('canvas');
art.width = 1;
art.height = 1;
const actx = art.getContext('2d');

let zoom = 1;           // 1..32
let panX = 0, panY = 0; // top-left art-pixel shown in the view

function ensureArtSize() {
  const rect = wrap.getBoundingClientRect();
  const needW = Math.max(1, Math.floor(rect.width * dpr));
  const needH = Math.max(1, Math.floor(rect.height * dpr));
  if (art.width < needW || art.height < needH) {
    const nw = Math.max(art.width, needW);
    const nh = Math.max(art.height, needH);
    const snap = document.createElement('canvas');
    snap.width = art.width;
    snap.height = art.height;
    snap.getContext('2d').drawImage(art, 0, 0);
    art.width = nw;
    art.height = nh;
    actx.imageSmoothingEnabled = false;
    actx.drawImage(snap, 0, 0);
  }
}

function clampPan() {
  const sw = canvas.width / zoom;
  const sh = canvas.height / zoom;
  panX = Math.min(Math.max(0, panX), Math.max(0, art.width - sw));
  panY = Math.min(Math.max(0, panY), Math.max(0, art.height - sh));
}

function render() {
  const Vw = canvas.width, Vh = canvas.height;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, Vw, Vh);
  ctx.drawImage(art, panX, panY, Vw / zoom, Vh / zoom, 0, 0, Vw, Vh);
  if (previewShape) drawPreview(previewShape);
  if (zoom >= 8) drawGrid();
}

function drawGrid() {
  const Vw = canvas.width, Vh = canvas.height;
  ctx.save();
  ctx.strokeStyle = 'rgba(128,128,128,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const ax0 = Math.floor(panX), ax1 = Math.ceil(panX + Vw / zoom);
  for (let ax = ax0; ax <= ax1; ax++) {
    const vx = Math.round((ax - panX) * zoom) + 0.5;
    ctx.moveTo(vx, 0); ctx.lineTo(vx, Vh);
  }
  const ay0 = Math.floor(panY), ay1 = Math.ceil(panY + Vh / zoom);
  for (let ay = ay0; ay <= ay1; ay++) {
    const vy = Math.round((ay - panY) * zoom) + 0.5;
    ctx.moveTo(0, vy); ctx.lineTo(Vw, vy);
  }
  ctx.stroke();
  ctx.restore();
}

function resizeView() {
  dpr = window.devicePixelRatio || 1;
  const rect = wrap.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ensureArtSize();
  clampPan();
  render();
}

const resizeObserver = new ResizeObserver(() => resizeView());
resizeObserver.observe(wrap);

// Map a pointer event to art-pixel coordinates
function viewToArt(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const vx = (clientX - rect.left) * (canvas.width / rect.width);
  const vy = (clientY - rect.top) * (canvas.height / rect.height);
  return { x: panX + vx / zoom, y: panY + vy / zoom };
}

// ---------- Tool state ----------
const TOOLS = ['pen', 'eraser', 'line', 'rect', 'ellipse', 'fill', 'eyedropper'];
const FLYOUT_TOOLS = ['line', 'rect', 'ellipse', 'fill', 'eyedropper'];
const TOOL_ICONS = {
  pen: '✏️', eraser: '🧽', line: '╱', rect: '▭', ellipse: '◯', fill: '🪣', eyedropper: '💧'
};

let tool = 'pen';
let prevTool = 'pen';      // tool to revert to after a one-shot eyedrop
let brushSize = 4;
let opacity = 1;
let color = '#f5f5f5';
let pixelMode = false;

const penTool = document.getElementById('penTool');
const eraserTool = document.getElementById('eraserTool');
const clearBtn = document.getElementById('clearBtn');
const moreBtn = document.getElementById('moreBtn');
const panel = document.getElementById('panel');
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');

const toolsBtn = document.getElementById('toolsBtn');
const toolsFlyout = document.getElementById('toolsFlyout');
const flyoutBtns = Array.from(document.querySelectorAll('.flyout-btn'));

const sizeSlider = document.getElementById('sizeSlider');
const sizeVal = document.getElementById('sizeVal');
const opacitySlider = document.getElementById('opacitySlider');
const opacityVal = document.getElementById('opacityVal');
const swatches = document.querySelectorAll('.swatch');
const customColor = document.getElementById('customColor');
const pixelToggle = document.getElementById('pixelToggle');

function updateCursorForTool() {
  if (tool === 'pen' || tool === 'eraser') {
    canvas.style.cursor = isSpaceDown ? 'grab' : 'none';
  } else {
    brushCursor.style.display = 'none';
    canvas.style.cursor = isSpaceDown ? 'grab' : 'crosshair';
  }
}

function setActiveTool(name) {
  tool = name;
  penTool.classList.toggle('active', name === 'pen');
  eraserTool.classList.toggle('active', name === 'eraser');
  const inFlyout = FLYOUT_TOOLS.includes(name);
  toolsBtn.classList.toggle('active', inFlyout);
  if (inFlyout) toolsBtn.textContent = TOOL_ICONS[name];
  flyoutBtns.forEach(b => b.classList.toggle('active', b.dataset.tool === name));
  updateCursorForTool();
}

penTool.addEventListener('click', () => setActiveTool('pen'));
eraserTool.addEventListener('click', () => setActiveTool('eraser'));

// Tools flyout (line/rect/ellipse/fill/eyedropper)
toolsBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  toolsFlyout.classList.toggle('hidden');
});
flyoutBtns.forEach(b => {
  b.addEventListener('click', () => {
    const name = b.dataset.tool;
    if (name === 'eyedropper') prevTool = (tool !== 'eyedropper') ? tool : 'pen';
    setActiveTool(name);
    toolsFlyout.classList.add('hidden');
  });
});
document.addEventListener('click', () => toolsFlyout.classList.add('hidden'));

clearBtn.addEventListener('click', () => {
  actx.clearRect(0, 0, art.width, art.height);
  render();
  pushHistory();
});

// ---------- Undo / Redo ----------
let history = [];
let histIndex = -1;
const HISTORY_LIMIT = 30;

function pushHistory() {
  if (histIndex < history.length - 1) history = history.slice(0, histIndex + 1);
  history.push(actx.getImageData(0, 0, art.width, art.height));
  if (history.length > HISTORY_LIMIT) history.shift();
  histIndex = history.length - 1;
  updateUndoRedoButtons();
}

function restoreCurrent() {
  const snap = history[histIndex];
  actx.clearRect(0, 0, art.width, art.height);
  if (snap) actx.putImageData(snap, 0, 0);
  render();
}

function undo() {
  if (histIndex <= 0) return;
  histIndex--; restoreCurrent(); updateUndoRedoButtons();
}
function redo() {
  if (histIndex >= history.length - 1) return;
  histIndex++; restoreCurrent(); updateUndoRedoButtons();
}
function updateUndoRedoButtons() {
  undoBtn.disabled = histIndex <= 0;
  redoBtn.disabled = histIndex >= history.length - 1;
}
undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);

// ---------- Panel / sliders / color ----------
moreBtn.addEventListener('click', () => panel.classList.toggle('hidden'));

sizeSlider.addEventListener('input', () => {
  brushSize = parseInt(sizeSlider.value, 10);
  sizeVal.textContent = brushSize;
});
opacitySlider.addEventListener('input', () => {
  opacity = parseInt(opacitySlider.value, 10) / 100;
  opacityVal.textContent = opacitySlider.value;
});

swatches.forEach(sw => {
  sw.addEventListener('click', () => {
    swatches.forEach(s => s.classList.remove('active'));
    sw.classList.add('active');
    color = sw.dataset.color;
    customColor.value = color;
  });
});
customColor.addEventListener('input', () => {
  color = customColor.value;
  swatches.forEach(s => s.classList.remove('active'));
});

pixelToggle.addEventListener('click', () => {
  pixelMode = !pixelMode;
  pixelToggle.classList.toggle('active', pixelMode);
  pixelToggle.textContent = pixelMode ? 'Pixel: ON' : 'Pixel: OFF';
});

// ---------- Background ----------
const bgSwatches = document.querySelectorAll('.bg-swatch');
function setBackground(bg) {
  wrap.classList.toggle('bg-white', bg === 'white');
  bgSwatches.forEach(b => b.classList.toggle('active', b.dataset.bg === bg));
  try { localStorage.setItem('tinydoodle.bg', bg); } catch (e) { /* ignore */ }
}
bgSwatches.forEach(b => b.addEventListener('click', () => setBackground(b.dataset.bg)));
let savedBg = 'dark';
try { savedBg = localStorage.getItem('tinydoodle.bg') || 'dark'; } catch (e) { /* ignore */ }
setBackground(savedBg);

// ---------- Color helpers ----------
function hexToRgba(hex, alpha) {
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: Math.round((alpha == null ? 1 : alpha) * 255)
  };
}

// ---------- Drawing primitives (operate in art-pixel space) ----------
function stampSquare(x, y) {
  const s = Math.max(1, brushSize);
  const ix = Math.floor(x - s / 2), iy = Math.floor(y - s / 2);
  if (tool === 'eraser') {
    actx.clearRect(ix, iy, s, s);
  } else {
    actx.globalAlpha = opacity;
    actx.fillStyle = color;
    actx.fillRect(ix, iy, s, s);
    actx.globalAlpha = 1;
  }
}
function stampLine(x0, y0, x1, y1) {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let i = 0; i <= steps; i++) {
    stampSquare(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps);
  }
}
function smoothDot(x, y) {
  actx.save();
  if (tool === 'eraser') {
    actx.globalCompositeOperation = 'destination-out';
    actx.globalAlpha = 1;
  } else {
    actx.globalCompositeOperation = 'source-over';
    actx.globalAlpha = opacity;
    actx.fillStyle = color;
  }
  actx.beginPath();
  actx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
  actx.fill();
  actx.restore();
}
function smoothStrokeTo(x0, y0, x1, y1) {
  actx.save();
  actx.lineCap = 'round';
  actx.lineJoin = 'round';
  actx.lineWidth = brushSize;
  if (tool === 'eraser') {
    actx.globalCompositeOperation = 'destination-out';
    actx.globalAlpha = 1;
  } else {
    actx.globalCompositeOperation = 'source-over';
    actx.globalAlpha = opacity;
    actx.strokeStyle = color;
  }
  actx.beginPath();
  actx.moveTo(x0, y0);
  actx.lineTo(x1, y1);
  actx.stroke();
  actx.restore();
}
function drawDot(x, y) { pixelMode ? stampSquare(x, y) : smoothDot(x, y); }
function drawSeg(x0, y0, x1, y1) { pixelMode ? stampLine(x0, y0, x1, y1) : smoothStrokeTo(x0, y0, x1, y1); }

// ---------- Shapes ----------
let previewShape = null;

function constrainShape(s) {
  const dx = s.x1 - s.x0, dy = s.y1 - s.y0;
  if (s.type === 'line') {
    const len = Math.hypot(dx, dy);
    const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    s.x1 = s.x0 + Math.cos(ang) * len;
    s.y1 = s.y0 + Math.sin(ang) * len;
  } else {
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    s.x1 = s.x0 + (dx < 0 ? -m : m);
    s.y1 = s.y0 + (dy < 0 ? -m : m);
  }
}

// Preview is drawn on the VIEW canvas (art coords -> view coords)
function drawPreview(s) {
  const toV = (ax, ay) => [(ax - panX) * zoom, (ay - panY) * zoom];
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = opacity;
  ctx.lineWidth = Math.max(1, brushSize) * zoom;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (s.type === 'line') {
    const [a, b] = toV(s.x0, s.y0), [c, d] = toV(s.x1, s.y1);
    ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke();
  } else if (s.type === 'rect') {
    const [a, b] = toV(Math.min(s.x0, s.x1), Math.min(s.y0, s.y1));
    ctx.strokeRect(a, b, Math.abs(s.x1 - s.x0) * zoom, Math.abs(s.y1 - s.y0) * zoom);
  } else if (s.type === 'ellipse') {
    const [cx, cy] = toV((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2);
    ctx.ellipse(cx, cy, Math.abs(s.x1 - s.x0) / 2 * zoom, Math.abs(s.y1 - s.y0) / 2 * zoom, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// Commit a shape into the art buffer (art coords)
function commitShape(s) {
  actx.save();
  actx.strokeStyle = color;
  actx.globalAlpha = opacity;
  actx.lineWidth = Math.max(1, brushSize);
  actx.lineCap = 'round';
  actx.lineJoin = 'round';
  actx.beginPath();
  if (s.type === 'line') {
    actx.moveTo(s.x0, s.y0); actx.lineTo(s.x1, s.y1); actx.stroke();
  } else if (s.type === 'rect') {
    actx.strokeRect(Math.min(s.x0, s.x1), Math.min(s.y0, s.y1), Math.abs(s.x1 - s.x0), Math.abs(s.y1 - s.y0));
  } else if (s.type === 'ellipse') {
    actx.ellipse((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, Math.abs(s.x1 - s.x0) / 2, Math.abs(s.y1 - s.y0) / 2, 0, 0, Math.PI * 2);
    actx.stroke();
  }
  actx.restore();
}

// ---------- Fill bucket ----------
function floodFill(px, py) {
  const W = art.width, H = art.height;
  const x0 = Math.floor(px), y0 = Math.floor(py);
  if (x0 < 0 || y0 < 0 || x0 >= W || y0 >= H) return false;
  const img = actx.getImageData(0, 0, W, H);
  const d = img.data;
  const idx = (x, y) => (y * W + x) * 4;
  const ti = idx(x0, y0);
  const tr = d[ti], tg = d[ti + 1], tb = d[ti + 2], ta = d[ti + 3];
  const fc = hexToRgba(color, opacity);
  if (tr === fc.r && tg === fc.g && tb === fc.b && ta === fc.a) return false;
  const match = (i) => d[i] === tr && d[i + 1] === tg && d[i + 2] === tb && d[i + 3] === ta;
  const stack = [[x0, y0]];
  while (stack.length) {
    const [x, y] = stack.pop();
    if (!match(idx(x, y))) continue;
    let xl = x; while (xl > 0 && match(idx(xl - 1, y))) xl--;
    let xr = x; while (xr < W - 1 && match(idx(xr + 1, y))) xr++;
    for (let xx = xl; xx <= xr; xx++) {
      const j = idx(xx, y);
      d[j] = fc.r; d[j + 1] = fc.g; d[j + 2] = fc.b; d[j + 3] = fc.a;
      if (y > 0 && match(idx(xx, y - 1))) stack.push([xx, y - 1]);
      if (y < H - 1 && match(idx(xx, y + 1))) stack.push([xx, y + 1]);
    }
  }
  actx.putImageData(img, 0, 0);
  return true;
}

// ---------- Eyedropper ----------
function eyedrop(px, py) {
  const x = Math.floor(px), y = Math.floor(py);
  if (x < 0 || y < 0 || x >= art.width || y >= art.height) { setActiveTool(prevTool); return; }
  const d = actx.getImageData(x, y, 1, 1).data;
  if (d[3] !== 0) {
    const hex = '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('');
    color = hex;
    customColor.value = hex;
    swatches.forEach(s => s.classList.toggle('active', (s.dataset.color || '').toLowerCase() === hex));
  }
  setActiveTool(prevTool);
}

// ---------- Brush-size cursor overlay ----------
function updateBrushCursor(clientX, clientY) {
  if (tool !== 'pen' && tool !== 'eraser' || isSpaceDown) {
    brushCursor.style.display = 'none';
    return;
  }
  const wrapRect = wrap.getBoundingClientRect();
  const dCss = Math.max(2, brushSize * zoom / dpr);
  brushCursor.style.display = 'block';
  brushCursor.style.width = dCss + 'px';
  brushCursor.style.height = dCss + 'px';
  brushCursor.style.left = (clientX - wrapRect.left) + 'px';
  brushCursor.style.top = (clientY - wrapRect.top) + 'px';
}

// ---------- Zoom / pan ----------
let zoomFadeTimer = null;
function showZoomIndicator() {
  zoomIndicator.textContent = Math.round(zoom * 100) + '%';
  zoomIndicator.classList.add('show');
  clearTimeout(zoomFadeTimer);
  zoomFadeTimer = setTimeout(() => zoomIndicator.classList.remove('show'), 900);
}

function setZoom(newZoom, clientX, clientY) {
  newZoom = Math.max(1, Math.min(32, newZoom));
  if (clientX != null) {
    const before = viewToArt(clientX, clientY);
    zoom = newZoom;
    const rect = canvas.getBoundingClientRect();
    const vx = (clientX - rect.left) * (canvas.width / rect.width);
    const vy = (clientY - rect.top) * (canvas.height / rect.height);
    panX = before.x - vx / zoom;
    panY = before.y - vy / zoom;
  } else {
    zoom = newZoom;
  }
  clampPan();
  render();
  showZoomIndicator();
}

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  setZoom(zoom * (e.deltaY < 0 ? 1.25 : 0.8), e.clientX, e.clientY);
}, { passive: false });

// Panel zoom controls
document.getElementById('zoomIn').addEventListener('click', () => setZoom(zoom * 1.25));
document.getElementById('zoomOut').addEventListener('click', () => setZoom(zoom * 0.8));
document.getElementById('zoomReset').addEventListener('click', () => setZoom(1));

// ---------- Pointer handling ----------
let action = null;        // 'draw' | 'shape' | 'pan'
let lastX = 0, lastY = 0;
let isSpaceDown = false;
let panStart = null;

canvas.addEventListener('pointerdown', (e) => {
  const wantPan = isSpaceDown || e.button === 1;
  if (wantPan) {
    action = 'pan';
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
    panStart = { cx: e.clientX, cy: e.clientY, panX, panY };
    return;
  }
  if (e.button !== 0) return;

  const p = viewToArt(e.clientX, e.clientY);
  if (tool === 'eyedropper') { eyedrop(p.x, p.y); return; }
  if (tool === 'fill') { if (floodFill(p.x, p.y)) { render(); pushHistory(); } return; }

  if (tool === 'line' || tool === 'rect' || tool === 'ellipse') {
    action = 'shape';
    canvas.setPointerCapture(e.pointerId);
    previewShape = { type: tool, x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    render();
    return;
  }

  // pen / eraser
  action = 'draw';
  canvas.setPointerCapture(e.pointerId);
  lastX = p.x; lastY = p.y;
  drawDot(p.x, p.y);
  render();
});

canvas.addEventListener('pointermove', (e) => {
  updateBrushCursor(e.clientX, e.clientY);

  if (action === 'pan') {
    panX = panStart.panX - (e.clientX - panStart.cx) * dpr / zoom;
    panY = panStart.panY - (e.clientY - panStart.cy) * dpr / zoom;
    clampPan();
    render();
    return;
  }
  if (action === 'draw') {
    const p = viewToArt(e.clientX, e.clientY);
    drawSeg(lastX, lastY, p.x, p.y);
    lastX = p.x; lastY = p.y;
    render();
    return;
  }
  if (action === 'shape') {
    const p = viewToArt(e.clientX, e.clientY);
    previewShape.x1 = p.x; previewShape.y1 = p.y;
    if (e.shiftKey) constrainShape(previewShape);
    render();
  }
});

function endPointer() {
  if (action === 'draw') { action = null; pushHistory(); }
  else if (action === 'shape') { commitShape(previewShape); previewShape = null; action = null; render(); pushHistory(); }
  else if (action === 'pan') { action = null; updateCursorForTool(); }
}
window.addEventListener('pointerup', endPointer);
window.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => { if (action !== 'draw' && action !== 'shape' && action !== 'pan') brushCursor.style.display = 'none'; });

// ---------- Keyboard ----------
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    if (!isSpaceDown) { isSpaceDown = true; updateCursorForTool(); brushCursor.style.display = 'none'; }
    e.preventDefault();
    return;
  }
  if (e.ctrlKey || e.metaKey) {
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    return;
  }
  if (e.key === '+' || e.key === '=') { setZoom(zoom * 1.25); }
  else if (e.key === '-' || e.key === '_') { setZoom(zoom * 0.8); }
  else if (e.key === '0') { setZoom(1); }
  // Tool shortcuts
  else if (e.key === 'p') setActiveTool('pen');
  else if (e.key === 'e') setActiveTool('eraser');
  else if (e.key === 'l') setActiveTool('line');
  else if (e.key === 'r') setActiveTool('rect');
  else if (e.key === 'o') setActiveTool('ellipse');
  else if (e.key === 'g') setActiveTool('fill');
  else if (e.key === 'i') { prevTool = (tool !== 'eyedropper') ? tool : 'pen'; setActiveTool('eyedropper'); }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') { isSpaceDown = false; updateCursorForTool(); }
});

// ---------- Export ----------
const exportScale = document.getElementById('exportScale');
const transparentChk = document.getElementById('transparentBg');
const exportStatus = document.getElementById('exportStatus');

function buildExportDataURL() {
  const scale = parseInt(exportScale.value, 10) || 1;
  const transparent = transparentChk.checked;
  const W = art.width * scale, H = art.height * scale;
  const tmp = document.createElement('canvas');
  tmp.width = W; tmp.height = H;
  const tctx = tmp.getContext('2d');
  tctx.imageSmoothingEnabled = false;
  if (!transparent) {
    tctx.fillStyle = wrap.classList.contains('bg-white') ? '#ffffff' : '#1e1e1e';
    tctx.fillRect(0, 0, W, H);
  }
  tctx.drawImage(art, 0, 0, art.width, art.height, 0, 0, W, H);
  return tmp.toDataURL('image/png');
}

function flashStatus(msg) {
  exportStatus.textContent = msg;
  clearTimeout(flashStatus._t);
  flashStatus._t = setTimeout(() => { exportStatus.textContent = ''; }, 2500);
}

document.getElementById('exportSave').addEventListener('click', async () => {
  try {
    const res = await window.electronAPI.savePng(buildExportDataURL());
    flashStatus(res && res.ok ? 'Saved ✓' : (res && res.canceled ? '' : 'Save failed'));
  } catch (err) { flashStatus('Save failed'); }
});
document.getElementById('exportCopy').addEventListener('click', async () => {
  try {
    const res = await window.electronAPI.copyImage(buildExportDataURL());
    flashStatus(res && res.ok ? 'Copied ✓' : 'Copy failed');
  } catch (err) { flashStatus('Copy failed'); }
});

// ---------- Init ----------
resizeView();
setActiveTool('pen');
pushHistory(); // baseline blank state
