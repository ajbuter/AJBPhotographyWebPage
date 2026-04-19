<?php
/**
 * =============================================================================
 * AJB Photographs Web Server (PHP)
 * =============================================================================
 *
 * @file        server.php
 * @project     AJBPhotographyWebPage
 * @repository  https://github.com/ajbuter/AJBPhotographyWebPage
 * @author      Aiden Buter
 * @contact     aiden.buter@gmail.com
 * @created     2026
 *
 * -----------------------------------------------------------------------------
 * PURPOSE
 * -----------------------------------------------------------------------------
 * This PHP server powers the AJB Photographs portfolio site. It handles three
 * core responsibilities:
 *
 *   1. STATIC FILE SERVING PHP's built-in server serves index.html and all
 *      front-end assets from the project root.
 *
 *   2. IMAGE UPLOADS Accepts photo files from the admin panel and saves them
 *      to the local /uploads directory as real files on disk. Returns permanent
 *      URL paths back to the client.
 *
 *   3. DATABASE PERSISTENCE Reads and writes album/photo metadata to a local
 *      db.json file so that all data survives page refreshes and server restarts.
 *
 * -----------------------------------------------------------------------------
 * SECURITY MODEL
 * -----------------------------------------------------------------------------
 * All write operations (saving the database, uploading images) are protected by
 * a local-network check. Only requests originating from the host machine or
 * devices on the same LAN (192.168.x.x, 10.x.x.x, etc.) are permitted to
 * modify data. External visitors are restricted to read-only access.
 *
 * -----------------------------------------------------------------------------
 * USAGE
 * -----------------------------------------------------------------------------
 * Run with PHP's built-in development server:
 *   php -S localhost:3000 server.php
 *
 * Or deploy to any standard Apache/Nginx + PHP-FPM stack.
 *
 * -----------------------------------------------------------------------------
 * PROJECT STRUCTURE
 * -----------------------------------------------------------------------------
 *   /
 *   index.html      Front-end single-page application
 *   server.php      This file the backend server
 *   db.json         Auto-created album & photo metadata store
 *   uploads/        Auto-created stores all uploaded image files
 *
 * =============================================================================
 */

// -----------------------------------------------------------------------------
// CONFIGURATION
// -----------------------------------------------------------------------------
if ( FALSE ) {
error_reporting(E_ALL);
ini_set('display_errors', 'On');
}

define('DB_FILE',     __DIR__ . '/db.json');
define('UPLOADS_DIR', __DIR__ . '/uploads');
define('THUMBS_DIR', __DIR__ . '/thumbs');
define('UPLOADS_URL', '/uploads');

function make_thumb( $src, $dest, $new_width ) {
  $src_img = imagecreatefromjpeg( $src );
  $width = imagesx( $src_img );
  $height = imagesy( $src_img );
  $new_height = floor( $height * ( $new_width / $width ) );

  $v_img = imagecreatetruecolor( $new_width, $new_height );
  imagecopyresampled( $v_img, $src_img, 0, 0, 0, 0, $new_width, $new_height, $width, $height );
  imagejpeg( $v_img, $dest );
  imagedestroy( $v_img );
}

// -----------------------------------------------------------------------------
// INITIALIZATION Ensure required files and directories exist on first run
// -----------------------------------------------------------------------------

// Create the uploads directory if it does not already exist.
if (!is_dir(UPLOADS_DIR)) {
    mkdir(UPLOADS_DIR, 0755, true);
    error_log('[init] Created uploads/ directory.');
}

// Create the database file with an empty albums array if it does not exist.
if (!file_exists(DB_FILE)) {
    file_put_contents(DB_FILE, json_encode(['albums' => []], JSON_PRETTY_PRINT));
    error_log('[init] Created db.json with empty database.');
}

// -----------------------------------------------------------------------------
// ROUTING Parse the incoming request
// -----------------------------------------------------------------------------

$method = $_SERVER['REQUEST_METHOD'];
$uri    = strtok($_SERVER['REQUEST_URI'], '?'); // Strip query string

