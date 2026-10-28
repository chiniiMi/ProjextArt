import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { DatabaseSync } from 'node:sqlite';
import { decodeBase32Secret, findValidTotpCounter } from './totp.js';

const app = express();
const port = process.env.PORT || 3001;
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(currentDirectory, '..');
const dataDirectory = path.resolve(process.env.DATA_DIRECTORY || path.join(projectDirectory, 'data'));
const uploadDirectory = path.resolve(process.env.UPLOAD_DIRECTORY || path.join(dataDirectory, 'uploads'));
const databasePath = path.resolve(process.env.DATABASE_PATH || path.join(dataDirectory, 'library.sqlite'));
const totpSecret = process.env.TOTP_SECRET ? decodeBase32Secret(process.env.TOTP_SECRET) : null;
const adminUsername = process.env.ADMIN_USERNAME || '';
const adminPassword = process.env.ADMIN_PASSWORD || '';
const adminAuthenticationEnabled = Boolean(totpSecret && adminUsername && adminPassword);
const maximumFileSize = 20 * 1024 * 1024;
const maximumFiles = 30;
const adminSessionLifetimeMs = 10 * 60 * 1000;
const adminCookieName = 'projextart_admin';
const adminSessions = new Map();
const loginFailures = new Map();
let lastAcceptedTotpCounter = -1;
const allowedTypes = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.pdf', 'application/pdf'],
]);

mkdirSync(path.dirname(databasePath), { recursive: true });
mkdirSync(uploadDirectory, { recursive: true });

const database = new DatabaseSync(databasePath);
database.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('Artwork', 'Comic', 'Other')),
    section TEXT NOT NULL DEFAULT 'gallery' CHECK (section IN ('gallery', 'comics', 'books')),
    is_locked INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0, 1)),
    year TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    alt_text TEXT NOT NULL DEFAULT '',
    shape TEXT NOT NULL DEFAULT 'portrait',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    original_name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS files_item_id_position ON files(item_id, position);
`);

const itemColumns = new Set(database.prepare('PRAGMA table_info(items)').all().map((column) => column.name));
if (!itemColumns.has('section')) {
  database.exec("ALTER TABLE items ADD COLUMN section TEXT NOT NULL DEFAULT 'gallery' CHECK (section IN ('gallery', 'comics', 'books'))");
}
if (!itemColumns.has('is_locked')) {
  database.exec('ALTER TABLE items ADD COLUMN is_locked INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0, 1))');
}
database.prepare("UPDATE items SET section = 'comics' WHERE category = 'Comic' AND section = 'gallery'").run();

function runTransaction(operation) {
  database.exec('BEGIN');
  try {
    operation();
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

const sampleItems = [
  {
    id: 'blue-hour',
    title: 'The Blue Hour',
    category: 'Artwork',
    year: '2025',
    description: 'Oil and cold wax on linen',
    altText: 'Expressive painted portrait in deep blue and warm red tones',
    shape: 'portrait',
    image: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?auto=format&fit=crop&w=1200&q=85',
  },
  {
    id: 'soft-geometry',
    title: 'Soft Geometry',
    category: 'Artwork',
    year: '2025',
    description: 'Archival pigment print',
    altText: 'Colorful modern abstract painting with bold geometric shapes',
    shape: 'landscape',
    image: 'https://images.unsplash.com/photo-1541961017774-22349e4a1262?auto=format&fit=crop&w=1200&q=85',
  },
  {
    id: 'garden-study',
    title: 'Garden Study No. 4',
    category: 'Artwork',
    year: '2024',
    description: 'Gouache and graphite on paper',
    altText: 'Layered abstract artwork with vivid green and yellow brushwork',
    shape: 'square',
    image: 'https://images.unsplash.com/photo-1578301978693-85fa9c0320b9?auto=format&fit=crop&w=1200&q=85',
  },
  {
    id: 'slow-sunday',
    title: 'A Slow Sunday',
    category: 'Artwork',
    year: '2024',
    description: 'Acrylic on canvas',
    altText: 'Warm-toned abstract painting with gestural marks',
    shape: 'portrait',
    image: 'https://images.unsplash.com/photo-1577083552431-6e5fd01aa342?auto=format&fit=crop&w=1200&q=85',
  },
];

const itemCount = database.prepare('SELECT COUNT(*) AS count FROM items').get().count;
if (itemCount === 0) {
  const insertItem = database.prepare(`
    INSERT INTO items (id, title, category, year, description, alt_text, shape)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertFile = database.prepare(`
    INSERT INTO files (id, item_id, url, mime_type, original_name, position)
    VALUES (?, ?, ?, ?, ?, 0)
  `);
  runTransaction(() => {
    for (const item of sampleItems) {
      insertItem.run(item.id, item.title, item.category, item.year, item.description, item.altText, item.shape);
      insertFile.run(randomUUID(), item.id, item.image, 'image/jpeg', item.title);
    }
  });
}

