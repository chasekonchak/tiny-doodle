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

// ---------- Canvas setup ----------
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const wrap = document.getElementById('canvasWrap');

// Offscreen buffer holds the actual drawing at a fixed internal resolution
// so resizing the window doesn't distort or clear existing strokes.
const buffer = document.createElement('canvas');
const bctx = buffer.getContext('2d');

function resizeCanvasToWrap() {
  const rect = wrap.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));

  // Grow the buffer if needed, preserving existing content
  if (buffer.width < w || buffer.height < h) {
    const newW = Math.max(buffer.width, w);
    const newH = Math.max(buffer.height, h);
    const snapshot = document.createElement('canvas');
    snapshot.width = buffer.width;
    snapshot.height = buffer.height;
    snapshot.getContext('2d').drawImage(buffer, 0, 0);

    buffer.width = newW;
    buffer.height = newH;
    bctx.drawImage(snapshot, 0, 0);
  }

  canvas.width = w;
  canvas.height = h;
  redrawVisible();
}

function redrawVisible() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(buffer, 0, 0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
}

const resizeObserver = new ResizeObserver(() => resizeCanvasToWrap());
resizeObserver.observe(wrap);

// ---------- Tool state ----------
let tool = 'pen';            // 'pen' | 'eraser'
let brushSize = 4;
let opacity = 1;
let color = '#f5f5f5';
let drawing = false;
let lastX = 0, lastY = 0;

const penTool = document.getElementById('penTool');
const eraserTool = document.getElementById('eraserTool');
const clearBtn = document.getElementById('clearBtn');
const moreBtn = document.getElementById('moreBtn');
const panel = document.getElementById('panel');
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');

const sizeSlider = document.getElementById('sizeSlider');
const sizeVal = document.getElementById('sizeVal');
const opacitySlider = document.getElementById('opacitySlider');
const opacityVal = document.getElementById('opacityVal');
const swatches = document.querySelectorAll('.swatch');
const customColor = document.getElementById('customColor');

function setActiveTool(name) {
  tool = name;
  penTool.classList.toggle('active', name === 'pen');
  eraserTool.classList.toggle('active', name === 'eraser');
}

penTool.addEventListener('click', () => setActiveTool('pen'));
eraserTool.addEventListener('click', () => setActiveTool('eraser'));

clearBtn.addEventListener('click', () => {
  bctx.clearRect(0, 0, buffer.width, buffer.height);
  redrawVisible();
  pushHistory();
});

// ---------- Undo / Redo ----------
// History is a list of full-buffer snapshots; histIndex points at the
// state currently shown. New actions truncate any "redo" states ahead.
let history = [];
let histIndex = -1;
const HISTORY_LIMIT = 40;

function pushHistory() {
  if (histIndex < history.length - 1) {
    history = history.slice(0, histIndex + 1); // drop redo branch
  }
  history.push(bctx.getImageData(0, 0, buffer.width, buffer.height));
  if (history.length > HISTORY_LIMIT) history.shift();
  histIndex = history.length - 1;
  updateUndoRedoButtons();
}

function restoreCurrent() {
  const snap = history[histIndex];
  bctx.clearRect(0, 0, buffer.width, buffer.height);
  if (snap) bctx.putImageData(snap, 0, 0);
  redrawVisible();
}

function undo() {
  if (histIndex <= 0) return;
  histIndex--;
  restoreCurrent();
  updateUndoRedoButtons();
}

function redo() {
  if (histIndex >= history.length - 1) return;
  histIndex++;
  restoreCurrent();
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  undoBtn.disabled = histIndex <= 0;
  redoBtn.disabled = histIndex >= history.length - 1;
}

undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);

window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
});

moreBtn.addEventListener('click', () => {
  panel.classList.toggle('hidden');
});

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

// ---------- Background ----------
const bgSwatches = document.querySelectorAll('.bg-swatch');

function setBackground(bg) {
  wrap.classList.toggle('bg-white', bg === 'white');
  bgSwatches.forEach(b => b.classList.toggle('active', b.dataset.bg === bg));
  try { localStorage.setItem('tinydoodle.bg', bg); } catch (e) { /* ignore */ }
}

bgSwatches.forEach(b => {
  b.addEventListener('click', () => setBackground(b.dataset.bg));
});

// Restore the saved background choice (defaults to dark)
let savedBg = 'dark';
try { savedBg = localStorage.getItem('tinydoodle.bg') || 'dark'; } catch (e) { /* ignore */ }
setBackground(savedBg);

// ---------- Drawing logic ----------
// Maps a pointer event to canvas-pixel coordinates (handles any CSS/device scaling)
function getCanvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY
  };
}

function strokeTo(x0, y0, x1, y1) {
  bctx.save();
  bctx.lineCap = 'round';
  bctx.lineJoin = 'round';
  bctx.lineWidth = brushSize;

  if (tool === 'eraser') {
    bctx.globalCompositeOperation = 'destination-out';
    bctx.globalAlpha = 1; // eraser strength stays full regardless of opacity slider
  } else {
    bctx.globalCompositeOperation = 'source-over';
    bctx.globalAlpha = opacity;
    bctx.strokeStyle = color;
  }

  bctx.beginPath();
  bctx.moveTo(x0, y0);
  bctx.lineTo(x1, y1);
  bctx.stroke();
  bctx.restore();

  redrawVisible();
}

function dot(x, y) {
  bctx.save();
  bctx.lineCap = 'round';
  if (tool === 'eraser') {
    bctx.globalCompositeOperation = 'destination-out';
    bctx.globalAlpha = 1;
  } else {
    bctx.globalCompositeOperation = 'source-over';
    bctx.globalAlpha = opacity;
    bctx.fillStyle = color;
  }
  bctx.beginPath();
  bctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
  if (tool === 'eraser') {
    bctx.fill();
  } else {
    bctx.fill();
  }
  bctx.restore();
  redrawVisible();
}

canvas.addEventListener('pointerdown', (e) => {
  drawing = true;
  canvas.setPointerCapture(e.pointerId);
  const pos = getCanvasPos(e);
  lastX = pos.x;
  lastY = pos.y;
  dot(pos.x, pos.y);
});

canvas.addEventListener('pointermove', (e) => {
  if (!drawing) return;
  const pos = getCanvasPos(e);
  strokeTo(lastX, lastY, pos.x, pos.y);
  lastX = pos.x;
  lastY = pos.y;
});

window.addEventListener('pointerup', () => {
  if (drawing) { drawing = false; pushHistory(); }
});
window.addEventListener('pointercancel', () => {
  if (drawing) { drawing = false; pushHistory(); }
});

// ---------- Init ----------
resizeCanvasToWrap();
pushHistory(); // record the initial blank canvas as the baseline state
