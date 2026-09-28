/* =========================================================
   FreeOnlineConverter — client-side file converter
   ========================================================= */

const { jsPDF } = window.jspdf;

// Format map: category -> { from: [...], to: [...], convert: fn }
const converters = {
  image: {
    from: ['jpg','jpeg','png','webp','bmp','gif'],
    to:   ['png','jpg','webp','bmp'],
    convert: convertImage
  },
  document: {
    from: ['docx','txt','md','html'],
    to:   ['pdf','txt','html'],
    convert: convertDocument
  },
  data: {
    from: ['csv','json','xlsx'],
    to:   ['csv','json','xlsx'],
    convert: convertData
  },
  media: {
    from: ['mp4','webm','mov','mp3','wav','ogg','avi'],
    to:   ['mp4','webm','mp3','wav','ogg','gif'],
    convert: convertMedia   // uses ffmpeg.wasm (loaded on demand)
  }
};

let currentCategory = 'image';
let currentFile = null;

// ---------- UI wiring ----------
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    currentCategory = btn.dataset.cat;
    updateTargetFormats();
    resetFile();
  });
});

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const targetFormat = document.getElementById('targetFormat');
const convertBtn = document.getElementById('convertBtn');
const statusEl = document.getElementById('status');
const previewEl = document.getElementById('preview');

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag');
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', e => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
});
convertBtn.addEventListener('click', runConversion);

function updateTargetFormats() {
  const cat = converters[currentCategory];
  targetFormat.innerHTML = cat.to.map(f => `<option value="${f}">${f.toUpperCase()}</option>`).join('');
}
updateTargetFormats();

function handleFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const cat = converters[currentCategory];
  if (!cat.from.includes(ext)) {
    showStatus(`Unsupported format "${ext}" for ${currentCategory} converter.`, 'error');
    return;
  }
  currentFile = file;
  convertBtn.disabled = false;
  showStatus(`Loaded: ${file.name} (${(file.size/1024).toFixed(1)} KB)`, 'info');
  previewEl.innerHTML = '';
}

function resetFile() {
  currentFile = null;
  convertBtn.disabled = true;
  fileInput.value = '';
  previewEl.innerHTML = '';
  statusEl.classList.remove('show');
}

function showStatus(msg, type='info') {
  statusEl.textContent = msg;
  statusEl.className = `status show ${type}`;
}