const selectItems = database.prepare(`
  SELECT items.id, items.title, items.category, items.year, items.description,
         items.section, items.is_locked AS isLocked,
         items.alt_text AS altText, items.shape, items.created_at AS createdAt,
         files.url, files.mime_type AS mimeType, files.original_name AS originalName,
         files.position
  FROM items
  LEFT JOIN files ON files.item_id = items.id
  ORDER BY items.created_at DESC, items.rowid DESC, files.position ASC
`);

function getItems({ includeLockedFiles = false } = {}) {
  const items = new Map();
  for (const row of selectItems.all()) {
    let item = items.get(row.id);
    if (!item) {
      item = {
        id: row.id,
        title: row.title,
        category: row.section === 'books' ? 'Book' : row.category,
        section: row.section,
        isLocked: Boolean(row.isLocked),
        year: row.year,
        description: row.description,
        medium: row.description,
        alt: row.altText || row.title,
        shape: row.shape,
        createdAt: row.createdAt,
        files: [],
        image: '',
      };
      items.set(row.id, item);
    }
    if (row.url && (!item.isLocked || includeLockedFiles)) {
      const file = {
        url: row.url.startsWith('/') ? row.url : row.url,
        mimeType: row.mimeType,
        originalName: row.originalName,
      };
      item.files.push(file);
      if (!item.image && row.mimeType.startsWith('image/')) item.image = row.url;
    }
  }
  return [...items.values()];
}

