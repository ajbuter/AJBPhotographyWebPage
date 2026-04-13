/**
 * =============================================================================
 * AJB Photographs — Local Web Server
 * =============================================================================
 *
 * @file        server.js
 * @project     AJBPhotographyWebPage
 * @repository  https://github.com/ajbuter/AJBPhotographyWebPage
 * @author      Aiden Buter
 * @contact     aiden.buter@gmail.com
 * @created     2026
 *
 * -----------------------------------------------------------------------------
 * PURPOSE
 * -----------------------------------------------------------------------------
 * This Node.js/Express server powers the AJB Photographs portfolio site. It
 * handles three core responsibilities:
 *
 *   1. STATIC FILE SERVING — Serves index.html and all front-end assets so
 *      the site is accessible in any browser on the local machine or network.
 *
 *   2. IMAGE UPLOADS — Accepts photo files from the admin panel and saves them
 *      to the local /uploads directory as real files on disk (rather than
 *      bloated base64 strings). Returns permanent URL paths back to the client.
 *
 *   3. DATABASE PERSISTENCE — Reads and writes album/photo metadata to a local
 *      db.json file so that all data survives page refreshes and server restarts.
 *
 * -----------------------------------------------------------------------------
 * SECURITY MODEL
 * -----------------------------------------------------------------------------
 * All write operations (saving the database, uploading images) are protected by
 * a local-network check. Only requests originating from the host machine or
 * devices on the same LAN (192.168.x.x, 10.x.x.x, etc.) are permitted to
 * modify data. External visitors — including anyone accessing the site through
 * a Cloudflare Tunnel — are silently restricted to read-only access.
 *
 * The /api/is-admin endpoint lets the front-end know whether to show or hide
 * admin UI controls, so external visitors never even see the admin button.
 *
 * -----------------------------------------------------------------------------
 * DEPENDENCIES
 * -----------------------------------------------------------------------------
 *   express  — HTTP server framework
 *   multer   — Multipart form handling for image file uploads
 *
 * Install with:  npm install express multer
 * Run with:      node server.js
 *
 * -----------------------------------------------------------------------------
 * PROJECT STRUCTURE
 * -----------------------------------------------------------------------------
 *   /
 *   ├── index.html      Front-end single-page application
 *   ├── server.js       This file — the backend server
 *   ├── db.json         Auto-created — album & photo metadata store
 *   ├── package.json    Auto-created by npm init
 *   └── uploads/        Auto-created — stores all uploaded image files
 *
 * =============================================================================
 */

'use strict';

// -----------------------------------------------------------------------------
// IMPORTS
// -----------------------------------------------------------------------------

const express = require('express'); // Web framework for routing and middleware
const multer  = require('multer');  // Middleware for handling multipart/form-data (file uploads)
const fs      = require('fs');      // Node.js built-in filesystem module
const path    = require('path');    // Node.js built-in path utilities

// -----------------------------------------------------------------------------
// CONFIGURATION
// -----------------------------------------------------------------------------

const app     = express();
const PORT    = 3000;

/** Absolute path to the JSON file that stores all album and photo metadata. */
const DB_FILE = path.join(__dirname, 'db.json');

/** Absolute path to the directory where uploaded image files are stored on disk. */
const UPLOADS  = path.join(__dirname, 'uploads');

// -----------------------------------------------------------------------------
// INITIALIZATION — Ensure required files and directories exist on first run
// -----------------------------------------------------------------------------

/**
 * Create the uploads directory if it does not already exist.
 * This runs once at startup so the server never throws on a fresh clone.
 */
if (!fs.existsSync(UPLOADS)) {
  fs.mkdirSync(UPLOADS);
  console.log('[init] Created uploads/ directory.');
}

/**
 * Create the database file with an empty albums array if it does not exist.
 * This ensures /api/db never throws a "file not found" error on first run.
 */
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ albums: [] }, null, 2));
  console.log('[init] Created db.json with empty database.');
}

// -----------------------------------------------------------------------------
// MULTER — File Upload Storage Configuration
// -----------------------------------------------------------------------------

/**
 * Configure multer to store uploaded files directly to the uploads/ directory.
 *
 * Filename strategy: prefix each file with the current Unix timestamp to
 * guarantee uniqueness and prevent collisions when uploading files with
 * identical names (e.g., multiple "IMG_001.jpg" from different shoots).
 *
 * Example output filename: 1776106685061-IMG_001.jpg
 */
const storage = multer.diskStorage({
  /**
   * Set the destination directory for uploaded files.
   * @param {Object} req  - Incoming HTTP request
   * @param {Object} file - File object from the multipart form
   * @param {Function} cb - Callback(error, destinationPath)
   */
  destination: (req, file, cb) => cb(null, UPLOADS),

  /**
   * Set the filename for the uploaded file.
   * @param {Object} req  - Incoming HTTP request
   * @param {Object} file - File object with original name metadata
   * @param {Function} cb - Callback(error, filename)
   */
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});

/** Multer instance configured with the disk storage strategy above. */
const upload = multer({ storage });

// -----------------------------------------------------------------------------
// MIDDLEWARE
// -----------------------------------------------------------------------------

/**
 * Parse incoming JSON request bodies with an increased size limit.
 * The default 100kb limit is far too small for album metadata that may
 * contain many photo URL strings. 50mb is a safe ceiling.
 */
app.use(express.json({ limit: '50mb' }));

