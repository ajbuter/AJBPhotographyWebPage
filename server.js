const express = require('express');
const multer  = require('multer');
const fs      = require('fs');
const path    = require('path');

const app     = express();
const DB_FILE = path.join(__dirname, 'db.json');
const UPLOADS = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS);
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ albums: [] }));

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOADS),
  filename:    (_, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));app.use(express.static(__dirname));          // serves index.html
app.use('/uploads', express.static(UPLOADS)); // serves your images

// Save full DB state
app.post('/api/db', (req, res) => {
  fs.writeFileSync(DB_FILE, JSON.stringify(req.body, null, 2));
  res.json({ ok: true });
});

// Load DB state
app.get('/api/db', (req, res) => {
  res.json(JSON.parse(fs.readFileSync(DB_FILE)));
});

// Upload images → saves to disk, returns real URLs
app.post('/api/upload', upload.array('photos'), (req, res) => {
  const urls = req.files.map(f => `/uploads/${f.filename}`);
  res.json({ urls });
});

function isLocalNetwork(ip) {
  return (
    ip === '::1' ||
    ip === '127.0.0.1' ||
    ip.startsWith('192.168.') ||
    ip.startsWith('10.') ||
    ip.startsWith('172.')
  );
}

app.get('/api/is-admin', (req, res) => {
  const ip = req.socket.remoteAddress;
  res.json({ admin: isLocalNetwork(ip) });
});

app.listen(3000, () => console.log('Running at http://localhost:3000'));