const storage = multer.diskStorage({
  destination: (_request, _file, callback) => callback(null, uploadDirectory),
  filename: (_request, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    callback(null, `${randomUUID()}${extension}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: maximumFileSize, files: maximumFiles, fields: 6, fieldSize: 2000 },
  fileFilter: (_request, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.get(extension) !== file.mimetype) {
      callback(Object.assign(new Error('Upload JPG, PNG, GIF, WEBP, or PDF files with a matching file type.'), { status: 400 }));
      return;
    }
    callback(null, true);
  },
});

function getAdminSession(request) {
  const cookies = request.headers.cookie?.split(';') || [];
  const sessionCookie = cookies
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${adminCookieName}=`));
  if (!sessionCookie) return null;

  const sessionId = sessionCookie.slice(adminCookieName.length + 1);
  const expiresAt = adminSessions.get(sessionId);
  if (!expiresAt || expiresAt <= Date.now()) {
    adminSessions.delete(sessionId);
    return null;
  }
  return { sessionId, expiresAt };
}

function refreshAdminSession(sessionId, response) {
  const expiresAt = Date.now() + adminSessionLifetimeMs;
  adminSessions.set(sessionId, expiresAt);
  const secureCookie = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  response.setHeader('X-Admin-Session-Expires-At', String(expiresAt));
  response.setHeader(
    'Set-Cookie',
    `${adminCookieName}=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${adminSessionLifetimeMs / 1000}${secureCookie}`,
  );
  return expiresAt;
}

function requireAdmin(request, response, next) {
  if (!adminAuthenticationEnabled) {
    response.status(503).json({ error: 'Admin authentication is not configured on the server.' });
    return;
  }

  const session = getAdminSession(request);
  if (!session) {
    response.status(401).json({ error: 'Your admin session expired. Enter a new authenticator code to continue.' });
    return;
  }
  request.adminSessionExpiresAt = refreshAdminSession(session.sessionId, response);
  next();
}

app.get('/api/upload-config', (_request, response) => {
  response.json({ enabled: adminAuthenticationEnabled });
});

app.get('/api/admin/session', (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  const session = getAdminSession(request);
  response.json({
    authenticated: Boolean(session),
    expiresAt: session?.expiresAt || null,
  });
});

app.post('/api/admin/session/activity', requireAdmin, (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.json({
    authenticated: true,
    expiresAt: request.adminSessionExpiresAt,
  });
});

app.post('/api/admin/session', (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (!adminAuthenticationEnabled) {
    response.status(503).json({ error: 'Set ADMIN_USERNAME, ADMIN_PASSWORD, and TOTP_SECRET on the server first.' });
    return;
  }

  const clientAddress = request.ip;
  const now = Date.now();
  const recentFailures = (loginFailures.get(clientAddress) || []).filter((timestamp) => now - timestamp < 5 * 60 * 1000);
  if (recentFailures.length >= 5) {
    response.status(429).json({ error: 'Too many sign-in attempts. Wait five minutes and try again.' });
    return;
  }

  const suppliedUsername = Buffer.from(request.get('x-admin-username') || '');
  const expectedUsername = Buffer.from(adminUsername);
  const suppliedPassword = Buffer.from(request.get('x-admin-password') || '');
  const expectedPassword = Buffer.from(adminPassword);
  const usernameMatches = suppliedUsername.length === expectedUsername.length
    && timingSafeEqual(suppliedUsername, expectedUsername);
  const passwordMatches = suppliedPassword.length === expectedPassword.length
    && timingSafeEqual(suppliedPassword, expectedPassword);
  if (!usernameMatches || !passwordMatches) {
    recentFailures.push(now);
    loginFailures.set(clientAddress, recentFailures);
    response.status(401).json({ error: 'Username or password is incorrect.' });
    return;
  }

  const acceptedCounter = findValidTotpCounter(
    totpSecret,
    request.get('x-totp-code') || '',
    Date.now(),
    lastAcceptedTotpCounter,
  );
  if (acceptedCounter === null) {
    recentFailures.push(now);
    loginFailures.set(clientAddress, recentFailures);
    response.status(401).json({ error: 'The authenticator code is invalid or expired.' });
    return;
  }
  loginFailures.delete(clientAddress);
  lastAcceptedTotpCounter = acceptedCounter;

  const sessionId = randomBytes(32).toString('base64url');
  const expiresAt = refreshAdminSession(sessionId, response);
  response.json({ authenticated: true, expiresAt });
});

app.delete('/api/admin/session', (request, response) => {
  const session = getAdminSession(request);
  if (session) adminSessions.delete(session.sessionId);
  const secureCookie = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  response.setHeader(
    'Set-Cookie',
    `${adminCookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureCookie}`,
  );
  response.json({ authenticated: false });
});

app.get('/api/items', (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.json(getItems({ includeLockedFiles: Boolean(getAdminSession(request)) }));
});

app.get('/api/artworks', (_request, response) => {
  response.json(getItems().filter((item) => item.category === 'Artwork'));
});

app.put('/api/items/:itemId', requireAdmin, express.json({ limit: '10kb' }), (request, response, next) => {
  const { title, year, description = '', isLocked } = request.body;
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 120) {
    response.status(400).json({ error: 'Add a title of 1–120 characters.' });
    return;
  }
  if (typeof year !== 'string' || !year.trim() || year.trim().length > 20) {
    response.status(400).json({ error: 'Add a year or date of up to 20 characters.' });
    return;
  }
  if (typeof description !== 'string' || description.length > 2000) {
    response.status(400).json({ error: 'Description must be 2000 characters or fewer.' });
    return;
  }
  if (typeof isLocked !== 'boolean') {
    response.status(400).json({ error: 'Choose whether this item is locked.' });
    return;
  }

  try {
    const result = database.prepare(`
      UPDATE items
      SET title = ?, year = ?, description = ?, is_locked = ?
      WHERE id = ?
    `).run(title.trim(), year.trim(), description.trim(), Number(isLocked), request.params.itemId);
    if (result.changes === 0) {
      response.status(404).json({ error: 'Gallery item not found.' });
      return;
    }
    response.json(getItems({ includeLockedFiles: true }).find((item) => item.id === request.params.itemId));
  } catch (error) {
    next(error);
  }
});