/**
 * Support URL-encoded request bodies (also with increased limit).
 * Required for certain form submission patterns.
 */
app.use(express.urlencoded({ limit: '50mb', extended: true }));

/**
 * Serve all static files (index.html, CSS, JS, fonts, etc.) from the
 * project root directory. This makes the front-end available at http://localhost:3000.
 */
app.use(express.static(__dirname));

/**
 * Expose the uploads directory as a public static file path.
 * Images saved to disk are accessed by the front-end via /uploads/filename.jpg.
 */
app.use('/uploads', express.static(UPLOADS));

// -----------------------------------------------------------------------------
// SECURITY HELPERS
// -----------------------------------------------------------------------------

/**
 * Determines whether a request originates from the local machine or LAN.
 *
 * Node.js sometimes prepends the IPv6 loopback prefix "::ffff:" to IPv4
 * addresses (e.g., "::ffff:127.0.0.1"), so we strip it before comparing.
 *
 * Recognized local ranges:
 *   ::1           — IPv6 loopback (localhost)
 *   127.0.0.1     — IPv4 loopback (localhost)
 *   192.168.x.x   — Common home/office LAN range
 *   10.x.x.x      — Private Class A range
 *   172.x.x.x     — Private Class B range (includes 172.16–172.31)
 *
 * @param   {string}  ip - The remote IP address from the socket connection
 * @returns {boolean} True if the IP is considered local/trusted
 */
function isLocalNetwork(ip) {
  const cleaned = ip.replace('::ffff:', ''); // Normalize IPv6-mapped IPv4 addresses
  return (
    cleaned === '::1'             ||
    cleaned === '127.0.0.1'       ||
    cleaned.startsWith('192.168.')||
    cleaned.startsWith('10.')     ||
    cleaned.startsWith('172.')
  );
}

/**
 * Express middleware that restricts a route to local network requests only.
 * Returns HTTP 401 Unauthorized for any request from an external IP address.
 *
 * Usage: app.post('/api/db', requireAdmin, handler)
 *
 * @param {Object}   req  - Incoming HTTP request
 * @param {Object}   res  - HTTP response object
 * @param {Function} next - Calls the next middleware/handler in the chain
 */
function requireAdmin(req, res, next) {
  const ip = req.socket.remoteAddress;
  if (!isLocalNetwork(ip)) {
    console.warn(`[security] Blocked write attempt from external IP: ${ip}`);
    return res.status(401).json({ error: 'Unauthorized — admin access is local-network only.' });
  }
  next();
}

// -----------------------------------------------------------------------------
// ROUTES — Public (read-only, accessible to all visitors)
// -----------------------------------------------------------------------------

/**
 * GET /api/is-admin
 *
 * Allows the front-end to determine whether the current visitor is on the
 * local network. The response controls whether admin UI elements are shown.
 *
 * Response: { admin: boolean }
 */
app.get('/api/is-admin', (req, res) => {
  const ip    = req.socket.remoteAddress;
  const admin = isLocalNetwork(ip);
  res.json({ admin });
});

/**
 * GET /api/db
 *
 * Returns the full database as JSON. This is called on every page load by
 * the front-end to hydrate the in-memory data store (db) with the latest
 * persisted state (albums, photos, metadata).
 *
 * Response: { albums: Album[] }
 */
app.get('/api/db', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    res.json(data);
  } catch (err) {
    console.error('[db] Failed to read db.json:', err.message);
    res.status(500).json({ error: 'Failed to read database.' });
  }
});

// -----------------------------------------------------------------------------
// ROUTES — Protected (write operations, local network only)
// -----------------------------------------------------------------------------

/**
 * POST /api/db
 * [PROTECTED — requireAdmin]
 *
 * Persists the entire in-memory database state to db.json. Called by the
 * front-end after any mutation (creating albums, adding photos, etc.).
 *
 * Request body: { albums: Album[] }
 * Response:     { ok: true }
 */
app.post('/api/db', requireAdmin, (req, res) => {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(req.body, null, 2));
    res.json({ ok: true });
  } catch (err) {
    console.error('[db] Failed to write db.json:', err.message);
    res.status(500).json({ error: 'Failed to save database.' });
  }
});

/**
 * POST /api/upload
 * [PROTECTED — requireAdmin]
 *
 * Accepts one or more image files from the admin panel's file upload input.
 * Files are saved to the /uploads directory on disk via multer. Returns the
 * public URL paths for each saved file so the front-end can store them in
 * the album's photo array.
 *
 * Request: multipart/form-data with field name "photos"
 * Response: { urls: string[] }  e.g. ["/uploads/1776106685061-photo.jpg"]
 */
app.post('/api/upload', requireAdmin, upload.array('photos'), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files received.' });
  }
  const urls = req.files.map(f => `/uploads/${f.filename}`);
  console.log(`[upload] Saved ${urls.length} file(s):`, urls);
  res.json({ urls });
});

// -----------------------------------------------------------------------------
// START SERVER
// -----------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log('');
  console.log('  ╔═══════════════════════════════════════════╗');
  console.log('  ║       AJB Photographs — Server Ready      ║');
  console.log('  ╠═══════════════════════════════════════════╣');
  console.log(`  ║  Local:   http://localhost:${PORT}            ║`);
  console.log('  ║  Author:  Aiden Buter                     ║');
  console.log('  ║  Contact: aiden.buter@gmail.com           ║');
  console.log('  ╚═══════════════════════════════════════════╝');
  console.log('');
});