'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');
const { createApp, validateImage } = require('../app.cjs');
const fixture = { source: 'wikidata', sourceId: 'Q1', title: 'Example film', kind: 'movie', year: 2020, rating: null,
  genres: ['Drama'], directors: ['A Director'], cast: ['A Lead'], summary: 'A short summary.', poster: '', imdb: '',
  sourceUrl: 'https://www.wikidata.org/wiki/Q1', providers: [], runtime: 90, fetchedAt: '2026-01-01T00:00:00Z' };
async function setup(t, extra = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moi-test-'));
  const app = createApp({ dataDir, lookup: async () => ({ results: [fixture], notice: 'Test' }), detail: async () => fixture, ...extra });
  const origin = await app.listen(0);
  const html = await (await fetch(origin)).text();
  const token = /name="moi-token" content="([^"]+)"/.exec(html)[1];
  t.after(async () => {
    if (app.server.listening) await new Promise(resolve => { app.server.once('close', resolve); app.close(); });
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  return { app, origin, dataDir, token, request: (route, method = 'GET', data, headers = {}) =>
    fetch(origin + '/api/' + route, { method, headers: { 'X-MOI-Token': token, ...headers, ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined }) };
}
test('library add, duplicate guard, viewed toggle, notes, refresh and delete', async t => {
  const { request } = await setup(t);
  assert.equal((await request('entries', 'POST', { source: 'wikidata', sourceId: 'Q1', kind: 'movie' })).status, 201);
  assert.equal((await request('entries', 'POST', { source: 'wikidata', sourceId: 'Q1', kind: 'movie' })).status, 409);
  let state = await (await request('state')).json();
  assert.equal(state.entries[0].title, fixture.title);
  assert.equal(state.entries[0].serviceLinks.length, 8);
  assert.ok(state.entries[0].serviceLinks.every(item => !item.verified));
  assert.equal((await request('entries/1', 'PATCH', { viewed: true, notes: 'A note' })).status, 200);
  state = await (await request('state')).json();
  assert.equal(state.entries[0].viewed, true);
  assert.ok(state.entries[0].viewedAt);
  const timestamp = state.entries[0].viewedAt;
  await request('entries/1', 'PATCH', { notes: 'Changed' });
  assert.equal((await (await request('state')).json()).entries[0].viewedAt, timestamp);
  await request('entries/1/refresh', 'POST', {});
  state = await (await request('state')).json();
  assert.equal(state.entries[0].notes, 'Changed');
  assert.equal(state.entries[0].viewed, true);
  await request('entries/1', 'PATCH', { viewed: false });
  assert.equal((await (await request('state')).json()).entries[0].viewedAt, null);
  assert.equal((await request('entries/1', 'DELETE')).status, 200);
  assert.equal((await request('entries/1', 'DELETE')).status, 404);
});
test('manual entries stay in addition order; data survives server restart', async t => {
  const { request, dataDir, app } = await setup(t);
  for (const title of ['Z last alphabetically', 'A first alphabetically']) {
    assert.equal((await request('entries', 'POST', { source: 'manual', title, kind: 'movie' })).status, 201);
  }
  assert.deepEqual((await (await request('state')).json()).entries.map(item => item.title), ['Z last alphabetically', 'A first alphabetically']);
  await new Promise(resolve => { app.server.once('close', resolve); app.close(); });
  const second = createApp({ dataDir });
  const origin = await second.listen(0);
  const html = await (await fetch(origin)).text();
  const token = /name="moi-token" content="([^"]+)"/.exec(html)[1];
  const state = await (await fetch(origin + '/api/state', { headers: { 'X-MOI-Token': token } })).json();
  assert.equal(state.entries.length, 2);
  await new Promise(resolve => { second.server.once('close', resolve); second.close(); });
});
test('reject unauthenticated, cross-origin, DNS-rebinding and invalid requests', async t => {
  const { origin, request, token } = await setup(t);
  assert.equal((await fetch(origin + '/api/state')).status, 403);
  assert.equal((await request('state', 'GET', undefined, { Origin: 'https://evil.example' })).status, 403);
  const rebindingStatus = await new Promise((resolve, reject) => {
    const req = http.get(origin + '/api/state', { headers: { Host: 'evil.example', 'X-MOI-Token': token } }, response => {
      response.resume(); resolve(response.statusCode);
    });
    req.on('error', reject);
  });
  assert.equal(rebindingStatus, 403);
  assert.equal((await request('search?q=x&kind=music')).status, 400);
  assert.equal((await request('search?q=&kind=movie')).status, 400);
  assert.equal((await request('entries', 'POST', { source: 'manual', title: '', kind: 'movie' })).status, 400);
  assert.equal((await request('settings', 'PUT', { accent: 'red' })).status, 400);
  assert.equal((await request('settings', 'PUT', { country: 'usa' })).status, 400);
  assert.equal((await request('settings', 'PUT', { fake: 'x' })).status, 400);
  assert.equal((await request('stop', 'POST', { confirm: 'wrong' })).status, 400);
  assert.equal((await request('export?format=wrong')).status, 400);
  await request('entries', 'POST', { source: 'manual', title: 'Test', kind: 'tv' });
  assert.equal((await request('entries/1', 'PATCH', { viewed: 'yes' })).status, 400);
  assert.equal((await request('entries/1/refresh', 'POST', {})).status, 400);
});
test('settings round trip, all export shapes and credential redaction', async t => {
  const { request, dataDir } = await setup(t);
  await request('settings', 'PUT', { banner: 'My cinema', tmdbToken: 'private-secret', country: 'GB' });
  let state = await (await request('state')).json();
  assert.equal(state.settings.banner, 'My cinema');
  assert.equal(state.settings.hasTmdbToken, true);
  assert.equal(state.settings.tmdbToken, undefined);
  await request('entries', 'POST', { source: 'manual', title: '=FORMULA("quote")', kind: 'movie' });
  const csv = await (await request('export?format=csv')).text();
  assert.ok(csv.includes(`"'=FORMULA(""quote"")"`));
  const json = await (await request('export?format=json')).json();
  assert.equal(json.version, 1);
  assert.equal(json.entries.length, 1);
  assert.ok(!JSON.stringify(json).includes('private-secret'));
  const backup = Buffer.from(await (await request('export?format=sqlite')).arrayBuffer());
  assert.equal(backup.subarray(0, 15).toString(), 'SQLite format 3');
  const backupPath = path.join(dataDir, 'backup.db');
  fs.writeFileSync(backupPath, backup);
  const db = new DatabaseSync(backupPath);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM entries').get().count, 1);
  assert.equal(db.prepare("SELECT value FROM settings WHERE key='tmdbToken'").get(), undefined);
  assert.equal(db.prepare("SELECT value FROM settings WHERE key='banner'").get().value, '"My cinema"');
  db.close();
  state = await (await request('state')).json();
  assert.equal(state.settings.hasTmdbToken, true);
  assert.ok(!fs.readdirSync(dataDir).some(file => file.startsWith('export-')));
});
test('image upload rejects active content and accepts raster headers', () => {
  assert.throws(() => validateImage('data:image/svg+xml;base64,PHN2Zz4='), /Choose a PNG/);
  assert.throws(() => validateImage('data:image/png;base64,PHN2Zz4='), /content does not match/);
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  assert.equal(validateImage(png), png);
  assert.equal(validateImage(''), '');
});
test('metadata failures are explicit and do not create or overwrite entries', async t => {
  const { MetadataError } = require('../metadata.cjs');
  const { request } = await setup(t, { detail: async () => { throw new MetadataError('Service offline.'); } });
  const response = await request('entries', 'POST', { source: 'wikidata', sourceId: 'Q1', kind: 'movie' });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, 'Service offline.');
  assert.equal((await (await request('state')).json()).entries.length, 0);
});

