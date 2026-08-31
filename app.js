// =============================================================================
// AJB Photographs — Front-End Application Logic
// =============================================================================
//
// @author   Aiden Buter
// @contact  aiden.buter@gmail.com
// @repo     https://github.com/ajbuter/AJBPhotographyWebPage
//
// OVERVIEW
// This script drives the entire single-page application:
//   - Data management    (db object, loadDb, saveDb via REST API)
//   - Page routing       (showHome, showCategory, showAlbum)
//   - Content rendering  (renderCategoryPage, renderAlbumsGrid, renderAlbumPage)
//   - Lightbox viewer    (openLightbox, closeLightbox, lightboxNav)
//   - Admin panel        (openAdmin, createAlbum, addPhotosToAlbum)
//   - Image uploads      (handleCoverUpload, handlePhotosUpload → /api/upload)
//   - URL hash routing   (handleHash — for shareable album links)
//   - Toast notifications (showToast)
//   - Live stats         (updateStats, updateCounts)
//
// =============================================================================

// -----------------------------------------------------------------------------
// STATE — In-memory data store
// -----------------------------------------------------------------------------

/**
 * Main database object. Loaded from the server on page init via loadDb().
 * Structure: { albums: Album[] }
 *
 * Album shape:
 * {
 *   id:        string,   // "album_<timestamp>"
 *   name:      string,   // Display name
 *   category:  string,   // "sports" | "automotive" | "portraits" | "environmental"
 *   sport:     string?,  // Set when category === "sports"
 *   date:      string?,  // ISO date string "YYYY-MM-DD"
 *   tags:      string[], // Array of tag strings
 *   cover:     string?,  // URL path to cover image, e.g. "/uploads/123-cover.jpg"
 *   photos:    Photo[],  // Array of photo objects
 *   createdAt: string    // ISO timestamp
 * }
 *
 * Photo shape:
 * {
 *   id:  string,  // "p_<timestamp><random>"
 *   url: string   // URL path to image, e.g. "/uploads/123-photo.jpg"
 * }
 */
let db = { albums: [] };

/** The currently displayed category slug (e.g. "sports") */
let currentCategory = 'sports';

/** The ID of the album currently open in the album view page */
let currentAlbumId = null;

/** The currently active sport filter in the sports category ("All" or a sport name) */
let currentSportFilter = 'All';

/** Array of image URLs for the currently open album — used by the lightbox */
let lightboxImages = [];

/** Index of the currently displayed image within lightboxImages */
let lightboxIndex = 0;

/** Base64 or URL of the pending cover image before album is saved */
let pendingCoverDataUrl = null;

/** Array of URLs for photos staged for upload but not yet committed to an album */
let pendingPhotoDataUrls = [];

/** Which photo input tab is active: "upload" | "url" | "lightroom" */
let currentPhotoTab = 'upload';

/** Whether the current visitor is on the local network (set during init) */
let isAdmin = false;

// -----------------------------------------------------------------------------
// DATABASE — Server-synced persistence via REST API
// -----------------------------------------------------------------------------

/**
 * Persists the current in-memory db object to the server (POST /api/db).
 * Must be awaited to ensure saves complete before any subsequent UI updates.
 * Only succeeds for local network users — server returns 401 for external requests.
 */
async function saveDb() {
  const res  = await fetch('/api/db', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(db)
  });
  const data = await res.json();
  console.log('[db] saveDb response:', data);
}

/**
 * Loads the database from the server (GET /api/db) and assigns it to the
 * global db object. Called once on page initialization before rendering.
 */
async function loadDb() {
  const res = await fetch('/api/db');
  db = await res.json();
  console.log('[db] Loaded:', db);
}

// -----------------------------------------------------------------------------
// NAVIGATION BAR
// -----------------------------------------------------------------------------

/**
 * Add "scrolled" class to nav when user scrolls past 20px.
 * This triggers the box-shadow transition defined in CSS.
 */
window.addEventListener('scroll', () => {
  document.getElementById('navbar').classList.toggle('scrolled', window.scrollY > 20);
});

/**
 * Toggle the mobile navigation overlay open/closed.
 * Uses the "open" class to slide the panel in from the right.
 */
function toggleMobile() {
  document.getElementById('mobileNav').classList.toggle('open');
}

// -----------------------------------------------------------------------------
// PAGE ROUTING — SPA Navigation
// -----------------------------------------------------------------------------

/**
 * Show the home page (hero, categories, about, contact).
 * Hides all other pages, updates stats and category counts.
 */
function showHome() {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('homePage').classList.add('active');
  updateStats();
  updateCounts();
  window.scrollTo(0, 0);
}