app.post('/api/items', requireAdmin, upload.array('files', maximumFiles), (request, response, next) => {
  const { title, category, year, description = '', altText = '', locked } = request.body;
  const files = request.files || [];
  if (locked !== undefined && locked !== 'true') {
    next(Object.assign(new Error('The locked setting is invalid.'), { status: 400 }));
    return;
  }
  if (!title?.trim() || title.trim().length > 120) {
    next(Object.assign(new Error('Add a title of 1–120 characters.'), { status: 400 }));
    return;
  }
  if (!['Artwork', 'Comic', 'Other', 'Book'].includes(category)) {
    next(Object.assign(new Error('Choose Artwork, Comic, Other, or Book.'), { status: 400 }));
    return;
  }
  if (!year?.trim() || year.trim().length > 20) {
    next(Object.assign(new Error('Add a year or date of up to 20 characters.'), { status: 400 }));
    return;
  }
  if (!files.length) {
    next(Object.assign(new Error('Choose at least one file to upload.'), { status: 400 }));
    return;
  }
  if (category === 'Comic' && files.some((file) => !file.mimetype.startsWith('image/'))) {
    next(Object.assign(new Error('Comic pages must be image files. Upload each page in reading order.'), { status: 400 }));
    return;
  }

  const section = category === 'Book' ? 'books' : category === 'Comic' ? 'comics' : 'gallery';
  const storedCategory = category === 'Book' ? 'Other' : category;
  const isLocked = locked === 'true';
  const id = randomUUID();
  const insertItem = database.prepare(`
    INSERT INTO items (id, title, category, section, is_locked, year, description, alt_text, shape)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'portrait')
  `);
  const insertFile = database.prepare(`
    INSERT INTO files (id, item_id, url, mime_type, original_name, position)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  try {
    runTransaction(() => {
      insertItem.run(
        id,
        title.trim(),
        storedCategory,
        section,
        Number(isLocked),
        year.trim(),
        description.trim(),
        altText.trim(),
      );
      files.forEach((file, position) => {
        insertFile.run(
          randomUUID(),
          id,
          `/uploads/${path.basename(file.filename)}`,
          file.mimetype,
          path.basename(file.originalname),
          position,
        );
      });
    });
  } catch (error) {
    next(error);
    return;
  }
  response.status(201).json(getItems({ includeLockedFiles: true }).find((item) => item.id === id));
});

app.delete('/api/items/:itemId', requireAdmin, (request, response, next) => {
  const { itemId } = request.params;
  try {
    const uploadedFiles = database.prepare('SELECT url FROM files WHERE item_id = ?').all(itemId);
    const filePaths = uploadedFiles
      .map((file) => file.url)
      .filter((url) => url.startsWith('/uploads/'))
      .map((url) => path.resolve(uploadDirectory, path.basename(url)));

    runTransaction(() => {
      database.prepare('DELETE FROM items WHERE id = ?').run(itemId);
    });

    for (const filePath of filePaths) {
      try {
        unlinkSync(filePath);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }

    response.json({ ok: true, deletedId: itemId });
  } catch (error) {
    next(error);
  }
});

app.use('/api', (_request, response) => {
  response.status(404).json({ error: 'API endpoint not found.' });
});

app.use('/uploads', (request, response, next) => {
  const fileUrl = `/uploads/${path.basename(request.path)}`;
  const file = database.prepare(`
    SELECT items.is_locked AS isLocked
    FROM files
    JOIN items ON items.id = files.item_id
    WHERE files.url = ?
  `).get(fileUrl);
  if (file?.isLocked) {
    response.setHeader('Cache-Control', 'private, no-store');
    requireAdmin(request, response, next);
    return;
  }
  next();
}, express.static(uploadDirectory, { fallthrough: false, index: false }));
app.use(express.static(path.join(projectDirectory, 'dist')));
app.get('/{*path}', (_request, response) => {
  response.sendFile(path.join(projectDirectory, 'dist', 'index.html'));
});

app.use((error, request, response, _next) => {
  let cleanupFailure;
  for (const file of request.files || []) {
    try {
      unlinkSync(file.path);
    } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') cleanupFailure ||= cleanupError;
    }
  }
  const status = cleanupFailure
    ? 500
    : error.code === 'LIMIT_FILE_SIZE'
      ? 413
      : error.status || (error instanceof multer.MulterError ? 400 : 500);
  if (cleanupFailure) console.error('Upload cleanup failed:', cleanupFailure);
  if (status >= 500) console.error('Request failed:', error);
  response.status(status).json({
    error: cleanupFailure
      ? 'The upload failed and temporary files could not be cleaned up.'
      : error.code === 'LIMIT_FILE_SIZE'
        ? 'Each file must be 20 MB or smaller.'
        : error.code === 'LIMIT_FILE_COUNT'
          ? `Upload no more than ${maximumFiles} files at a time.`
          : error.message || 'The request could not be completed.',
  });
});

app.listen(port, () => {
  console.log(`ProjextArt server listening on http://localhost:${port}`);
});