// -----------------------------------------------------------------------------
// STATIC FILE SERVING
// -----------------------------------------------------------------------------
// When using `php -S`, PHP's built-in server automatically serves files that
// exist on disk. We only need to intercept /api/* routes and /uploads/* here.
// For Apache/Nginx, configure a rewrite rule to send all non-file requests to
// this script.
// -----------------------------------------------------------------------------

// Serve files from /uploads/ directory directly.
if (strpos($uri, '/uploads/') === 0) {
    $filePath = __DIR__ . $uri;
    if (file_exists($filePath) && is_file($filePath)) {
        $mime = mime_content_type($filePath) ?: 'application/octet-stream';
        header('Content-Type: ' . $mime);
        readfile($filePath);
        exit;
    }
    http_response_code(404);
    exit('File not found.');
}

// For thumbnails, dynamically build
if (strpos($uri, '/thumbs/') === 0) {
    $filePath = __DIR__ . $uri;
    if (file_exists($filePath) && is_file($filePath)) {
        $mime = mime_content_type($filePath) ?: 'application/octet-stream';
        header('Content-Type: ' . $mime);
        readfile($filePath);
        exit;
    }
    $upfilePath = __DIR__ . str_replace('thumbs','uploads',$uri);
    if (file_exists($upfilePath) && is_file($upfilePath)) {
        $mime = mime_content_type($upfilePath) ?: 'application/octet-stream';
        header('Content-Type: ' . $mime);
	make_thumb( $upfilePath, $filePath, 300 );
	readfile($filePath);
        exit;
    }
    http_response_code(404);
    exit('File not found.');
}

// Pass non-API requests back to PHP's built-in server for static file handling.
if (strpos($uri, '/api/') !== 0) {
    return false; // Let PHP's built-in server handle static files (index.html, CSS, JS, etc.)
}

// -----------------------------------------------------------------------------
// SECURITY HELPERS
// -----------------------------------------------------------------------------

/**
 * Determines whether a request originates from the local machine or LAN.
 *
 * @param  string $ip  The remote IP address
 * @return bool        True if the IP is considered local/trusted
 */
function isLocalNetwork(string $ip): bool {
    // Strip IPv6-mapped IPv4 prefix (e.g., "::ffff:127.0.0.1" → "127.0.0.1")
    $cleaned = str_replace('::ffff:', '', $ip);

    return (
        $cleaned === '::1'                          ||
	$cleaned === '127.0.0.1'                    ||
	$cleaned === '134.22.144.19'                ||
        str_starts_with($cleaned, '192.168.')       ||
        str_starts_with($cleaned, '10.')            ||
        str_starts_with($cleaned, '172.')
    );
}

/**
 * Halt with HTTP 401 if the request is not from the local network.
 */
function requireAdmin(): void {
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    if (!isLocalNetwork($ip)) {
        error_log('[security] Blocked write attempt from external IP: ' . $ip);
        jsonResponse(['error' => 'Unauthorized admin access is local-network only.'], 401);
    }
}

// -----------------------------------------------------------------------------
// RESPONSE HELPERS
// -----------------------------------------------------------------------------

/**
 * Encode data as JSON, set appropriate headers, and exit.
 *
 * @param  mixed $data        Data to encode
 * @param  int   $statusCode  HTTP status code (default 200)
 */
function jsonResponse(mixed $data, int $statusCode = 200): void {
    http_response_code($statusCode);
    header('Content-Type: application/json');
    echo json_encode($data);
    exit;
}

/**
 * Read and decode the request body as JSON.
 *
 * @return array  Decoded associative array, or empty array on failure
 */
function getJsonBody(): array {
    $raw = file_get_contents('php://input');
    return json_decode($raw, true) ?? [];
}

// -----------------------------------------------------------------------------
// ROUTES Public (read-only, accessible to all visitors)
// -----------------------------------------------------------------------------

/**
 * GET /api/is-admin
 *
 * Allows the front-end to determine whether the current visitor is on the
 * local network. The response controls whether admin UI elements are shown.
 *
 * Response: { "admin": bool }
 */
if ($uri === '/api/is-admin' && $method === 'GET') {
    $ip    = $_SERVER['REMOTE_ADDR'] ?? '';
    $admin = isLocalNetwork($ip);
    jsonResponse(['admin' => $admin]);
}

