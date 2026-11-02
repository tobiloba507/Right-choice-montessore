import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const envFile = resolve(root, '.env');
  try {
    const contents = readFileSync(envFile, 'utf8');
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match && process.env[match[1]] === undefined) {
        process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

loadEnv();

const {
  ADMIN_USERNAME,
  ADMIN_PASSWORD_SALT,
  ADMIN_PASSWORD_HASH,
  SESSION_SECRET,
} = process.env;
const isProduction = process.env.NODE_ENV === 'production';
const isRender = process.env.RENDER === 'true';
const host = isRender ? '0.0.0.0' : process.env.HOST || (isProduction ? '0.0.0.0' : '127.0.0.1');
const port = Number(process.env.PORT || 3000);

if (!ADMIN_USERNAME || !ADMIN_PASSWORD_SALT || !ADMIN_PASSWORD_HASH || !SESSION_SECRET) {
  throw new Error('Admin credentials are not configured. Run "npm run setup-admin" first.');
}
if (SESSION_SECRET.length < 32 || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('SESSION_SECRET must be at least 32 characters and PORT must be a valid port.');
}

const dbPath = resolve(root, process.env.DATABASE_PATH || 'data/school.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK (type IN ('admission', 'contact', 'complaint')),
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    child_info TEXT,
    category TEXT,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'archived')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  );