/**
 * Show the category page for the given category slug.
 * Resets the sport filter and triggers a full re-render.
 *
 * @param {string} cat - Category slug: "sports" | "automotive" | "portraits" | "environmental"
 */
function showCategory(cat) {
  currentCategory     = cat;
  currentSportFilter  = 'All';
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('categoryPage').classList.add('active');
  renderCategoryPage();
  window.scrollTo(0, 0);
}

/**
 * Show the album view page for the given album ID.
 * Triggers a full render of the album's photo grid.
 *
 * @param {string} albumId - The album's unique ID (e.g. "album_1776106685061")
 */
function showAlbum(albumId) {
  currentAlbumId = albumId;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('albumPage').classList.add('active');
  renderAlbumPage();
  window.scrollTo(0, 0);
}

// -----------------------------------------------------------------------------
// CATEGORY PAGE RENDERING
// -----------------------------------------------------------------------------

/**
 * Metadata for each category — used to populate the category page header
 * and the empty state icons within the albums grid.
 */
const catMeta = {
  sports:        { label: 'Sports Photography',        title: 'Action &amp; <em>Sports</em>',      icon: '🏆' },
  automotive:    { label: 'Automotive Photography',    title: 'Cars &amp; <em>Automotive</em>',    icon: '🚗' },
  portraits:     { label: 'Portrait Photography',      title: 'Portraits &amp; <em>People</em>',   icon: '🎭' },
  environmental: { label: 'Environmental Photography', title: 'Nature &amp; <em>Environment</em>', icon: '🌿' },
  events:        { label: 'Events Photography',         title: 'Events &amp; <em>Gatherings</em>',  icon: '🎉' },
};

/**
 * Full list of sport types used for the filter tabs in the Sports category.
 * "All" is a special value that disables filtering.
 */
const sportsList = ['All','Football','Soccer','Basketball','Baseball','Softball','Volleyball','Track & Field','Swimming','Tennis','Other'];

/**
 * Renders the category page header (breadcrumb, title, sport tabs) and
 * calls renderAlbumsGrid() to populate the album cards below.
 */
function renderCategoryPage() {
  const meta = catMeta[currentCategory];
  document.getElementById('cat-breadcrumb').textContent  = meta.label;
  document.getElementById('cat-label').textContent       = meta.label;
  document.getElementById('cat-title').innerHTML         = meta.title;

  // Show sport filter tabs only for the Sports category
  const sportTabs = document.getElementById('sportTabs');
  if (currentCategory === 'sports') {
    sportTabs.style.display = 'flex';
    sportTabs.innerHTML = sportsList.map(s =>
      `<button class="sport-tab ${s === currentSportFilter ? 'active' : ''}" onclick="filterSport('${s}')">${s}</button>`
    ).join('');
  } else {
    sportTabs.style.display = 'none';
  }

  renderAlbumsGrid();
}

/**
 * Updates the active sport filter tab and re-renders the albums grid.
 * @param {string} sport - Sport name or "All"
 */
function filterSport(sport) {
  currentSportFilter = sport;
  // Update active state on all tab buttons
  document.querySelectorAll('.sport-tab').forEach(t =>
    t.classList.toggle('active', t.textContent === sport)
  );
  renderAlbumsGrid();
}

/**
 * Renders the grid of album cards for the current category and sport filter.
 * Albums are sorted by date descending (most recent first).
 * Shows an empty state if no albums match the current filter.
 */