// ---------- Conversion dispatcher ----------
async function runConversion() {
  if (!currentFile) return;
  convertBtn.disabled = true;
  showStatus('Converting…', 'info');
  try {
    const target = targetFormat.value;
    const result = await converters[currentCategory].convert(currentFile, target);
    downloadBlob(result.blob, result.name);
    showStatus(`✅ Done! Downloaded ${result.name}`, 'success');
    if (result.preview) {
      previewEl.innerHTML = result.preview;
    }
  } catch (err) {
    console.error(err);
    showStatus('❌ Error: ' + err.message, 'error');
  } finally {
    convertBtn.disabled = false;
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// =========================================================
// IMAGE CONVERTER (pure canvas)
// =========================================================
async function convertImage(file, target) {
  const img = await loadImage(file);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (target === 'jpg' || target === 'bmp') {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0);

  const mime = {
    png: 'image/png',
    jpg: 'image/jpeg',
    webp: 'image/webp',
    bmp: 'image/bmp'
  }[target];

  const blob = await new Promise(res => canvas.toBlob(res, mime, 0.92));
  const name = file.name.replace(/\.[^.]+$/, '') + '.' + target;
  return { blob, name, preview: `<img src="${URL.createObjectURL(blob)}" alt="preview">` };
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// =========================================================
// DOCUMENT CONVERTER
// =========================================================
async function convertDocument(file, target) {
  const ext = file.name.split('.').pop().toLowerCase();
  const baseName = file.name.replace(/\.[^.]+$/, '');

  // Read text content
  let text = '';
  let html = '';

  if (ext === 'txt' || ext === 'md' || ext === 'html') {
    text = await file.text();
    if (ext === 'md') html = marked.parse(text);
    else if (ext === 'html') html = text;
    else html = `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(text)}</pre>`;
  } else if (ext === 'docx') {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer });
    html = result.value;
    text = result.value.replace(/<[^>]+>/g, ' ');
  }

  if (target === 'txt') {
    const blob = new Blob([text], { type: 'text/plain' });
    return { blob, name: baseName + '.txt' };
  }
  if (target === 'html') {
    const full = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${baseName}</title></head><body>${html}</body></html>`;
    const blob = new Blob([full], { type: 'text/html' });
    return { blob, name: baseName + '.html' };
  }
  if (target === 'pdf') {
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
    const container = document.createElement('div');
    container.style.cssText = 'position:absolute;left:-9999px;top:0;width:595px;padding:40px;background:white;font-family:Georgia,serif;font-size:12pt;line-height:1.5;color:#000;';
    container.innerHTML = html;
    document.body.appendChild(container);
    const canvas = await html2canvas(container, { scale: 2, backgroundColor: '#ffffff' });
    document.body.removeChild(container);
    const imgData = canvas.toDataURL('image/jpeg', 0.95);
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth - 80;
    const imgHeight = canvas.height * imgWidth / canvas.width;
    let heightLeft = imgHeight;
    let position = 40;
    pdf.addImage(imgData, 'JPEG', 40, position, imgWidth, imgHeight);
    heightLeft -= (pageHeight - 80);
    while (heightLeft > 0) {
      pdf.addPage();
      position = heightLeft - imgHeight + 40;
      pdf.addImage(imgData, 'JPEG', 40, position, imgWidth, imgHeight);
      heightLeft -= (pageHeight - 80);
    }
    const blob = pdf.output('blob');
    return { blob, name: baseName + '.pdf' };
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// =========================================================
// DATA CONVERTER (CSV / JSON / XLSX)
// =========================================================
async function convertData(file, target) {
  const ext = file.name.split('.').pop().toLowerCase();
  const baseName = file.name.replace(/\.[^.]+$/, '');

  // Parse to rows
  let rows = [];
  if (ext === 'csv') {
    const text = await file.text();
    rows = parseCSV(text);
  } else if (ext === 'json') {
    const data = JSON.parse(await file.text());
    rows = Array.isArray(data) ? data : [data];
  } else if (ext === 'xlsx') {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf);
    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  }

  let blob, mime;
  if (target === 'csv') {
    const csv = rows.map(r => Array.isArray(r) ? r.map(csvEscape).join(',') : Object.values(r).map(csvEscape).join(',')).join('\n');
    blob = new Blob([csv], { type: 'text/csv' });
  } else if (target === 'json') {
    blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
  } else if (target === 'xlsx') {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const ab = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    blob = new Blob([ab], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  return { blob, name: baseName + '.' + target };
}

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i+1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') {}
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
}

// =========================================================
// VIDEO/AUDIO CONVERTER (ffmpeg.wasm — lazy loaded)
// =========================================================
let ffmpegCore = null;
let ffmpegLoading = null;

async function loadFFmpeg() {
  if (ffmpegCore) return ffmpegCore;
  if (ffmpegLoading) return ffmpegLoading;
  ffmpegLoading = (async () => {
    showStatus('Loading video engine (first time ~25 MB)…', 'info');
    const { createFFmpeg, fetchFile } = FFmpeg;
    const ffmpeg = createFFmpeg({
      log: false,
      corePath: 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js'
    });
    await ffmpeg.load();
    ffmpegCore = { ffmpeg, fetchFile };
    return ffmpegCore;
  })();
  return ffmpegLoading;
}

async function convertMedia(file, target) {
  // Need ffmpeg.wasm script
  if (!window.FFmpeg) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://unpkg.com/@ffmpeg/ffmpeg@0.11.6/dist/ffmpeg.min.js';
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  const { ffmpeg, fetchFile } = await loadFFmpeg();
  const ext = file.name.split('.').pop().toLowerCase();
  const inputName = 'input.' + ext;
  const outputName = 'output.' + target;
  ffmpeg.FS('writeFile', inputName, await fetchFile(file));
  showStatus('Processing… this may take a while for large files.', 'info');
  await ffmpeg.run('-i', inputName, outputName);
  const data = ffmpeg.FS('readFile', outputName);
  const mimeMap = {
    mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg',
    wav: 'audio/wav', ogg: 'audio/ogg', gif: 'image/gif'
  };
  const blob = new Blob([data.buffer], { type: mimeMap[target] || 'application/octet-stream' });
  const name = file.name.replace(/\.[^.]+$/, '') + '.' + target;
  let preview = '';
  if (target.startsWith('mp4') || target === 'webm') preview = `<video controls src="${URL.createObjectURL(blob)}"></video>`;
  if (target.startsWith('mp3') || target === 'wav' || target === 'ogg') preview = `<audio controls src="${URL.createObjectURL(blob)}"></audio>`;
  return { blob, name, preview };
}
