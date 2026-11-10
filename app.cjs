'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const sea = require('node:sea');
const { lookup, detail } = require('./metadata.cjs');

const VERSION = require('./package.json').version;
const APPEARANCE = {
  banner: 'Movies of Interest', tagline: 'Your next great watch starts here.',
  background: '#10141c', accent: '#e8c782', backgroundImage: '',
  layout: 'grid', theme: 'dark', font: 'modern', cardSize: 'medium', corners: 'rounded',
  backgroundOpacity: 15, backgroundBlur: 0, songLabsLogo: 'color', showStats: true,
};
const DEFAULTS = { ...APPEARANCE, country: 'US', tmdbToken: '' };
const CHOICES = {
  layout: ['grid', 'list', 'details'], theme: ['dark', 'light'], font: ['modern', 'classic', 'condensed', 'typewriter'],
  cardSize: ['small', 'medium', 'large'], corners: ['rounded', 'soft', 'square'], songLabsLogo: ['color', 'mono', 'hidden'],
};
const RANGES = { backgroundOpacity: [0, 100], backgroundBlur: [0, 20] };
// Each entry upgrades the schema by one PRAGMA user_version step; never edit released steps, only append.
const MIGRATIONS = [
  db => db.exec(`CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, source_id TEXT NOT NULL,
      title TEXT NOT NULL, kind TEXT NOT NULL, year INTEGER, rating REAL,
      metadata TEXT NOT NULL, added_at TEXT NOT NULL, viewed INTEGER NOT NULL DEFAULT 0,
      viewed_at TEXT, notes TEXT NOT NULL DEFAULT '', UNIQUE(source, source_id));
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`),
  db => db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);'),
];
const KEEP_BACKUPS = 5;
const SERVICES = [
  ['Netflix', 'https://www.netflix.com/search?q='],
  ['Hulu', 'https://www.hulu.com/search?q='],
  ['Peacock', 'https://www.peacocktv.com/search?q='],
  ['Prime Video', 'https://www.amazon.com/gp/video/search?phrase='],
  ['Disney+', 'https://www.disneyplus.com/search?q='],
  ['Apple TV', 'https://tv.apple.com/search?term='],
  ['HBO Max', 'https://www.hbomax.com/search?q='],
  ['YouTube', 'https://www.youtube.com/results?search_query='],
];
class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function asset(name) {
  return sea.isSea() ? Buffer.from(sea.getAsset(name)) : fs.readFileSync(path.join(__dirname, 'public', name));
}
function openBrowser(url) {
  const child = process.platform === 'win32'
    ? spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' })
    : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' });
  child.on('error', error => console.error('Unable to open browser:', error.message));
  child.unref();
}
function text(value, name, max = 200, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw new ApiError(400, `Invalid ${name}.`);
  }
  return value.trim();
}
function identifier(value) {
  if (!/^[1-9]\d*$/.test(String(value))) throw new ApiError(400, 'Invalid entry ID.');
  return Number(value);
}
async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8 * 1024 * 1024) throw new ApiError(413, 'Upload exceeds 8 MB.');
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch { throw new ApiError(400, 'Request must be a JSON object.'); }
}
function validSetting(key, value) {
  if (['banner', 'tagline'].includes(key)) return text(value, key, 120, key === 'banner');
  if (['background', 'accent'].includes(key)) {
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new ApiError(400, 'Invalid color.');
    return value;
  }
  if (key === 'country') {
    if (typeof value !== 'string' || !/^[A-Z]{2}$/.test(value)) throw new ApiError(400, 'Country must be a two-letter uppercase code.');
    return value;
  }
  if (Object.hasOwn(CHOICES, key)) {
    if (!CHOICES[key].includes(value)) throw new ApiError(400, `Invalid ${key}.`);
    return value;
  }
  if (Object.hasOwn(RANGES, key)) {
    const [min, max] = RANGES[key];
    if (!Number.isInteger(value) || value < min || value > max) throw new ApiError(400, `${key} must be a whole number from ${min} to ${max}.`);
    return value;
  }
  if (key === 'showStats') {
    if (typeof value !== 'boolean') throw new ApiError(400, 'Invalid showStats.');
    return value;
  }
  if (key === 'backgroundImage') return validateImage(value);
  if (key === 'tmdbToken') return text(value, 'TMDB credential', 1000);
  throw new ApiError(400, 'Unknown setting.');
}
function validateImage(value) {
  if (value === '') return value;
  if (typeof value !== 'string') throw new ApiError(400, 'Invalid background image.');
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match || match[2].length > 7 * 1024 * 1024) throw new ApiError(400, 'Choose a PNG, JPEG or WebP image under 5 MB.');
  const bytes = Buffer.from(match[2], 'base64');
  const valid = (match[1] === 'png' && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
    || (match[1] === 'jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    || (match[1] === 'webp' && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP');
  if (!valid || bytes.length > 5 * 1024 * 1024) throw new ApiError(400, 'Image content does not match its format or exceeds 5 MB.');
  return value;
}
function openLibrary(dbPath) {
  const existed = fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0;
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    const schema = db.prepare('PRAGMA user_version').get().user_version;
    if (schema > MIGRATIONS.length) {
      throw new Error(`This library was saved by a newer version of Movies of Interest (schema ${schema}). Install the latest release; your data is unchanged.`);
    }
    const hasMeta = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='meta'").get();
    const hasEntries = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='entries'").get();
    const previous = hasMeta ? db.prepare("SELECT value FROM meta WHERE key='appVersion'").get()?.value : (hasEntries ? '1.0' : undefined);
    if (existed && hasEntries && (previous !== VERSION || schema < MIGRATIONS.length)) backupLibrary(db, dbPath, previous || 'unknown');
    for (let step = schema; step < MIGRATIONS.length; step++) {
      db.exec('BEGIN');
      try {
        MIGRATIONS[step](db);
        db.exec(`PRAGMA user_version=${step + 1}`);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    db.prepare("INSERT INTO meta(key,value) VALUES('appVersion',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(VERSION);
    return db;
  } catch (error) { db.close(); throw error; }
}
function backupLibrary(db, dbPath, previous) {
  const folder = path.join(path.dirname(dbPath), 'backups');
  fs.mkdirSync(folder, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const label = String(previous).replace(/[^0-9A-Za-z.-]/g, '');
  db.prepare('VACUUM INTO ?').run(path.join(folder, `library-v${label}-before-v${VERSION}-${stamp}.db`));
  const old = fs.readdirSync(folder).filter(name => /^library-.*\.db$/.test(name))
    .map(name => ({ name, time: fs.statSync(path.join(folder, name)).mtimeMs })).sort((a, b) => b.time - a.time);
  for (const item of old.slice(KEEP_BACKUPS)) fs.unlinkSync(path.join(folder, item.name));
}
function defaultDataDir() {
  return process.env.MOI_DATA_DIR || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'MoviesOfInterest');
}
function createApp(options = {}) {
  const dataDir = options.dataDir || defaultDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'library.db');
  const db = openLibrary(dbPath);
  const token = crypto.randomBytes(32).toString('hex');
  let closing = false;
  let origin = '';
  function settings(includeSecret = false) {
    const result = { ...DEFAULTS };
    for (const row of db.prepare('SELECT key,value FROM settings').all()) {
      if (!Object.hasOwn(DEFAULTS, row.key)) continue;
      try { result[row.key] = validSetting(row.key, JSON.parse(row.value)); } catch { /* keep default for unusable stored values */ }
    }
    result.hasTmdbToken = Boolean(result.tmdbToken);
    if (!includeSecret) delete result.tmdbToken;
    return result;
  }
  function entries() {
    return db.prepare('SELECT * FROM entries ORDER BY id ASC').all().map(row => ({
      ...JSON.parse(row.metadata), id: row.id, title: row.title, kind: row.kind,
      year: row.year, rating: row.rating, addedAt: row.added_at,
      viewed: Boolean(row.viewed), viewedAt: row.viewed_at, notes: row.notes,
      serviceLinks: SERVICES.map(([name, base]) => ({ name, url: base + encodeURIComponent(row.title), verified: false })),
    }));
  }
  function send(res, status, value, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value));
  }
  function existing(id) {
    const row = db.prepare('SELECT * FROM entries WHERE id=?').get(id);
    if (!row) throw new ApiError(404, 'Entry not found.');
    return row;
  }
  function shutdown() {
    if (closing) return;
    closing = true;
    server.close(() => { db.close(); options.onClose?.(); });
    server.closeIdleConnections();
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      if (closing) throw new ApiError(503, 'Server is shutting down.');
      if (req.headers.host !== new URL(origin).host) throw new ApiError(403, 'Unrecognized host.');
      if (req.headers.origin && req.headers.origin !== origin) throw new ApiError(403, 'Cross-origin request denied.');
      const url = new URL(req.url, origin);
      const route = url.pathname;
      const method = req.method;
      if (route.startsWith('/api/') && !(route === '/api/health' && method === 'GET')) {
        if (req.headers['x-moi-token'] !== token) throw new ApiError(403, 'Reload the local application to authenticate.');
      }
      if (method === 'GET' && route === '/api/health') return send(res, 200, { app: 'Movies of Interest', version: VERSION });
      if (method === 'GET' && route === '/api/state') {
        return send(res, 200, { entries: entries(), settings: settings(), defaults: APPEARANCE, choices: CHOICES, version: VERSION, dataDir, installed: fs.existsSync(path.join(path.dirname(process.execPath), 'unins000.exe')) });
      }
      if (method === 'GET' && route === '/api/search') {
        const query = text(url.searchParams.get('q'), 'title', 160, true);
        const kind = url.searchParams.get('kind');
        if (!['movie', 'tv'].includes(kind)) throw new ApiError(400, 'Choose movie or TV show.');
        return send(res, 200, await (options.lookup || lookup)(query, kind, settings(true)));
      }
      if (method === 'POST' && route === '/api/entries') {
        const input = await body(req);
        let item;
        if (input.source === 'manual') {
          item = { source: 'manual', sourceId: crypto.randomUUID(), title: text(input.title, 'title', 200, true),
            kind: input.kind, year: null, rating: null, genres: [], cast: [], directors: [], summary: '',
            poster: '', imdb: '', sourceUrl: '', providers: [], metadataWarning: 'Added manually. Online metadata has not been retrieved.' };
          if (!['movie', 'tv'].includes(item.kind)) throw new ApiError(400, 'Invalid media type.');
        } else {
          const source = text(input.source, 'metadata source', 30, true);
          const sourceId = text(input.sourceId, 'metadata ID', 200, true);
          if (!['movie', 'tv'].includes(input.kind)) throw new ApiError(400, 'Invalid media type.');
          item = await (options.detail || detail)(source, sourceId, input.kind, settings(true));
        }
        try {
          const result = db.prepare('INSERT INTO entries(source,source_id,title,kind,year,rating,metadata,added_at) VALUES(?,?,?,?,?,?,?,?)')
            .run(item.source, item.sourceId, item.title, item.kind, item.year, item.rating, JSON.stringify(item), new Date().toISOString());
          return send(res, 201, { id: Number(result.lastInsertRowid) });
        } catch (error) {
          if (error.message.includes('UNIQUE constraint failed')) throw new ApiError(409, 'This title is already in your library.');
          throw error;
        }
      }
      const match = /^\/api\/entries\/([1-9]\d*)(\/refresh)?$/.exec(route);
      if (match) {
        const id = identifier(match[1]);
        const row = existing(id);
        if (method === 'POST' && match[2]) {
          if (row.source === 'manual') throw new ApiError(400, 'Manual entries cannot be refreshed. Search and add the matched title instead.');
          const item = await (options.detail || detail)(row.source, row.source_id, row.kind, settings(true));
          db.prepare('UPDATE entries SET title=?,year=?,rating=?,metadata=? WHERE id=?').run(item.title, item.year, item.rating, JSON.stringify(item), id);
          return send(res, 200, { ok: true });
        }
        if (method === 'PATCH' && !match[2]) {
          const input = await body(req);
          if (input.viewed !== undefined && typeof input.viewed !== 'boolean') throw new ApiError(400, 'Viewed must be true or false.');
          const viewed = input.viewed === undefined ? Boolean(row.viewed) : input.viewed;
          const viewedAt = viewed ? (row.viewed_at || new Date().toISOString()) : null;
          const notes = input.notes === undefined ? row.notes : text(input.notes, 'notes', 4000);
          db.prepare('UPDATE entries SET viewed=?,viewed_at=?,notes=? WHERE id=?').run(Number(viewed), viewedAt, notes, id);
          return send(res, 200, { ok: true });
        }
        if (method === 'DELETE' && !match[2]) {
          db.prepare('DELETE FROM entries WHERE id=?').run(id);
          return send(res, 200, { ok: true });
        }
      }
      if (method === 'PUT' && route === '/api/settings') {
        const input = await body(req);
        const update = {};
        for (const [key, value] of Object.entries(input)) {
          if (!Object.hasOwn(DEFAULTS, key)) throw new ApiError(400, 'Unknown setting.');
          update[key] = validSetting(key, value);
        }
        db.exec('BEGIN');
        try {
          const statement = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
          for (const [key, value] of Object.entries(update)) statement.run(key, JSON.stringify(value));
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return send(res, 200, { settings: settings() });
      }
      if (method === 'GET' && route === '/api/export') {
        const format = url.searchParams.get('format');
        if (format === 'sqlite') {
          // VACUUM INTO makes a consistent standalone backup while WAL remains active.
          const backup = path.join(dataDir, `export-${crypto.randomUUID()}.db`);
          try {
            db.prepare('VACUUM INTO ?').run(backup);
            const clean = new DatabaseSync(backup);
            clean.prepare('DELETE FROM settings WHERE key=?').run('tmdbToken');
            clean.exec('VACUUM');
            clean.close();
            return send(res, 200, fs.readFileSync(backup), { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="movies-of-interest.db"' });
          } finally { if (fs.existsSync(backup)) fs.unlinkSync(backup); }
        }
        if (format === 'json') return send(res, 200, JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), entries: entries(), settings: settings() }, null, 2), { 'Content-Disposition': 'attachment; filename="movies-of-interest.json"' });
        if (format === 'csv') {
          const columns = ['title', 'kind', 'year', 'rating', 'genres', 'directors', 'cast', 'summary', 'viewed', 'addedAt', 'viewedAt', 'notes', 'imdb', 'sourceUrl'];
          const cell = value => {
            let result = Array.isArray(value) ? value.join('; ') : String(value ?? '');
            if (/^[\s]*[=+\-@]/.test(result)) result = "'" + result;
            return '"' + result.replaceAll('"', '""') + '"';
          };
          const csv = [columns.join(','), ...entries().map(item => columns.map(key => cell(item[key])).join(','))].join('\r\n');
          return send(res, 200, '\ufeff' + csv, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="movies-of-interest.csv"' });
        }
        throw new ApiError(400, 'Unknown export format.');
      }
      if (method === 'POST' && ['/api/stop', '/api/uninstall'].includes(route)) {
        const input = await body(req);
        const uninstall = route === '/api/uninstall';
        if (input.confirm !== (uninstall ? 'UNINSTALL' : 'STOP')) throw new ApiError(400, 'Confirmation phrase does not match.');
        if (uninstall) {
          const executable = path.join(path.dirname(process.execPath), 'unins000.exe');
          if (!fs.existsSync(executable)) throw new ApiError(400, 'Not an installed copy. Use Windows Settings for installed applications.');
          await new Promise((resolve, reject) => {
            const child = spawn(executable, [], { detached: true, stdio: 'ignore' });
            child.once('error', reject);
            child.once('spawn', () => { child.unref(); resolve(); });
          });
        }
        send(res, 200, { ok: true });
        setTimeout(shutdown, 100);
        return;
      }
      if (method === 'GET' && route === '/') {
        const page = asset('index.html').toString().replace('__TOKEN__', token);
        return send(res, 200, page, { 'Content-Type': 'text/html; charset=utf-8' });
      }
      const staticFiles = { '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'],
        '/logo.svg': ['logo.svg', 'image/svg+xml'], '/songlabslogo.png': ['songlabslogo.png', 'image/png'] };
      if (method === 'GET' && Object.hasOwn(staticFiles, route)) {
        const [name, type] = staticFiles[route];
        return send(res, 200, asset(name), { 'Content-Type': type });
      }
      throw new ApiError(404, 'Not found.');
    } catch (error) {
      const status = error.status || (error.name === 'MetadataError' ? 502 : 500);
      console.error(`${req.method} ${req.url?.split('?')[0]}: ${error.message}`);
      if (!res.headersSent) send(res, status, { error: status === 500 ? 'Unexpected application error. See the local application log.' : error.message });
      else res.end();
    }
  });
  return {
    server, dbPath, close: shutdown,
    listen(port = 38473) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          origin = `http://127.0.0.1:${server.address().port}`;
          resolve(origin);
        });
      });
    },
  };
}
async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--stop')) {
    try {
      const origin = `http://127.0.0.1:${process.env.MOI_PORT || 38473}`;
      const health = await (await fetch(origin + '/api/health', { signal: AbortSignal.timeout(3000) })).json();
      if (health.app !== 'Movies of Interest') throw new Error('Another application is using the port.');
      const html = await (await fetch(origin, { signal: AbortSignal.timeout(3000) })).text();
      const token = /name="moi-token" content="([a-f0-9]{64})"/.exec(html)?.[1];
      if (!token) throw new Error('Unable to authenticate shutdown.');
      const response = await fetch(origin + '/api/stop', { method: 'POST', headers: { 'X-MOI-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'STOP' }), signal: AbortSignal.timeout(3000) });
      if (!response.ok) throw new Error('Server refused shutdown.');
    } catch (error) {
      // No listener is already stopped; other failures must remain visible.
      if (error.cause?.code !== 'ECONNREFUSED') { console.error(error.message); process.exitCode = 1; }
    }
    return;
  }
  if (sea.isSea()) {
    const dir = defaultDataDir();
    fs.mkdirSync(dir, { recursive: true });
    const log = fs.createWriteStream(path.join(dir, 'app.log'), { flags: 'a' });
    console.error = (...values) => log.write(`${new Date().toISOString()} ${values.join(' ')}\n`);
  }
  let app;
  try { app = createApp(); } catch (error) {
    console.error(`Cannot open the library: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  try {
    const url = await app.listen(Number(process.env.MOI_PORT || 38473));
    console.log(`Movies of Interest: ${url}`);
    if (args.includes('--open')) openBrowser(url);
    process.on('SIGINT', app.close);
    process.on('SIGTERM', app.close);
  } catch (error) {
    app.close();
    if (error.code === 'EADDRINUSE') {
      try {
        const url = `http://127.0.0.1:${process.env.MOI_PORT || 38473}`;
        const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(3000) });
        const health = await response.json();
        if (health.app !== 'Movies of Interest') throw new Error('Port is occupied by a different application.');
        if (args.includes('--open')) openBrowser(url);
      } catch (probeError) {
        console.error(`Cannot start Movies of Interest: ${probeError.message}`);
        process.exitCode = 1;
      }
    } else { console.error(error.message); process.exitCode = 1; }
  }
}
if (sea.isSea() || require.main === module) main();
module.exports = { createApp, DEFAULTS, APPEARANCE, VERSION, MIGRATIONS, validateImage };
