let currentTool = null;
let uploadedFiles = [];

// Tool Configuration Map
const toolConfig = {
  'merge': {
    title: 'Merge PDF', desc: 'Combine PDFs in the order you want.',
    icon: 'fa-object-group', btnText: 'Merge PDF',
    endpoint: '/api/merge', multiple: true, accept: '.pdf'
  },
  'split': {
    title: 'Split PDF', desc: 'Extract pages from your PDF.',
    icon: 'fa-cut', btnText: 'Split PDF',
    endpoint: '/api/split', multiple: false, accept: '.pdf',
    options: `<label>Pages to extract (e.g., 1,3,5-10):</label><input type="text" id="split-pages" placeholder="1,3,5-10" value="1">`
  },
  'rotate': {
    title: 'Rotate PDF', desc: 'Rotate your PDF files easily.',
    icon: 'fa-sync-alt', btnText: 'Rotate PDF',
    endpoint: '/api/rotate', multiple: false, accept: '.pdf',
    options: `<label>Rotation Angle:</label>
              <select id="rotate-angle" style="width:100%;padding:10px;margin-top:10px;border:1px solid #dcdde1;border-radius:4px;">
                <option value="90">90° Clockwise</option>
                <option value="180">180°</option>
                <option value="270">90° Counter-Clockwise</option>
              </select>`
  },
  'image-to-pdf': {
    title: 'JPG to PDF', desc: 'Convert your images to PDF.',
    icon: 'fa-file-image', btnText: 'Convert to PDF',
    endpoint: '/api/image-to-pdf', multiple: true, accept: '.jpg,.jpeg,.png'
  },
  'convert': {
    // Dynamic handler for CloudConvert tools
    setup: (source, target) => ({
      title: `${source.toUpperCase()} to ${target.toUpperCase()}`,
      desc: `Convert your ${source.toUpperCase()} files to ${target.toUpperCase()} format.`,
      icon: source === 'pdf' ? 'fa-file-pdf' : `fa-file-${source}`,
      btnText: `Convert to ${target.toUpperCase()}`,
      endpoint: '/api/convert', multiple: false, accept: `.${source}`,
      targetFormat: target
    })
  }
};

const homeScreen = document.getElementById('home-screen');
const workspaceScreen = document.getElementById('workspace-screen');
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const fileList = document.getElementById('file-list');
const optionsPanel = document.getElementById('options-panel');
const optionsContent = document.getElementById('options-content');
const actionBar = document.getElementById('action-bar');
const processBtn = document.getElementById('process-btn');
const processBtnText = document.getElementById('process-btn-text');
const progressContainer = document.getElementById('progress-container');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');

function showHome() {
  homeScreen.classList.remove('hidden');
  workspaceScreen.classList.add('hidden');
  resetWorkspace();
}

function selectTool(toolKey, source, target) {
  if (toolKey === 'convert') {
    currentTool = toolConfig.convert.setup(source, target);
  } else {
    currentTool = toolConfig[toolKey];
  }

  document.getElementById('ws-title').textContent = currentTool.title;
  document.getElementById('ws-desc').textContent = currentTool.desc;
  document.getElementById('ws-icon').innerHTML = `<i class="fas ${currentTool.icon}"></i>`;
  processBtnText.textContent = currentTool.btnText;
  fileInput.accept = currentTool.accept;
  fileInput.multiple = currentTool.multiple;

  if (currentTool.options) {
    optionsContent.innerHTML = currentTool.options;
    optionsPanel.classList.remove('hidden');
  } else {
    optionsPanel.classList.add('hidden');
  }

  homeScreen.classList.add('hidden');
  workspaceScreen.classList.remove('hidden');
  window.scrollTo(0, 0);
}

function resetWorkspace() {
  uploadedFiles = [];
  fileList.innerHTML = '';
  actionBar.classList.add('hidden');
  progressContainer.classList.add('hidden');
  fileInput.value = '';
}

// Drag & Drop Logic
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  handleFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', (e) => handleFiles(e.target.files));
document.getElementById('select-files-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  fileInput.click();
});

function handleFiles(files) {
  if (!currentTool.multiple && files.length > 1) {
    alert(`Please select only one file for this tool.`);
    return;
  }
  for (let file of files) {
    uploadedFiles.push(file);
    renderFileList();
  }
  actionBar.classList.remove('hidden');
}

function renderFileList() {
  fileList.innerHTML = uploadedFiles.map((file, index) => `
    <div class="file-item">
      <div class="file-item-info">
        <i class="fas fa-file"></i>
        <div>
          <span>${file.name}</span>
          <small>${(file.size / 1024).toFixed(1)} KB</small>
        </div>
      </div>
      <button onclick="removeFile(${index})"><i class="fas fa-trash"></i></button>
    </div>
  `).join('');
}

function removeFile(index) {
  uploadedFiles.splice(index, 1);
  renderFileList();
  if (uploadedFiles.length === 0) actionBar.classList.add('hidden');
}

// Process Conversion
processBtn.addEventListener('click', async () => {
  if (uploadedFiles.length === 0) return;

  actionBar.classList.add('hidden');
  progressContainer.classList.remove('hidden');
  progressFill.style.width = '20%';
  progressText.textContent = 'Uploading file...';

  const formData = new FormData();
  if (currentTool.multiple) {
    uploadedFiles.forEach(f => formData.append('files', f));
  } else {
    formData.append('file', uploadedFiles[0]);
  }

  // Append tool-specific options
  if (currentTool.endpoint === '/api/split') {
    formData.append('pages', document.getElementById('split-pages').value || '1');
  }
  if (currentTool.endpoint === '/api/rotate') {
    formData.append('angle', document.getElementById('rotate-angle').value || '90');
  }
  if (currentTool.endpoint === '/api/convert') {
    formData.append('targetFormat', currentTool.targetFormat);
  }

  try {
    progressFill.style.width = '50%';
    progressText.textContent = 'Processing... (This may take a few seconds)';

    const response = await fetch(currentTool.endpoint, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.error || 'Processing failed');
    }

    progressFill.style.width = '90%';
    progressText.textContent = 'Preparing download...';

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    
    // Determine output filename
    let ext = 'pdf';
    if (currentTool.endpoint === '/api/convert') ext = currentTool.targetFormat;
    a.download = `converted-file.${ext}`;
    
    document.body.appendChild(a);
    a.click();
    a.remove();

    progressFill.style.width = '100%';
    progressText.textContent = '✅ Done! File downloaded.';
    
    setTimeout(() => {
      resetWorkspace();
      showHome();
    }, 2500);

  } catch (err) {
    progressText.textContent = '❌ Error: ' + err.message;
    progressFill.style.width = '0%';
    setTimeout(() => {
      progressContainer.classList.add('hidden');
      actionBar.classList.remove('hidden');
    }, 4000);
  }
});