test('appearance options validate, persist, and reset to served defaults', async t => {
  const { request } = await setup(t);
  const custom = { layout: 'details', theme: 'light', font: 'classic', cardSize: 'large', corners: 'square',
    backgroundOpacity: 40, backgroundBlur: 6, songLabsLogo: 'mono', showStats: false };
  assert.equal((await request('settings', 'PUT', custom)).status, 200);
  let state = await (await request('state')).json();
  for (const [key, value] of Object.entries(custom)) assert.equal(state.settings[key], value);
  assert.equal(state.version, require('../package.json').version);
  for (const bad of [{ layout: 'table' }, { songLabsLogo: 'invisible' }, { backgroundOpacity: 101 }, { backgroundBlur: 2.5 },
    { backgroundOpacity: '40' }, { showStats: 'no' }, { theme: 'neon' }]) {
    assert.equal((await request('settings', 'PUT', bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await request('settings', 'PUT', state.defaults)).status, 200);
  state = await (await request('state')).json();
  assert.equal(state.settings.layout, 'grid');
  assert.equal(state.settings.songLabsLogo, 'color');
  assert.equal(state.settings.showStats, true);
});
function legacyLibrary(dataDir) {
  // Schema and data exactly as written by v1.0.x, which had no migrations or meta table.
  const db = new DatabaseSync(path.join(dataDir, 'library.db'));
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE entries (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, source_id TEXT NOT NULL,
      title TEXT NOT NULL, kind TEXT NOT NULL, year INTEGER, rating REAL, metadata TEXT NOT NULL, added_at TEXT NOT NULL,
      viewed INTEGER NOT NULL DEFAULT 0, viewed_at TEXT, notes TEXT NOT NULL DEFAULT '', UNIQUE(source, source_id));
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  const metadata = JSON.stringify({ ...fixture, title: undefined });
  const insert = db.prepare('INSERT INTO entries(source,source_id,title,kind,year,rating,metadata,added_at,viewed,viewed_at,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  insert.run('wikidata', 'Q1', 'Kept film', 'movie', 2020, 7.5, metadata, '2026-01-01T00:00:00Z', 1, '2026-02-01T00:00:00Z', 'My note');
  insert.run('manual', 'm-2', 'Second film', 'movie', null, null, metadata, '2026-01-02T00:00:00Z', 0, null, '');
  for (const [key, value] of [['banner', 'Old banner'], ['layout', 'list'], ['accent', '#123456'], ['tmdbToken', 'kept-secret'], ['retired', 'x']]) {
    db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run(key, JSON.stringify(value));
  }
  db.close();
}
test('upgrading a v1.0 library keeps every entry and preference and saves a backup first', async t => {
  const { createApp: create, VERSION, MIGRATIONS } = require('../app.cjs');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moi-upgrade-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  legacyLibrary(dataDir);
  const start = async () => {
    const app = create({ dataDir });
    const origin = await app.listen(0);
    const token = /name="moi-token" content="([^"]+)"/.exec(await (await fetch(origin)).text())[1];
    const state = await (await fetch(origin + '/api/state', { headers: { 'X-MOI-Token': token } })).json();
    await new Promise(resolve => { app.server.once('close', resolve); app.close(); });
    return state;
  };
  const state = await start();
  assert.deepEqual(state.entries.map(item => [item.title, item.viewed, item.notes]), [['Kept film', true, 'My note'], ['Second film', false, '']]);
  assert.equal(state.entries[0].viewedAt, '2026-02-01T00:00:00Z');
  assert.equal(state.settings.banner, 'Old banner');
  assert.equal(state.settings.layout, 'list');
  assert.equal(state.settings.accent, '#123456');
  assert.equal(state.settings.hasTmdbToken, true);
  assert.equal(state.settings.songLabsLogo, 'color');
  assert.equal(state.settings.retired, undefined);
  const backups = fs.readdirSync(path.join(dataDir, 'backups'));
  assert.equal(backups.length, 1);
  assert.match(backups[0], new RegExp(`^library-v1\\.0-before-v${VERSION.replaceAll('.', '\\.')}-.*\\.db$`));
  const copy = new DatabaseSync(path.join(dataDir, 'backups', backups[0]));
  assert.equal(copy.prepare('SELECT COUNT(*) AS count FROM entries').get().count, 2);
  copy.close();
  const db = new DatabaseSync(path.join(dataDir, 'library.db'));
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, MIGRATIONS.length);
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='appVersion'").get().value, VERSION);
  db.close();
  await start();
  assert.equal(fs.readdirSync(path.join(dataDir, 'backups')).length, 1, 'restarting the same version must not create backups');
});
test('fresh installs skip backups; newer libraries are refused untouched; backups are pruned', async t => {
  const { createApp: create, MIGRATIONS } = require('../app.cjs');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moi-fresh-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const openAndClose = () => new Promise(resolve => create({ dataDir, onClose: resolve }).close());
  await openAndClose();
  assert.equal(fs.existsSync(path.join(dataDir, 'backups')), false);
  const db = new DatabaseSync(path.join(dataDir, 'library.db'));
  db.exec(`PRAGMA user_version=${MIGRATIONS.length + 1}`);
  db.close();
  assert.throws(() => create({ dataDir }), /newer version/);
  const check = new DatabaseSync(path.join(dataDir, 'library.db'));
  assert.equal(check.prepare('PRAGMA user_version').get().user_version, MIGRATIONS.length + 1);
  check.exec(`PRAGMA user_version=${MIGRATIONS.length}; UPDATE meta SET value='0.9' WHERE key='appVersion'`);
  check.close();
  const folder = path.join(dataDir, 'backups');
  fs.mkdirSync(folder);
  for (let i = 0; i < 6; i++) {
    const file = path.join(folder, `library-old-${i}.db`);
    fs.writeFileSync(file, '');
    fs.utimesSync(file, new Date(2020, 0, i + 1), new Date(2020, 0, i + 1));
  }
  await openAndClose();
  const kept = fs.readdirSync(folder);
  assert.equal(kept.length, 5);
  assert.ok(kept.some(name => name.startsWith('library-v0.9-before-')));
  assert.ok(!kept.includes('library-old-0.db') && !kept.includes('library-old-1.db'));
});