/**
 * GET /api/db
 *
 * Returns the full database as JSON. Called on every page load by the
 * front-end to hydrate the in-memory data store with the latest persisted
 * state (albums, photos, metadata).
 *
 * Response: { "albums": Album[] }
 */
if ($uri === '/api/db' && $method === 'GET') {
    $raw = @file_get_contents(DB_FILE);
    if ($raw === false) {
        error_log('[db] Failed to read db.json');
        jsonResponse(['error' => 'Failed to read database.'], 500);
    }
    $data = json_decode($raw, true);
    if ($data === null) {
        error_log('[db] Failed to parse db.json');
        jsonResponse(['error' => 'Failed to parse database.'], 500);
    }
    jsonResponse($data);
}

// -----------------------------------------------------------------------------
// ROUTES Protected (write operations, local network only)
// -----------------------------------------------------------------------------

/**
 * POST /api/db
 * [PROTECTED requireAdmin]
 *
 * Persists the entire in-memory database state to db.json. Called by the
 * front-end after any mutation (creating albums, adding photos, etc.).
 *
 * Request body: { "albums": Album[] }  (JSON)
 * Response:     { "ok": true }
 */
if ($uri === '/api/db' && $method === 'POST') {
    requireAdmin();

    $body = getJsonBody();
    $json = json_encode($body, JSON_PRETTY_PRINT);

    if (file_put_contents(DB_FILE, $json) === false) {
        error_log('[db] Failed to write db.json');
        jsonResponse(['error' => 'Failed to save database.'], 500);
    }

    jsonResponse(['ok' => true]);
}

/**
 * POST /api/upload
 * [PROTECTED requireAdmin]
 *
 * Accepts one or more image files from the admin panel's file upload input.
 * Files are saved to the /uploads directory on disk. Returns the public URL
 * paths for each saved file so the front-end can store them in the album's
 * photo array.
 *
 * Request: multipart/form-data with field name "photos"
 * Response: { "urls": string[] }  e.g. ["/uploads/1776106685061-photo.jpg"]
 */
if ($uri === '/api/upload' && $method === 'POST') {
    requireAdmin();

    // PHP stores multi-file uploads differently from single normalize to
    // an array of individual file entries for uniform processing.
    $files = [];

    if (!empty($_FILES['photos'])) {
        $raw = $_FILES['photos'];

        if (is_array($raw['name'])) {
            // Multiple files uploaded under the same field name
            $count = count($raw['name']);
            for ($i = 0; $i < $count; $i++) {
                $files[] = [
                    'name'     => $raw['name'][$i],
                    'tmp_name' => $raw['tmp_name'][$i],
                    'error'    => $raw['error'][$i],
                    'size'     => $raw['size'][$i],
                ];
            }
        } else {
            // Single file
            $files[] = $raw;
        }
    }

    if (empty($files)) {
        jsonResponse(['error' => 'No files received.'], 400);
    }

    $urls = [];

    foreach ($files as $file) {
        if ($file['error'] !== UPLOAD_ERR_OK) {
            error_log('[upload] File upload error code: ' . $file['error']);
            jsonResponse(['error' => 'File upload failed (error code ' . $file['error'] . ').'], 500);
        }

        // Prefix with Unix timestamp (milliseconds) to guarantee uniqueness,
        // matching the original Node.js behaviour: Date.now() + '-' + originalname
        $filename = round(microtime(true) * 1000) . '-' . basename($file['name']);
        $dest     = UPLOADS_DIR . '/' . $filename;
        $thumb    = THUMBS_DIR . '/' . $filename;

        if (!move_uploaded_file($file['tmp_name'], $dest)) {
            error_log('[upload] Failed to move uploaded file to: ' . $dest);
            jsonResponse(['error' => 'Failed to save uploaded file.'], 500);
	} else {
	    make_thumb( $dest, $thumb, 300 );
	}

        $urls[] = UPLOADS_URL . '/' . $filename;
    }

    error_log('[upload] Saved ' . count($urls) . ' file(s): ' . implode(', ', $urls));
    jsonResponse(['urls' => $urls]);
}

// -----------------------------------------------------------------------------
// 404 No route matched
// -----------------------------------------------------------------------------

jsonResponse(['error' => 'Not found.'], 404);