`);

const submissionsSchema = db.prepare(
  "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'submissions'",
).get().sql;
if (!submissionsSchema.includes("'complaint'")) {
  db.exec(`
    BEGIN;
    CREATE TABLE submissions_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK (type IN ('admission', 'contact', 'complaint')),
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      child_info TEXT,
      category TEXT,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'archived')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    INSERT INTO submissions_new (id, type, name, email, phone, child_info, message, status, created_at)
      SELECT id, type, name, email, phone, child_info, message, status, created_at FROM submissions;
    DROP TABLE submissions;
    ALTER TABLE submissions_new RENAME TO submissions;
    COMMIT;
  `);
}
db.exec('CREATE INDEX IF NOT EXISTS submissions_created_at_idx ON submissions(created_at DESC)');

const expectedPasswordHash = Buffer.from(ADMIN_PASSWORD_HASH, 'hex');
if (expectedPasswordHash.length !== 64) {
  throw new Error('The configured admin password hash is invalid. Run "npm run setup-admin" again.');
}

const rateLimits = new Map();
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const SESSION_COOKIE = 'rc_admin';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function getClientKey(request) {
  return request.socket.remoteAddress || 'unknown';
}

function consumeLimit(key, limit, windowMs) {
  const now = Date.now();
  let entry = rateLimits.get(key);
  if (!entry || entry.expiresAt <= now) {
    entry = { count: 0, expiresAt: now + windowMs };
    rateLimits.set(key, entry);
  }
  entry.count += 1;
  if (rateLimits.size > 10000) {
    for (const [entryKey, value] of rateLimits) {
      if (value.expiresAt <= now) rateLimits.delete(entryKey);
    }
  }
  return entry.count <= limit;
}

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  response.end(JSON.stringify(value));
}

function cookieValue(request, name) {
  const cookie = request.headers.cookie || '';
  for (const segment of cookie.split(';')) {
    const [key, ...parts] = segment.trim().split('=');
    if (key === name) return parts.join('=');
  }
  return '';
}

function sessionHash(token) {
  return createHash('sha256').update(`${SESSION_SECRET}:${token}`).digest('hex');
}

function getSession(request) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const session = db.prepare(
    'SELECT token_hash FROM admin_sessions WHERE token_hash = ? AND expires_at > ?',
  ).get(sessionHash(token), Math.floor(Date.now() / 1000));
  return session || null;
}

function requireSameOrigin(request) {
  const origin = request.headers.origin;
  const hostHeader = request.headers.host;
  if (!origin || !hostHeader) {
    throw new HttpError(403, 'Request origin could not be verified.');
  }
  let originUrl;
  try {
    originUrl = new URL(origin);
  } catch {
    throw new HttpError(403, 'Request origin could not be verified.');
  }
  if (originUrl.host !== hostHeader || !['http:', 'https:'].includes(originUrl.protocol)) {
    throw new HttpError(403, 'Cross-site requests are not allowed.');
  }
}

async function readJson(request) {
  const contentType = request.headers['content-type'] || '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'Send the form as JSON.');
  }
  const contentLength = Number(request.headers['content-length'] || 0);
  if (contentLength > 12000) throw new HttpError(413, 'Your message is too large.');

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 12000) throw new HttpError(413, 'Your message is too large.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'The submitted form could not be read.');
  }
}

function requiredText(value, label, maxLength) {
  if (typeof value !== 'string') throw new HttpError(400, `${label} is required.`);
  const clean = value.trim();
  if (!clean || clean.length > maxLength) {
    throw new HttpError(400, `${label} is required and must be no more than ${maxLength} characters.`);
  }
  return clean;
}

function validateSubmission(body) {
  if (!body || !['admission', 'contact', 'complaint'].includes(body.type) || !body.fields || typeof body.fields !== 'object') {
    throw new HttpError(400, 'The submitted form is invalid.');
  }

  const fields = body.fields;
  if (typeof fields.website === 'string' && fields.website.trim()) {
    throw new HttpError(400, 'The submitted form is invalid.');
  }

  const isAdmission = body.type === 'admission';
  const name = requiredText(isAdmission ? fields.parentName : fields.name, 'Name', 100);
  const email = requiredText(isAdmission ? fields.email : fields.contactEmail, 'Email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  const message = requiredText(fields.message, 'Message', 4000);
  const phone = isAdmission ? requiredText(fields.phone, 'Phone number', 40) : null;
  const childInfo = isAdmission ? requiredText(fields.childInfo, 'Child age or class', 100) : null;
  const category = body.type === 'complaint'
    ? requiredText(fields.category, 'Concern topic', 60)
    : null;
  if (category && !['Learning and classroom', 'Communication', 'Student wellbeing', 'Facilities', 'Other'].includes(category)) {
    throw new HttpError(400, 'Choose a valid concern topic.');
  }

  return { type: body.type, name, email, phone, childInfo, category, message };
}

function passwordMatches(password) {
  if (typeof password !== 'string' || password.length > 1024) return false;
  const submittedHash = scryptSync(password, ADMIN_PASSWORD_SALT, 64);
  return timingSafeEqual(expectedPasswordHash, submittedHash);
}

function cookieHeader(token, maxAge) {
  const secure = isProduction ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
};

function sendFile(response, filename, noStore = false) {
  const file = resolve(root, filename);
  const contents = readFileSync(file);
  response.writeHead(200, {
    'Content-Type': contentTypes[extname(file)] || 'application/octet-stream',
    'Cache-Control': noStore ? 'no-store' : 'no-cache',
  });
  response.end(contents);
}

function secureHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  );
}

async function handleRequest(request, response) {
  secureHeaders(response);
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

  if (request.method === 'GET' && url.pathname === '/') {
    return sendFile(response, 'index.html');
  }
  if (request.method === 'GET' && url.pathname === '/Rigth.css') {
    return sendFile(response, 'Rigth.css');
  }
  if (request.method === 'GET' && url.pathname === '/Right.js') {
    return sendFile(response, 'Right.js');
  }
  if (request.method === 'GET' && url.pathname === '/school-logo.png') {
    return sendFile(response, 'school-logo.png');
  }
  if (request.method === 'GET' && url.pathname === '/admin/login') {
    if (getSession(request)) {
      response.writeHead(303, { Location: '/admin' });
      return response.end();
    }
    return sendFile(response, 'admin-login.html');
  }
  if (request.method === 'GET' && url.pathname === '/admin') {
    if (!getSession(request)) {
      response.writeHead(303, { Location: '/admin/login' });
      return response.end();
    }
    return sendFile(response, 'admin.html', true);
  }
  if (request.method === 'GET' && url.pathname === '/admin.js') {
    return sendFile(response, 'admin.js');
  }

  if (request.method === 'POST' && url.pathname === '/api/submissions') {
    requireSameOrigin(request);
    if (!consumeLimit(`submission:${getClientKey(request)}`, 8, 15 * 60 * 1000)) {
      throw new HttpError(429, 'Too many submissions. Please wait a while and try again.');
    }
    const submission = validateSubmission(await readJson(request));
    const result = db.prepare(`
      INSERT INTO submissions (type, name, email, phone, child_info, category, message)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      submission.type,
      submission.name,
      submission.email,
      submission.phone,
      submission.childInfo,
      submission.category,
      submission.message,
    );
    return sendJson(response, 201, { ok: true, id: Number(result.lastInsertRowid) });
  }

  if (request.method === 'POST' && url.pathname === '/api/admin/login') {
    requireSameOrigin(request);
    const key = `login:${getClientKey(request)}`;
    if (!consumeLimit(key, 5, 15 * 60 * 1000)) {
      throw new HttpError(429, 'Too many sign-in attempts. Please wait 15 minutes and try again.');
    }
    const body = await readJson(request);
    const username = typeof body.username === 'string' ? body.username : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const usernameMatches = username.length <= 64 && username === ADMIN_USERNAME;
    const passwordValid = passwordMatches(password);
    if (!usernameMatches || !passwordValid) {
      throw new HttpError(401, 'Username or password is incorrect.');
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
    db.prepare('INSERT INTO admin_sessions (token_hash, expires_at) VALUES (?, ?)').run(sessionHash(token), expiresAt);
    db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').run(Math.floor(Date.now() / 1000));
    return sendJson(response, 200, { ok: true }, {
      'Set-Cookie': cookieHeader(token, SESSION_TTL_SECONDS),
    });
  }

  if (request.method === 'GET' && url.pathname === '/api/admin/session') {
    if (!getSession(request)) throw new HttpError(401, 'Sign in required.');
    return sendJson(response, 200, { ok: true, username: ADMIN_USERNAME });
  }

  if (request.method === 'POST' && url.pathname === '/api/admin/logout') {
    requireSameOrigin(request);
    const token = cookieValue(request, SESSION_COOKIE);
    if (token) db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(sessionHash(token));
    return sendJson(response, 200, { ok: true }, { 'Set-Cookie': cookieHeader('', 0) });
  }

  if (request.method === 'GET' && url.pathname === '/api/admin/submissions') {
    if (!getSession(request)) throw new HttpError(401, 'Sign in required.');
    const submissions = db.prepare(`
      SELECT id, type, name, email, phone, child_info AS childInfo, category, message, status, created_at AS createdAt
      FROM submissions
      ORDER BY created_at DESC
      LIMIT 500
    `).all();
    return sendJson(response, 200, { submissions });
  }

  const statusMatch = url.pathname.match(/^\/api\/admin\/submissions\/(\d+)$/);
  if (request.method === 'PATCH' && statusMatch) {
    requireSameOrigin(request);
    if (!getSession(request)) throw new HttpError(401, 'Sign in required.');
    const body = await readJson(request);
    if (!['new', 'contacted', 'archived'].includes(body.status)) {
      throw new HttpError(400, 'Choose a valid submission status.');
    }
    const result = db.prepare('UPDATE submissions SET status = ? WHERE id = ?').run(body.status, Number(statusMatch[1]));
    if (result.changes === 0) throw new HttpError(404, 'Submission not found.');
    return sendJson(response, 200, { ok: true });
  }

  return sendJson(response, 404, { error: 'Page not found.' });
}

const server = createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) console.error(error);
    sendJson(response, status, {
      error: status === 500 ? 'A server error occurred. Please try again later.' : error.message,
    });
  });
});

server.listen(port, host, () => {
  console.log(`Right Choice Montessori site listening at http://${host}:${port}`);
  console.log('Admin sign-in: /admin/login');
});

function closeServer() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', closeServer);
process.on('SIGTERM', closeServer);