function renderAlbumsGrid() {
  // Filter albums by current category
  let albums = db.albums.filter(a => a.category === currentCategory);

  // Further filter by sport if in Sports category and a specific sport is selected
  if (currentCategory === 'sports' && currentSportFilter !== 'All') {
    albums = albums.filter(a => a.sport === currentSportFilter);
  }

  // Sort by date descending
  albums.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  document.getElementById('albums-count').textContent = `${albums.length} album${albums.length !== 1 ? 's' : ''}`;

  const grid = document.getElementById('albumsGrid');

  // Empty state — shown when no albums match the filter
  if (albums.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="empty-state-icon">${catMeta[currentCategory].icon}</div>
        <p class="empty-state-text">No albums yet. Click "New Album" to get started.</p>
      </div>`;
    return;
  }

  // Render album cards
  grid.innerHTML = albums.map(a => {
    const thumb   = a.cover || '';
    const count   = (a.photos || []).length;
    const dateStr = a.date
      ? new Date(a.date + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
      : '';
    const tags = (a.tags || []).slice(0, 3).map(t => `<span class="album-tag">${t}</span>`).join('');

    return `
    <div class="album-card" onclick="showAlbum('${a.id}')">
      <div class="album-thumb">
        ${thumb
          ? `<img src="${thumb}" alt="${a.name}" loading="lazy">`
          : `<div class="album-thumb-placeholder">${catMeta[currentCategory].icon}</div>`
        }
        <span class="album-thumb-count">${count} photo${count !== 1 ? 's' : ''}</span>
      </div>
      <div class="album-info">
        <div class="album-title">${a.name}</div>
        <div class="album-meta">
          ${a.sport  ? `<span>🏅 ${a.sport}</span>` : ''}
          ${dateStr  ? `<span>📅 ${dateStr}</span>`  : ''}
        </div>
        <div style="margin-bottom:0.75rem;">${tags}</div>
        <div class="album-actions">
          <button class="btn-sm btn-share" onclick="event.stopPropagation();shareAlbumById('${a.id}')">🔗 Share</button>
          ${isAdmin ? `<button class="btn-sm btn-edit-album" onclick="event.stopPropagation();openAdminEditAlbum('${a.id}')">✏️ Edit</button>` : ''}
          <button class="btn-sm btn-view">View Album →</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

// -----------------------------------------------------------------------------
// ALBUM PAGE RENDERING
// -----------------------------------------------------------------------------

/**
 * Renders the album view page header (breadcrumb, title, metadata) and
 * calls renderPhotosGrid() to populate the photo tiles.
 * Redirects to home if the album ID is not found in the database.
 */
function renderAlbumPage() {
  const album = db.albums.find(a => a.id === currentAlbumId);
  if (!album) { showHome(); return; }

  const catLabel = catMeta[album.category]?.label || album.category;

  // Breadcrumb — "Home › Sports Photography › Album Name"
  document.getElementById('albumBreadcrumb').innerHTML = `
    <a href="#" onclick="showHome()">Home</a> ›
    <a href="#" onclick="showCategory('${album.category}')">${catLabel}</a> ›
    <span>${album.name}</span>
  `;

  // Split album name at last space to italicise the last word (stylistic detail)
  document.getElementById('albumPageTitle').innerHTML =
    `${album.name.replace(/(.+)( .+)$/, '$1<em>$2</em>')}`;

  const dateStr = album.date
    ? new Date(album.date + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : '';

  document.getElementById('albumTagDisplay').textContent  = album.sport || album.category;
  document.getElementById('albumDateDisplay').textContent = dateStr;

  renderPhotosGrid(album);
}

/**
 * Renders the photo grid for the given album.
 * Also populates the lightboxImages array used by the lightbox viewer.
 *
 * @param {Object} album - The album object from db.albums
 */
function renderPhotosGrid(album) {
  const grid   = document.getElementById('albumPhotosGrid');
  const photos = album.photos || [];

  // Empty state — shown when album has no photos yet
  if (photos.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="empty-state-icon">📸</div>
        <p class="empty-state-text">No photos yet. Click "+ Add Photos" to get started.</p>
      </div>`;
    lightboxImages = [];
    return;
  }

  // Build flat array of image URLs for lightbox navigation
  lightboxImages = photos.map(p => p.url);

  // Render photo tiles — clicking opens the lightbox at that index
  grid.innerHTML = photos.map((p, i) => `
    <div class="photo-item" onclick="openLightbox(${i})">
      <img src="${p.url.replace('upload','thumb')}" alt="Photo ${i + 1}" loading="lazy">
      <div class="photo-item-overlay">
        <span class="photo-item-overlay-icon">⊕</span>
      </div>
    </div>
  `).join('');
}

// -----------------------------------------------------------------------------
// LIGHTBOX
// -----------------------------------------------------------------------------

/**
 * Opens the lightbox viewer at the specified photo index.
 * @param {number} index - Index into lightboxImages array
 */
function openLightbox(index) {
  lightboxIndex = index;
  updateLightbox();
  document.getElementById('lightbox').classList.add('open');
  document.body.style.overflow = 'hidden'; // Prevent background scroll
}

/**
 * Updates the lightbox to display the current lightboxIndex image.
 * Updates the image src, caption counter, and download link.
 */
function updateLightbox() {
  const url = lightboxImages[lightboxIndex];
  document.getElementById('lightboxImg').src             = url;
  document.getElementById('lightboxCaption').textContent = `${lightboxIndex + 1} / ${lightboxImages.length}`;

  const dl     = document.getElementById('lightboxDownload');
  dl.href      = url;
  dl.download  = `ajb_photo_${lightboxIndex + 1}.jpg`;
}

/** Closes the lightbox and restores background scrolling. */
function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open');
  document.body.style.overflow = '';
}

/**
 * Advances the lightbox by dir steps with wraparound.
 * @param {number} dir - +1 for next, -1 for previous
 */
function lightboxNav(dir) {
  lightboxIndex = (lightboxIndex + dir + lightboxImages.length) % lightboxImages.length;
  updateLightbox();
}

// Keyboard navigation — only active when lightbox is open
document.addEventListener('keydown', e => {
  if (!document.getElementById('lightbox').classList.contains('open')) return;
  if (e.key === 'ArrowRight') lightboxNav(1);
  if (e.key === 'ArrowLeft')  lightboxNav(-1);
  if (e.key === 'Escape')     closeLightbox();
});

// Click on the lightbox backdrop (not the image) to close
document.getElementById('lightbox').addEventListener('click', e => {
  if (e.target === document.getElementById('lightbox')) closeLightbox();
});

// -----------------------------------------------------------------------------
// ADMIN PANEL
// -----------------------------------------------------------------------------

/**
 * Opens the admin panel modal and pre-selects the correct tab.
 * Also pre-selects the current category/album if navigating from those pages.
 *
 * @param {string} tab - "album" | "photos"
 */
function openAdmin(tab) {
  document.getElementById('adminPanel').classList.add('open');
  document.body.style.overflow = 'hidden';
  populateAlbumSelect();
  switchAdminTab(tab);

  // Pre-select the current category in the New Album form
  if (currentCategory) {
    const sel = document.getElementById('albumCategory');
    if (sel) sel.value = currentCategory;
    toggleSportGroup();
  }

  // Pre-select the current album in the Add Photos form
  if (currentAlbumId) {
    const sel = document.getElementById('photoAlbumSelect');
    if (sel) sel.value = currentAlbumId;
  }
}

/**
 * Closes the admin panel and resets all pending upload state.
 */
function closeAdmin() {
  document.getElementById('adminPanel').classList.remove('open');
  document.body.style.overflow = '';
  pendingCoverDataUrl  = null;
  pendingPhotoDataUrls = [];
  document.getElementById('uploadPreview').innerHTML        = '';
  document.getElementById('editUploadPreview').innerHTML    = '';
  document.getElementById('coverPreviewWrap').style.display = 'none';
}

/**
 * Switches between the "New Album", "Add Photos", and "Edit Album" tabs in the admin panel.
 * @param {string} tab - "album" | "photos" | "edit"
 */
function switchAdminTab(tab) {
  document.querySelectorAll('#adminTabs .admin-tab').forEach((t, i) => {
    const tabs = ['album', 'photos', 'edit'];
    t.classList.toggle('active', tabs[i] === tab);
  });
  document.getElementById('tabAlbum').classList.toggle('active',  tab === 'album');
  document.getElementById('tabPhotos').classList.toggle('active', tab === 'photos');
  document.getElementById('tabEdit').classList.toggle('active',   tab === 'edit');

  if (tab === 'edit') {
    populateEditAlbumSelect();
  }
}

/**
 * Switches between the photo input sub-tabs (Upload / URL / Lightroom).
 * @param {string} tab - "upload" | "url" | "lightroom"
 */
function switchPhotoTab(tab) {
  currentPhotoTab = tab;
  ['upload', 'url', 'lightroom'].forEach(t => {
    document.getElementById(`photoTab${t.charAt(0).toUpperCase() + t.slice(1)}`).style.display = t === tab ? 'block' : 'none';
    document.getElementById(`ptab-${t}`).classList.toggle('active', t === tab);
  });
}

/**
 * Shows or hides the Sport selector based on the selected Category.
 * Only displayed when Category === "sports".
 */
document.getElementById('albumCategory').addEventListener('change', toggleSportGroup);
function toggleSportGroup() {
  const cat = document.getElementById('albumCategory').value;
  document.getElementById('sportTypeGroup').style.display = cat === 'sports' ? 'block' : 'none';
}

/**
 * Handles cover image file selection.
 * Uploads the file to /api/upload, stores the returned URL in pendingCoverDataUrl,
 * and shows a preview image.
 *
 * @param {Event} e - File input change event
 */
async function handleCoverUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('photos', file);

  const res  = await fetch('/api/upload', { method: 'POST', body: formData });
  const data = await res.json();

  pendingCoverDataUrl = data.urls[0];
  document.getElementById('coverPreviewImg').src            = pendingCoverDataUrl;
  document.getElementById('coverPreviewWrap').style.display = 'block';
}

/**
 * Handles photo file selection in the Upload Files sub-tab.
 * Sends all selected files to /api/upload in a single request.
 * Populates the pending upload preview grid with thumbnails.
 * (Legacy — replaced by handlePhotosUpload below.)
 *
 * @param {Event} e - File input change event (multiple files)
 */
async function handlePhotosUpload_notGrouped(e) {
  const files    = Array.from(e.target.files);
  const formData = new FormData();
  files.forEach(f => formData.append('photos[]', f));

  const res  = await fetch('/api/upload', { method: 'POST', body: formData });
  const data = await res.json();

  const preview = document.getElementById('uploadPreview');
  data.urls.forEach(url => {
    pendingPhotoDataUrls.push(url);
    const idx  = pendingPhotoDataUrls.length - 1;
    const item = document.createElement('div');
    item.className = 'upload-preview-item';
    item.innerHTML = `
      <img src="${url}" alt="">
      <button class="upload-preview-remove" onclick="removePendingPhoto(${idx}, this.parentElement)">✕</button>`;
    preview.appendChild(item);
  });
}

/**
 * Handles photo file selection in the Upload Files sub-tab.
 * Sends each selected file to /api/upload in a separate request.
 * Populates the pending upload preview grid with thumbnails.
 *
 * @param {Event} e - File input change event (multiple files)
 */
async function handlePhotosUpload(e) {
  const files   = Array.from(e.target.files);
  const preview = document.getElementById('uploadPreview');

  for (const file of files) {
    const formData = new FormData();
    formData.append('photos', file);

    const res  = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();

    data.urls.forEach(url => {
      pendingPhotoDataUrls.push(url);
      const idx  = pendingPhotoDataUrls.length - 1;
      const item = document.createElement('div');
      item.className = 'upload-preview-item';
      item.innerHTML = `
        <img src="${url}" alt="">
        <button class="upload-preview-remove" onclick="removePendingPhoto(${idx}, this.parentElement)">✕</button>`;
      preview.appendChild(item);
    });
  }
}

/**
 * Removes a pending photo from the upload queue by nulling its index.
 * The null values are filtered out when addPhotosToAlbum() processes the array.
 *
 * @param {number} idx - Index in pendingPhotoDataUrls to nullify
 * @param {HTMLElement} el - The preview item element to remove from DOM
 */
function removePendingPhoto(idx, el) {
  pendingPhotoDataUrls[idx] = null;
  el.remove();
}

/**
 * Populates the album selector dropdown in the Add Photos tab
 * with all currently created albums.
 */
function populateAlbumSelect() {
  const sel = document.getElementById('photoAlbumSelect');
  if (!sel) return;
  sel.innerHTML = db.albums.length === 0
    ? '<option value="">— No albums yet, create one first —</option>'
    : db.albums.map(a => `<option value="${a.id}">${a.name} (${a.category})</option>`).join('');
}

/**
 * Creates a new album from the admin form, saves it to the database,
 * and navigates to the new album's category page.
 *
 * Validates that a name is provided before proceeding.
 */
async function createAlbum() {
  const name = document.getElementById('albumName').value.trim();
  if (!name) { showToast('Please enter an album name.'); return; }

  const category = document.getElementById('albumCategory').value;
  const sport    = category === 'sports' ? document.getElementById('albumSport').value : null;
  const date     = document.getElementById('albumDate').value;
  const tagsRaw  = document.getElementById('albumTags').value;
  const tags     = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];

  // Prepend sport to tags if not already present
  if (sport && !tags.includes(sport)) tags.unshift(sport);

  const album = {
    id:        'album_' + Date.now(),
    name,
    category,
    sport,
    date,
    tags,
    cover:     pendingCoverDataUrl || null,
    photos:    [],
    createdAt: new Date().toISOString()
  };

  db.albums.push(album);
  await saveDb(); // Persist to server before closing panel
  closeAdmin();
  showToast(`Album "${name}" created!`);

  // Reset form fields
  document.getElementById('albumName').value = '';
  document.getElementById('albumDate').value = '';
  document.getElementById('albumTags').value = '';

  showCategory(category);
}

/**
 * Adds staged photos to the selected album and persists the change.
 * Supports two input modes:
 *   - "upload": Uses URLs from pendingPhotoDataUrls (uploaded via /api/upload)
 *   - "url":    Parses URLs pasted into the textarea, one per line
 *
 * If the album has no cover yet, the first new photo is set as cover.
 */
async function addPhotosToAlbum() {
  const albumId = document.getElementById('photoAlbumSelect').value;
  if (!albumId) { showToast('Select an album first.'); return; }

  const album = db.albums.find(a => a.id === albumId);
  if (!album) return;

  const newPhotos = [];

  if (currentPhotoTab === 'upload') {
    // Filter out nulled-out removed photos
    pendingPhotoDataUrls
      .filter(Boolean)
      .forEach(url => newPhotos.push({ url, id: 'p_' + Date.now() + Math.random() }));

  } else if (currentPhotoTab === 'url') {
    // Parse one URL per line from the textarea
    const urls = document.getElementById('photoUrls').value
      .trim().split('\n').map(u => u.trim()).filter(Boolean);
    urls.forEach(url => newPhotos.push({ url, id: 'p_' + Date.now() + Math.random() }));
    document.getElementById('photoUrls').value = '';
  }

  if (newPhotos.length === 0) { showToast('No photos to add.'); return; }

  if (!album.photos) album.photos = [];
  album.photos.push(...newPhotos);

  // Auto-set cover if none exists
  if (!album.cover && newPhotos[0]) album.cover = newPhotos[0].url;

  await saveDb(); // Persist to server before closing panel
  closeAdmin();
  showToast(`Added ${newPhotos.length} photo${newPhotos.length !== 1 ? 's' : ''} to "${album.name}"!`);

  // Re-render if the updated album or its category grid is currently visible
  if (currentAlbumId === albumId) renderAlbumPage();
  if (document.getElementById('categoryPage').classList.contains('active')) renderAlbumsGrid();
}

// -----------------------------------------------------------------------------
// EDIT ALBUM — Additional functions for the Edit Album admin tab
// -----------------------------------------------------------------------------

/**
 * Opens the admin panel directly to the Edit Album tab with a specific album pre-selected.
 * Called from the Edit button on album cards.
 * @param {string} albumId - The album ID to pre-select
 */
function openAdminEditAlbum(albumId) {
  openAdmin('edit');
  setTimeout(() => {
    const sel = document.getElementById('editAlbumSelect');
    if (sel) { sel.value = albumId; loadAlbumForEdit(); }
  }, 0);
}

/**
 * Populates the album selector dropdown in the Edit Album tab.
 */
function populateEditAlbumSelect() {
  const sel = document.getElementById('editAlbumSelect');
  if (!sel) return;
  sel.innerHTML = db.albums.length === 0
    ? '<option value="">— No albums yet —</option>'
    : db.albums.map(a => `<option value="${a.id}">${a.name} (${a.category})</option>`).join('');
  if (currentAlbumId) sel.value = currentAlbumId;
  loadAlbumForEdit();
}

/**
 * Loads the selected album's data into the Edit Album form fields.
 */
function loadAlbumForEdit() {
  const sel     = document.getElementById('editAlbumSelect');
  const albumId = sel ? sel.value : null;
  const fields  = document.getElementById('editAlbumFields');

  if (!albumId) { if (fields) fields.style.display = 'none'; return; }
  const album = db.albums.find(a => a.id === albumId);
  if (!album)  { if (fields) fields.style.display = 'none'; return; }

  fields.style.display = 'block';
  document.getElementById('editAlbumName').value     = album.name     || '';
  document.getElementById('editAlbumCategory').value = album.category || 'sports';
  document.getElementById('editAlbumDate').value     = album.date     || '';
  document.getElementById('editAlbumTags').value     = (album.tags || []).join(', ');

  toggleEditSportGroup();
  if (album.sport) {
    const sportSel = document.getElementById('editAlbumSport');
    if (sportSel) sportSel.value = album.sport;
  }

  const coverImg = document.getElementById('editCoverCurrentImg');
  if (coverImg) coverImg.src = album.cover || '';

  const grid   = document.getElementById('editPhotosGrid');
  const photos = album.photos || [];
  document.getElementById('editPhotoCount').textContent = `(${photos.length})`;

  if (photos.length === 0) {
    grid.innerHTML = '<p style="color:var(--muted);font-size:0.8rem;">No photos yet.</p>';
  } else {
    grid.innerHTML = photos.map(p => `
      <div class="edit-photo-item" id="edit-photo-${p.id}" style="position:relative;">
        <img src="${p.url.replace('upload','thumb')}" alt=""
             style="width:100%;height:80px;object-fit:cover;border-radius:6px;border:1px solid var(--border);cursor:pointer;"
             onclick="setEditCover('${albumId}','${p.url}')">
        <button onclick="removePhotoFromAlbum('${albumId}','${p.id}')"
                style="position:absolute;top:3px;right:3px;background:rgba(0,0,0,0.7);border:none;color:#fff;border-radius:50%;width:20px;height:20px;font-size:0.65rem;cursor:pointer;line-height:1;">✕</button>
      </div>`).join('');
  }

  document.getElementById('editUploadPreview').innerHTML = '';
}

/**
 * Shows/hides the sport selector in the Edit Album form.
 */
function toggleEditSportGroup() {
  const cat = document.getElementById('editAlbumCategory').value;
  document.getElementById('editSportTypeGroup').style.display = cat === 'sports' ? 'block' : 'none';
}

/** Sets the cover of the album being edited to the given photo URL. */
function setEditCover(albumId, url) {
  const album = db.albums.find(a => a.id === albumId);
  if (!album) return;
  album.cover = url;
  document.getElementById('editCoverCurrentImg').src = url;
  showToast('Cover updated — save to confirm.');
}

/** Removes a single photo from an album in the edit panel (in-memory; save to persist). */
function removePhotoFromAlbum(albumId, photoId) {
  const album = db.albums.find(a => a.id === albumId);
  if (!album) return;
  album.photos = (album.photos || []).filter(p => p.id !== photoId);
  const el = document.getElementById(`edit-photo-${photoId}`);
  if (el) el.remove();
  document.getElementById('editPhotoCount').textContent = `(${album.photos.length})`;
  showToast('Photo removed — save to confirm.');
}

/** Handles uploading a new cover image while editing an album. */
async function handleEditCoverUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('photos', file);
  const res  = await fetch('/api/upload', { method: 'POST', body: formData });
  const data = await res.json();
  const url  = data.urls[0];
  document.getElementById('editCoverCurrentImg').src = url;
  const sel   = document.getElementById('editAlbumSelect');
  const album = db.albums.find(a => a.id === sel?.value);
  if (album) album.cover = url;
  showToast('Cover image updated — save to confirm.');
}

/** Handles uploading additional photos while editing an album. */
async function handleEditMorePhotos(e) {
  const files   = Array.from(e.target.files);
  const preview = document.getElementById('editUploadPreview');
  const sel     = document.getElementById('editAlbumSelect');
  const album   = db.albums.find(a => a.id === sel?.value);
  if (!album) { showToast('No album selected.'); return; }

  for (const file of files) {
    const formData = new FormData();
    formData.append('photos', file);
    const res  = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();
    data.urls.forEach(url => {
      album.photos.push({ url, id: 'p_' + Date.now() + Math.random() });
      if (!album.cover) album.cover = url;
      const item = document.createElement('div');
      item.className = 'upload-preview-item';
      item.innerHTML = `<img src="${url}" alt="">`;
      preview.appendChild(item);
    });
  }
  document.getElementById('editPhotoCount').textContent = `(${album.photos.length})`;
  showToast('Photos staged — save to confirm.');
}

/** Saves all edits from the Edit Album tab back to the database. */
async function saveAlbumEdits() {
  const sel   = document.getElementById('editAlbumSelect');
  const album = db.albums.find(a => a.id === sel?.value);
  if (!album) { showToast('No album selected.'); return; }

  const category = document.getElementById('editAlbumCategory').value;
  album.name     = document.getElementById('editAlbumName').value.trim() || album.name;
  album.category = category;
  album.sport    = category === 'sports' ? document.getElementById('editAlbumSport').value : null;
  album.date     = document.getElementById('editAlbumDate').value;
  const tagsRaw  = document.getElementById('editAlbumTags').value;
  album.tags     = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];

  await saveDb();
  closeAdmin();
  showToast(`Album "${album.name}" saved!`);

  if (currentAlbumId === album.id) renderAlbumPage();
  if (document.getElementById('categoryPage').classList.contains('active')) renderAlbumsGrid();
  if (document.getElementById('homePage').classList.contains('active'))    { updateStats(); updateCounts(); }
}

/** Deletes the currently selected album from the database after confirmation. */
async function deleteAlbum() {
  const sel   = document.getElementById('editAlbumSelect');
  const album = db.albums.find(a => a.id === sel?.value);
  if (!album) return;
  if (!confirm(`Delete album "${album.name}"? This cannot be undone.`)) return;
  db.albums = db.albums.filter(a => a.id !== album.id);
  await saveDb();
  closeAdmin();
  showToast(`Album "${album.name}" deleted.`);
  showHome();
}

// -----------------------------------------------------------------------------
// SHARING — Copyable album links via URL hash routing
// -----------------------------------------------------------------------------

/** Shares the currently open album (calls shareAlbumById with currentAlbumId). */
function shareAlbum() {
  shareAlbumById(currentAlbumId);
}

/**
 * Copies a shareable URL for the given album to the clipboard.
 * URL format: https://ajbphotographs.com/#album/<albumId>
 *
 * @param {string} albumId - The album's unique ID
 */
function shareAlbumById(albumId) {
  const album = db.albums.find(a => a.id === albumId);
  if (!album) return;

  const url = `${location.origin}${location.pathname}#album/${albumId}`;

  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => showToast('Album link copied to clipboard!'));
  } else {
    // Fallback for browsers without Clipboard API
    prompt('Copy this link:', url);
  }
}

/**
 * Handles URL hash changes for deep-linked album sharing.
 * Format: #album/<albumId>
 *
 * If the hash matches a known album ID, navigate directly to that album.
 * Otherwise, fall back to the home page.
 */
function handleHash() {
  const hash = location.hash;
  if (hash.startsWith('#album/')) {
    const albumId = hash.replace('#album/', '');
    const album   = db.albums.find(a => a.id === albumId);
    if (album) { showAlbum(albumId); return; }
  }
  showHome();
}

// Re-run hash handling when the URL fragment changes (e.g. back/forward navigation)
window.addEventListener('hashchange', handleHash);

// -----------------------------------------------------------------------------
// STATS — Live counters in the About section
// -----------------------------------------------------------------------------

/**
 * Updates the live stat counters in the About section:
 *   - Total album count
 *   - Total photo count across all albums
 */
function updateStats() {
  const total = db.albums.reduce((acc, a) => acc + (a.photos || []).length, 0);
  document.getElementById('stat-albums').textContent = db.albums.length;
  document.getElementById('stat-photos').textContent = total;
}

/**
 * Updates the album count label on each category card on the home page.
 * e.g. "Sports" shows "3 albums" based on current db state.
 */
function updateCounts() {
  ['sports', 'automotive', 'portraits', 'environmental', 'events'].forEach(cat => {
    const count = db.albums.filter(a => a.category === cat).length;
    const el    = document.getElementById(`${cat}-count`);
    if (el) el.textContent = `${count} album${count !== 1 ? 's' : ''}`;
  });
}

// -----------------------------------------------------------------------------
// TOAST NOTIFICATION
// -----------------------------------------------------------------------------

/**
 * Shows a temporary toast notification at the bottom of the screen.
 * Automatically hides after 3 seconds.
 *
 * @param {string} msg - The message to display in the toast
 */
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// -----------------------------------------------------------------------------
// BROKEN IMAGE HANDLER
// -----------------------------------------------------------------------------

/**
 * Listens for image load errors across the entire document (capture phase
 * so it fires before the error propagates to individual elements).
 *
 * When a /uploads/ image returns a 404, its container element is hidden
 * rather than leaving a broken placeholder visible to users.
 *
 * Note: This does NOT modify the database. It only hides the broken element
 * from the current DOM. Orphaned photo references remain in db.json and can
 * be cleaned up manually if needed.
 */
document.addEventListener('error', function(e) {
  if (e.target.tagName !== 'IMG') return;
  const src = e.target.getAttribute('src');
  if (!src || !src.startsWith('/uploads/')) return;

  // Hide the closest known container, or just the image itself
  const container = e.target.closest('.photo-item, .album-card, .upload-preview-item');
  if (container) container.style.display = 'none';
  else           e.target.style.display  = 'none';
}, true); // true = capture phase, ensures this fires for all images

// -----------------------------------------------------------------------------
// INITIALIZATION
// -----------------------------------------------------------------------------

/**
 * Application entry point — runs once when the page loads.
 *
 * Execution order:
 *   1. Load database from server
 *   2. Check if current visitor is on local network (for admin UI visibility)
 *   3. Initialize sport group visibility
 *   4. Handle URL hash for direct album links
 *   5. Show home page if no hash is present
 */
(async () => {
  // Step 1 — Hydrate db from server before rendering anything
  await loadDb();

  // Step 2 — Ask server if this visitor is on the local network
  const { admin } = await fetch('/api/is-admin').then(r => r.json());
  isAdmin = admin;

  if (!admin) {
    // External visitor — hide static admin controls present at page load
    document.querySelectorAll('[onclick*="openAdmin"], [onclick*="Admin"]')
      .forEach(el => el.style.display = 'none');
  }

  // Step 3 — Initialize sport selector visibility based on default category
  toggleSportGroup();

  // Step 4 — Navigate to album if URL hash is present (e.g. shared link)
  handleHash();

  // Step 5 — Default to home page if no hash
  if (!location.hash || location.hash === '#') showHome();
})();