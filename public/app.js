'use strict';
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const token = $('meta[name="moi-token"]').content;
let state = { entries: [], settings: {} };
let filter = 'all';
let backgroundImage;
let results = [];
let activeDetail = null;
let toastTimer;
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const date = value => value ? new Date(value).toLocaleDateString() : 'Not yet';
function safeUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' ? escape(url.href) : ''; } catch { return ''; }
}
const link = (url, label) => safeUrl(url) ? `<a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer">${escape(label)} ↗</a>` : '';
function notify(message, error = false) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').classList.toggle('error', error);
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, error ? 12000 : 4500);
}
async function api(route, method = 'GET', data) {
  let response;
  try {
    response = await fetch('/api/' + route, { method, headers: { 'X-MOI-Token': token, ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined });
  } catch { throw new Error('The local server is unavailable. Launch Movies of Interest from the Start menu to reconnect.'); }
  if (!response.ok) {
    const result = await response.json();
    throw new Error(result.error || `Request failed (${response.status}).`);
  }
  return response;
}
async function action(callback) {
  try { await callback(); } catch (error) { notify(error.message, true); }
}
async function load() {
  state = await (await api('state')).json();
  applyAppearance();
  renderLibrary();
  renderReports();
  for (const el of $$('.data-path')) el.textContent = state.dataDir;
  $('#uninstall').disabled = !state.installed;
  $('#uninstall').title = state.installed ? '' : 'Available after installing the Windows release.';
}
function applyAppearance() {
  const settings = state.settings;
  document.documentElement.style.setProperty('--bg', settings.background);
  document.documentElement.style.setProperty('--accent', settings.accent);
  $('.ambient').style.backgroundImage = settings.backgroundImage ? `url("${settings.backgroundImage}")` : 'none';
  $('#banner').textContent = settings.banner;
  $('#tagline').textContent = settings.tagline;
  document.title = settings.banner + ' · Movies of Interest';
}
function stats() {
  const all = state.entries;
  const viewed = all.filter(item => item.viewed).length;
  return [
    ['Titles collected', all.length, '▤'], ['Still to discover', all.length - viewed, '▷'],
    ['Already viewed', viewed, '✓'], ['TV shows', all.filter(item => item.kind === 'tv').length, '▣'],
  ].map(([label, value, symbol]) => `<div class="stat"><div><span>${label}</span><strong>${value}</strong></div><div class="stat-symbol" aria-hidden="true">${symbol}</div></div>`).join('');
}
function visibleEntries() {
  const query = $('#library-search').value.toLowerCase();
  const kind = $('#kind-filter').value;
  const genre = $('#genre-filter').value;
  const items = state.entries.filter(item => (filter === 'all' || (filter === 'viewed') === item.viewed)
    && (kind === 'all' || item.kind === kind) && (!genre || item.genres.includes(genre))
    && [item.title, ...item.cast, ...item.directors, ...item.genres, item.notes].join(' ').toLowerCase().includes(query));
  const sort = $('#sort').value;
  return items.sort((a, b) => {
    let delta = 0;
    if (sort === 'newest') delta = b.id - a.id;
    if (sort === 'title') delta = a.title.localeCompare(b.title);
    if (sort === 'year') delta = (b.year ?? -Infinity) - (a.year ?? -Infinity);
    if (sort === 'rating') delta = (b.rating ?? -Infinity) - (a.rating ?? -Infinity);
    if (sort === 'runtime') delta = (a.runtime ?? Infinity) - (b.runtime ?? Infinity);
    if (sort === 'viewedAt') delta = (Date.parse(b.viewedAt) || 0) - (Date.parse(a.viewedAt) || 0);
    if (sort === 'director') delta = (a.directors[0] || '\uffff').localeCompare(b.directors[0] || '\uffff');
    return delta || a.id - b.id;
  });
}
function poster(item, className = 'poster') {
  return safeUrl(item.poster) ? `<img class="${className}" src="${safeUrl(item.poster)}" alt="${escape(item.title)} poster" loading="lazy">`
    : `<div class="${className} poster-placeholder"><img src="/logo.svg" alt=""><span>${escape(item.title)}</span></div>`;
}
function renderLibrary() {
  $('#stats').innerHTML = stats();
  const selectedGenre = $('#genre-filter').value;
  const genres = [...new Set(state.entries.flatMap(item => item.genres))].sort();
  $('#genre-filter').innerHTML = '<option value="">All genres</option>' + genres.map(value => `<option value="${escape(value)}">${escape(value)}</option>`).join('');
  if (genres.includes(selectedGenre)) $('#genre-filter').value = selectedGenre;
  const items = visibleEntries();
  $('#result-count').textContent = `${items.length} of ${state.entries.length} titles`;
  $('#collection').classList.toggle('list', state.settings.layout === 'list');
  $('#collection').innerHTML = items.length ? items.map(item => `<article class="card">
    <button class="poster-button" data-detail="${item.id}" aria-label="Details for ${escape(item.title)}">${poster(item)}<span class="poster-badge">${item.kind === 'tv' ? 'TV SHOW' : 'MOVIE'}</span>${item.viewed ? '<span class="watched-badge">✓ VIEWED</span>' : ''}</button>
    <div class="card-content"><button class="card-title" data-detail="${item.id}">${escape(item.title)}</button><div class="meta">${item.year || 'Year unknown'} · ${item.runtime ? item.runtime + ' min' : (item.kind === 'tv' ? 'TV series' : 'Film')}${item.rating !== null ? ` · <span class="rating">★ ${Number(item.rating).toFixed(1)}</span>` : ''}</div><div class="genres">${escape(item.genres.join(' · ') || 'Genre not available')}</div><button class="watch-toggle ${item.viewed ? 'viewed' : ''}" data-watch="${item.id}" aria-pressed="${item.viewed}">${item.viewed ? '✓ Viewed · undo' : '○ Mark as viewed'}</button></div></article>`).join('')
    : `<div class="empty"><img src="/logo.svg" alt=""><h2>${state.entries.length ? 'No titles match these filters' : 'Great stories deserve a place'}</h2><p>${state.entries.length ? 'Try a different search or filter.' : 'Add your first movie or TV show. Your collection stays right here on your PC.'}</p>${state.entries.length ? '' : '<button class="primary" data-add>+ Add your first title</button>'}</div>`;
}
function barChart(values) {
  const groups = {};
  values.forEach(value => { groups[value] = (groups[value] || 0) + 1; });
  const sorted = Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = Math.max(1, ...sorted.map(item => item[1]));
  return sorted.length ? sorted.map(([label, count]) => `<div class="bar-row"><span>${escape(label)}</span><div class="bar-track"><div class="bar-fill" style="width:${count / max * 100}%"></div></div><span>${count}</span></div>`).join('') : '<p class="muted">Add titles to reveal this insight.</p>';
}
function renderReports() {
  const entries = state.entries;
  const watched = entries.filter(item => item.viewed);
  const rated = entries.filter(item => item.rating !== null);
  const percent = entries.length ? Math.round(watched.length / entries.length * 100) : 0;
  const minutes = entries.filter(item => !item.viewed && item.kind === 'movie').reduce((total, item) => total + (item.runtime || 0), 0);
  const months = entries.map(item => item.addedAt.slice(0, 7));
  const recently = [...watched].sort((a, b) => Date.parse(b.viewedAt) - Date.parse(a.viewedAt)).slice(0, 6);
  const highest = [...rated].sort((a, b) => b.rating - a.rating).slice(0, 6);
  $('#report-content').innerHTML = `<div class="stats">${stats()}</div><div class="report-grid">
    <article class="panel"><h2>Your viewing journey</h2><div class="progress-ring" style="background:conic-gradient(var(--accent) ${percent}%,#ffffff10 0)"><div class="ring-inner"><strong>${percent}%</strong><span>collection viewed</span></div></div><p>${watched.length} viewed · ${entries.length - watched.length} waiting</p><p>${Math.round(minutes / 60 * 10) / 10} known hours of unviewed movies (excludes unknown runtimes and TV episodes).</p></article>
    <article class="panel"><h2>Genres you gravitate toward</h2>${barChart(entries.flatMap(item => item.genres))}<p class="muted">A title can belong to several genres.</p></article>
    <article class="panel"><h2>Release decades</h2>${barChart(entries.filter(item => item.year).map(item => Math.floor(item.year / 10) * 10 + 's'))}</article>
    <article class="panel"><h2>Collection growth by month</h2>${barChart(months)}<p class="muted">Top eight months by titles added.</p></article>
    <article class="panel"><h2>Recently viewed</h2><ul class="report-list">${recently.map(item => `<li>${escape(item.title)}<span>${date(item.viewedAt)}</span></li>`).join('') || '<li>No titles viewed yet.</li>'}</ul></article>
    <article class="panel"><h2>Highest-rated discoveries</h2><ul class="report-list">${highest.map(item => `<li>${escape(item.title)}<span>★ ${Number(item.rating).toFixed(1)}</span></li>`).join('') || '<li>No source ratings available.</li>'}</ul><p class="muted">Average available source rating: ${rated.length ? (rated.reduce((sum, item) => sum + item.rating, 0) / rated.length).toFixed(1) + '/10' : 'N/A'}. Different sources are not directly comparable; these are not IMDb ratings.</p></article></div>`;
}
function showDetail(id) {
  const item = state.entries.find(value => value.id === id);
  if (!item) return;
  activeDetail = id;
  const field = (label, value) => `<div class="detail-field"><span>${label}</span><span>${escape(value || 'Not available')}</span></div>`;
  $('#detail-content').innerHTML = `<div class="dialog-heading"><p class="eyebrow">${item.kind === 'tv' ? 'TV SHOW' : 'MOVIE'} · ADDED ${escape(date(item.addedAt))}</p><button class="icon-button" data-close="detail-dialog" aria-label="Close">×</button></div>
    <div class="detail-top">${poster(item)}<div><h2>${escape(item.title)}</h2><p class="meta">${item.year || 'Year unknown'}${item.rating !== null ? ` · ★ ${Number(item.rating).toFixed(1)} (${escape(item.source)})` : ''}${item.runtime ? ' · ' + item.runtime + ' min' : ''}</p><p class="genres">${escape(item.genres.join(' · '))}</p><div class="detail-links">${link(item.imdb, 'IMDb')}${link(item.trailer, item.trailerIsSearch ? 'Trailer search' : 'Watch trailer')}${link(item.sourceUrl, 'Metadata source')}${link(item.wikipedia, 'Wikipedia / image credits')}</div></div></div>
    <p>${escape(item.summary || 'A summary is not available from this source.')}</p>
    ${field(item.kind === 'tv' ? 'Creators' : 'Director', item.directors.join(', '))}${field('Leads', item.cast.join(', '))}${field('Language', item.language)}${item.seasons ? field('Seasons', item.seasons) : ''}${item.network ? field('Network', item.network) : ''}
    <h2>Where to look</h2>${item.providers?.length ? `<p class="muted">Reported availability for ${escape(item.providerCountry)} as of ${escape(date(item.fetchedAt))}. Check the watch guide for current access.</p><div class="detail-links">${item.providers.map(provider => link(provider.url, provider.name + ' · ' + provider.access)).join('')}</div>` : '<p class="muted">Current availability has not been verified. These are service search shortcuts, not guaranteed title pages. Sign-in may be required. YouTube results can include paid rentals; Premium does not make them free.</p>'}
    <div class="detail-links">${item.serviceLinks.map(service => link(service.url, 'Search ' + service.name)).join('')}</div>
    <p class="muted">${escape(item.metadataWarning)} Last fetched: ${escape(date(item.fetchedAt))}.</p>
    <label>Your notes<textarea id="entry-notes" rows="3" maxlength="4000" placeholder="Recommended by a friend? Save it here.">${escape(item.notes)}</textarea></label>
    <div class="detail-actions"><button class="primary" data-watch="${item.id}">${item.viewed ? '✓ Viewed · mark unviewed' : 'Mark as viewed'}</button><button class="secondary" id="save-notes">Save notes</button>${item.source !== 'manual' ? '<button class="secondary" id="refresh-entry">Refresh metadata</button>' : ''}<button class="danger" id="delete-entry">Remove title...</button></div>`;
  if (!$('#detail-dialog').open) $('#detail-dialog').showModal();
}
function confirmAction(heading, message, phrase, callback) {
  $('#confirm-heading').textContent = heading;
  $('#confirm-message').textContent = message;
  $('#confirm-input').value = '';
  $('#confirm-input').placeholder = phrase;
  $('#confirm-label').firstChild.textContent = `Type ${phrase} to confirm`;
  $('#confirm-form').onsubmit = event => {
    event.preventDefault();
    if ($('#confirm-input').value !== phrase) return notify('Confirmation phrase does not match.', true);
    $('#confirm-dialog').close();
    action(callback);
  };
  $('#confirm-dialog').showModal();
}
function populateSettings() {
  const form = $('#settings-form');
  for (const key of ['banner', 'tagline', 'background', 'accent', 'country', 'layout']) form.elements[key].value = state.settings[key];
  form.elements.tmdbToken.value = '';
  $('#remove-token').checked = false;
  $('#credential-status').textContent = state.settings.hasTmdbToken ? 'A credential is saved. Leave blank to keep it.' : 'No credential saved. Keyless lookup is active.';
  backgroundImage = undefined;
  $('#background-upload').value = '';
}
function tab(name) {
  if (!['library', 'reports', 'export', 'settings'].includes(name)) name = 'library';
  $$('.tab').forEach(el => { el.hidden = el.id !== name; });
  $$('.nav').forEach(el => { el.classList.toggle('active', el.dataset.tab === name); el.setAttribute('aria-current', el.dataset.tab === name ? 'page' : 'false'); });
  if (name === 'settings') populateSettings();
  location.hash = name;
}
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.tab) tab(button.dataset.tab);
  if (button.dataset.close) $('#' + button.dataset.close).close();
  if (button.id === 'add-open' || button.hasAttribute('data-add')) $('#add-dialog').showModal();
  if (button.dataset.filter) { filter = button.dataset.filter; $$('[data-filter]').forEach(el => el.classList.toggle('selected', el === button)); renderLibrary(); }
  if (button.dataset.detail) showDetail(Number(button.dataset.detail));
  if (button.dataset.watch) action(async () => {
    button.disabled = true;
    try {
      const item = state.entries.find(value => value.id === Number(button.dataset.watch));
      await api('entries/' + item.id, 'PATCH', { viewed: !item.viewed });
      await load();
      if ($('#detail-dialog').open) showDetail(item.id);
    } finally { button.disabled = false; }
  });
  if (button.dataset.export) action(async () => {
    const response = await api('export?format=' + button.dataset.export);
    const url = URL.createObjectURL(await response.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `movies-of-interest.${{ csv: 'csv', json: 'json', sqlite: 'db' }[button.dataset.export]}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    notify('Export downloaded.');
  });
  if (button.dataset.pick) action(async () => {
    button.disabled = true;
    try {
      const item = results[Number(button.dataset.pick)];
      await api('entries', 'POST', { source: item.source, sourceId: item.sourceId, kind: item.kind });
      await load(); $('#add-dialog').close(); notify('Added ' + item.title + ' to your collection.');
    } finally { button.disabled = false; }
  });
  if (button.id === 'save-notes') action(async () => {
    await api('entries/' + activeDetail, 'PATCH', { notes: $('#entry-notes').value });
    await load(); notify('Notes saved.');
  });
  if (button.id === 'refresh-entry') action(async () => {
    button.disabled = true;
    try {
      await api('entries/' + activeDetail + '/refresh', 'POST', {});
      await load(); showDetail(activeDetail); notify('Metadata refreshed.');
    } finally { button.disabled = false; }
  });
  if (button.id === 'delete-entry') confirmAction('Remove this title?', 'This permanently removes the title and its notes from your library. Export a backup first if needed.', 'DELETE', async () => {
    await api('entries/' + activeDetail, 'DELETE'); $('#detail-dialog').close(); await load(); notify('Title removed.');
  });
});
['#library-search', '#kind-filter', '#genre-filter', '#sort'].forEach(selector => $(selector).addEventListener('input', renderLibrary));
$('#lookup-form').addEventListener('submit', event => {
  event.preventDefault();
  action(async () => {
    const button = $('#lookup-form button');
    button.disabled = true;
    $('#lookup-results').innerHTML = '';
    $('#lookup-notice').textContent = 'Searching online metadata...';
    try {
      const data = await (await api('search?q=' + encodeURIComponent($('#lookup-title').value) + '&kind=' + $('#lookup-kind').value)).json();
      results = data.results;
      $('#lookup-notice').textContent = data.notice;
      $('#lookup-results').innerHTML = results.map((item, index) => `<article class="lookup-result">${safeUrl(item.poster) ? `<img src="${safeUrl(item.poster)}" alt="" loading="lazy">` : '<img src="/logo.svg" alt="">'}<div><h3>${escape(item.title)} ${item.year ? '(' + item.year + ')' : ''}</h3><p>${escape(item.summary)}</p></div><button class="primary" data-pick="${index}">+ Add</button></article>`).join('') || '<p>No matching titles. Try another title or add manually.</p>';
    } catch (error) { $('#lookup-notice').textContent = error.message; throw error; }
    finally { button.disabled = false; }
  });
});
$('#manual-add').addEventListener('click', () => action(async () => {
  const title = $('#lookup-title').value.trim();
  if (!title) throw new Error('Enter a title above before adding manually.');
  await api('entries', 'POST', { source: 'manual', title, kind: $('#lookup-kind').value });
  await load(); $('#add-dialog').close(); notify('Title added manually.');
}));
$('#settings-form').addEventListener('submit', event => {
  event.preventDefault();
  action(async () => {
    const form = event.target;
    const button = form.querySelector('[type=submit]');
    button.disabled = true;
    try {
      const data = {};
      for (const key of ['banner', 'tagline', 'background', 'accent', 'country', 'layout']) data[key] = form.elements[key].value;
      data.country = data.country.toUpperCase();
      if ($('#remove-token').checked) data.tmdbToken = '';
      else if (form.elements.tmdbToken.value.trim()) data.tmdbToken = form.elements.tmdbToken.value.trim();
      if (backgroundImage !== undefined) data.backgroundImage = backgroundImage;
      await api('settings', 'PUT', data); await load(); populateSettings(); notify('Your preferences are saved.');
    } finally { button.disabled = false; }
  });
});
$('#background-upload').addEventListener('change', event => action(async () => {
  const file = event.target.files[0];
  if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
    event.target.value = ''; throw new Error('Choose a PNG, JPEG or WebP under 5 MB.');
  }
  backgroundImage = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('The background image could not be read.'));
    reader.readAsDataURL(file);
  });
  notify('Image ready. Save preferences to apply it.');
}));
$('#clear-background').addEventListener('click', () => { backgroundImage = ''; $('#background-upload').value = ''; notify('Save preferences to remove the image.'); });
$('#reset-appearance').addEventListener('click', () => action(async () => {
  await api('settings', 'PUT', { banner: 'Movies of Interest', tagline: 'Your next great watch starts here.', background: '#10141c', accent: '#e8c782', backgroundImage: '', layout: 'grid' });
  await load(); populateSettings(); notify('Appearance reset.');
}));
$('#stop').addEventListener('click', () => confirmAction('Stop the local server?', 'This page will disconnect. Your data is kept. Restart from the Start menu or at the next Windows sign-in.', 'STOP', async () => {
  await api('stop', 'POST', { confirm: 'STOP' });
  notify('Server stopped. Relaunch Movies of Interest to reconnect.');
  $('#stop').disabled = true;
}));
$('#uninstall').addEventListener('click', () => confirmAction('Uninstall Movies of Interest?', 'The Windows uninstaller will remove the app and startup entry. It separately asks whether to permanently delete your local database. Export a backup first. Data deletion is irreversible.', 'UNINSTALL', async () => {
  await api('uninstall', 'POST', { confirm: 'UNINSTALL' });
  notify('Windows uninstaller opened. This server is stopping.');
}));
$('#print').addEventListener('click', () => window.print());
window.addEventListener('hashchange', () => tab(location.hash.slice(1)));
action(async () => { await load(); tab(location.hash.slice(1)); });
