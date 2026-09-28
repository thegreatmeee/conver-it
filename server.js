require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { PDFDocument, degrees } = require('pdf-lib');
const sharp = require('sharp');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static('public'));
app.use(express.json());

// Ensure uploads folder exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${uuidv4()}-${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB limit

const cleanup = (files) => {
  if (!files) return;
  const fileList = Array.isArray(files) ? files : [files];
  fileList.forEach(f => {
    if (f && f.path && fs.existsSync(f.path)) fs.unlinkSync(f.path);
  });
};

// ==========================================
// 1. NATIVE PDF TOOLS (Free, Unlimited)
// ==========================================

// Merge PDF
app.post('/api/merge', upload.array('files', 20), async (req, res) => {
  try {
    const mergedPdf = await PDFDocument.create();
    for (const file of req.files) {
      const pdfBytes = fs.readFileSync(file.path);
      const pdf = await PDFDocument.load(pdfBytes);
      const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
      copiedPages.forEach(page => mergedPdf.addPage(page));
    }
    const pdfBytes = await mergedPdf.save();
    cleanup(req.files);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename=merged.pdf' });
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    cleanup(req.files);
    res.status(500).json({ error: err.message });
  }
});

// Split PDF (Extract specific pages)
app.post('/api/split', upload.single('file'), async (req, res) => {
  try {
    const pdfBytes = fs.readFileSync(req.file.path);
    const pdf = await PDFDocument.load(pdfBytes);
    const { pages } = req.body; // e.g., "1,3,5-10"
    
    const indices = new Set();
    pages.split(',').forEach(part => {
      part = part.trim();
      if (part.includes('-')) {
        const [start, end] = part.split('-').map(Number);
        for (let i = start; i <= Math.min(end, pdf.getPageCount()); i++) indices.add(i - 1);
      } else {
        const num = Number(part);
        if (num >= 1 && num <= pdf.getPageCount()) indices.add(num - 1);
      }
    });

    const newPdf = await PDFDocument.create();
    const copiedPages = await newPdf.copyPages(pdf, Array.from(indices).sort((a, b) => a - b));
    copiedPages.forEach(page => newPdf.addPage(page));
    
    const resultBytes = await newPdf.save();
    cleanup(req.file);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename=split.pdf' });
    res.send(Buffer.from(resultBytes));
  } catch (err) {
    cleanup(req.file);
    res.status(500).json({ error: err.message });
  }
});

// Rotate PDF
app.post('/api/rotate', upload.single('file'), async (req, res) => {
  try {
    const { angle } = req.body;
    const pdfBytes = fs.readFileSync(req.file.path);
    const pdf = await PDFDocument.load(pdfBytes);
    const pages = pdf.getPages();
    pages.forEach(page => page.setRotation(degrees(Number(angle))));
    
    const resultBytes = await pdf.save();
    cleanup(req.file);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename=rotated.pdf' });
    res.send(Buffer.from(resultBytes));
  } catch (err) {
    cleanup(req.file);
    res.status(500).json({ error: err.message });
  }
});

// JPG/PNG to PDF
app.post('/api/image-to-pdf', upload.array('files', 50), async (req, res) => {
  try {
    const pdfDoc = await PDFDocument.create();
    for (const file of req.files) {
      const imgBytes = fs.readFileSync(file.path);
      const ext = path.extname(file.originalname).toLowerCase();
      let image;
      if (ext === '.png') image = await pdfDoc.embedPng(imgBytes);
      else image = await pdfDoc.embedJpg(imgBytes);
      
      const page = pdfDoc.addPage([image.width, image.height]);
      page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    }
    const pdfBytes = await pdfDoc.save();
    cleanup(req.files);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename=images.pdf' });
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    cleanup(req.files);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 2. UNIVERSAL CONVERTER (via CloudConvert API)
// Handles: docx, xlsx, pptx, pdf-to-docx, etc.
// ==========================================
app.post('/api/convert', upload.single('file'), async (req, res) => {
  try {
    const { targetFormat } = req.body;
    const file = req.file;
    const apiKey = process.env.CLOUDCONVERT_API_KEY;

    if (!apiKey || apiKey === 'your_sandbox_api_key_here') {
      cleanup(file);
      return res.status(500).json({ error: 'CloudConvert API key not configured in .env' });
    }

    // Step 1: Create a job
    const jobPayload = {
      tasks: {
        'import-my-file': {
          operation: 'import/upload'
        },
        'convert-my-file': {
          operation: 'convert',
          input: 'import-my-file',
          output_format: targetFormat,
          engine: 'office' // Use 'office' for docx/xlsx/pptx, 'ghostscript' for pdf
        },
        'export-my-file': {
          operation: 'export/url',
          input: 'convert-my-file'
        }
      }
    };

    const jobResponse = await axios.post('https://api.cloudconvert.com/v2/jobs', jobPayload, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
    });

    const uploadUrl = jobResponse.data.tasks['import-my-file'].result.form.url;
    const jobId = jobResponse.data.data.id;

    // Step 2: Upload the file to CloudConvert
    const formData = new FormData();
    formData.append('file', fs.createReadStream(file.path));
    
    await axios.post(uploadUrl, formData, {
      headers: { ...formData.getHeaders(), 'Content-Length': formData.getLengthSync() }
    });

    // Step 3: Wait for conversion to finish
    let status = 'processing';
    let downloadUrl = '';
    while (status === 'processing' || status === 'waiting') {
      await new Promise(resolve => setTimeout(resolve, 2000)); // Poll every 2s
      const statusResponse = await axios.get(`https://api.cloudconvert.com/v2/jobs/${jobId}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      status = statusResponse.data.data.status;
      if (status === 'finished') {
        downloadUrl = statusResponse.data.tasks['export-my-file'].result.files[0].url;
      } else if (status === 'error') {
        throw new Error('CloudConvert processing error');
      }
    }

    // Step 4: Download the result and send to client
    const fileResponse = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
    cleanup(file);

    const mimeType = targetFormat === 'pdf' ? 'application/pdf' : 
                     targetFormat === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' :
                     targetFormat === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' :
                     'application/octet-stream';

    res.set({ 
      'Content-Type': mimeType, 
      'Content-Disposition': `attachment; filename=converted.${targetFormat}` 
    });
    res.send(Buffer.from(fileResponse.data));

  } catch (err) {
    cleanup(req.file);
    console.error('Convert Error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Conversion failed. Check API limits or file format.' });
  }
});

app.listen(PORT, () => console.log(`🚀 iLovePDF Ultimate running on http://localhost:${PORT}`));
