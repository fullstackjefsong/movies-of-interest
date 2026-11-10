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
const SETTING_FIELDS = ['banner', 'tagline', 'background', 'accent', 'country', 'layout', 'theme', 'font', 'cardSize', 'corners', 'backgroundOpacity', 'backgroundBlur', 'songLabsLogo', 'showStats'];
const PRESETS = [
  ['Midnight gold', { theme: 'dark', background: '#10141c', accent: '#e8c782' }],
  ['Film noir', { theme: 'dark', background: '#0b0b0c', accent: '#d9d9d9' }],
  ['Velvet curtain', { theme: 'dark', background: '#1a0d12', accent: '#e0727f' }],
  ['Deep ocean', { theme: 'dark', background: '#0b1a24', accent: '#6cc4d9' }],
  ['Evergreen', { theme: 'dark', background: '#0f1a14', accent: '#9fd18b' }],
  ['Daylight', { theme: 'light', background: '#f4f1ea', accent: '#9a6b12' }],
  ['Paper & ink', { theme: 'light', background: '#fbfbf8', accent: '#2f5fb3' }],
];
const SORT_COLUMNS = { title: 'title', year: 'year', rating: 'rating', runtime: 'runtime', director: 'director', viewedAt: 'viewedAt', added: 'added' };
async function load() {
  state = await (await api('state')).json();
  applyAppearance();
  renderLibrary();
  renderReports();
  for (const el of $$('.data-path')) el.textContent = state.dataDir;
  $('#app-version').textContent = 'v' + state.version;
  $('#uninstall').disabled = !state.installed;
  $('#uninstall').title = state.installed ? '' : 'Available after installing the Windows release.';
}
function applyAppearance(settings = state.settings) {
  const root = document.documentElement;
  root.style.setProperty('--bg', settings.background);
  root.style.setProperty('--accent', settings.accent);
  root.style.setProperty('--ambient-opacity', String(settings.backgroundOpacity / 100));
  root.style.setProperty('--ambient-blur', settings.backgroundBlur + 'px');
  Object.assign(root.dataset, { theme: settings.theme, font: settings.font, cardSize: settings.cardSize, corners: settings.corners, labsLogo: settings.songLabsLogo });
  $('meta[name="theme-color"]').content = settings.background;
  $('.ambient').style.backgroundImage = settings.backgroundImage ? `url("${settings.backgroundImage}")` : 'none';
  $('#banner').textContent = settings.banner;
  $('#tagline').textContent = settings.tagline;
  $('#stats').hidden = !settings.showStats;
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
function detailsTable(items) {
  const sort = $('#sort').value;
  const header = (key, label, className = '') => {
    const active = sort === key || (key === 'added' && sort === 'newest');
    const direction = key === 'added' ? (sort === 'newest' ? 'descending' : 'ascending') : (['year', 'rating', 'viewedAt'].includes(key) ? 'descending' : 'ascending');
    return `<th class="${className}" ${active ? `aria-sort="${direction}"` : ''}><button type="button" class="sort-header${active ? ' active' : ''}" data-sort-by="${key}">${label}${active ? (direction === 'descending' ? ' ▾' : ' ▴') : ''}</button></th>`;
  };
  const rows = items.map(item => `<tr class="${item.viewed ? 'is-viewed' : ''}">
    <td class="col-thumb"><button class="thumb-button" data-detail="${item.id}" aria-label="Details for ${escape(item.title)}">${poster(item, 'thumb')}</button></td>
    <td class="col-title"><button class="card-title" data-detail="${item.id}">${escape(item.title)}</button>${item.summary ? `<span class="row-summary">${escape(item.summary)}</span>` : ''}</td>
    <td>${item.year || '—'}</td>
    <td class="col-kind"><span class="kind-pill">${item.kind === 'tv' ? 'TV' : 'Movie'}</span></td>
    <td>${item.rating !== null ? `<span class="rating">★ ${Number(item.rating).toFixed(1)}</span>` : '—'}</td>
    <td class="col-runtime">${item.runtime ? item.runtime + ' min' : '—'}</td>
    <td class="col-genres">${escape(item.genres.slice(0, 3).join(', ') || '—')}</td>
    <td class="col-director">${escape(item.directors.slice(0, 2).join(', ') || '—')}</td>
    <td class="col-cast">${escape(item.cast.slice(0, 3).join(', ') || '—')}</td>
    <td class="col-added">${new Date(item.addedAt).toLocaleDateString()}</td>
    <td class="col-viewed"><button class="watch-toggle compact ${item.viewed ? 'viewed' : ''}" data-watch="${item.id}" aria-pressed="${item.viewed}" aria-label="${item.viewed ? 'Viewed. Mark ' + escape(item.title) + ' as not viewed' : 'Mark ' + escape(item.title) + ' as viewed'}">${item.viewed ? '✓ Viewed' : '○ Mark'}</button></td>
  </tr>`).join('');
  return `<div class="details-wrap"><table class="details-table"><thead><tr><th class="col-thumb"><span class="sr-only">Poster</span></th>${header('title', 'Title', 'col-title')}${header('year', 'Year')}<th class="col-kind">Type</th>${header('rating', 'Rating')}${header('runtime', 'Runtime', 'col-runtime')}<th class="col-genres">Genres</th>${header('director', 'Director', 'col-director')}<th class="col-cast">Leads</th>${header('added', 'Added', 'col-added')}${header('viewedAt', 'Viewed', 'col-viewed')}</tr></thead><tbody>${rows}</tbody></table></div>`;
}
function renderLibrary() {
  $('#stats').innerHTML = stats();
  const selectedGenre = $('#genre-filter').value;
  const genres = [...new Set(state.entries.flatMap(item => item.genres))].sort();
  $('#genre-filter').innerHTML = '<option value="">All genres</option>' + genres.map(value => `<option value="${escape(value)}">${escape(value)}</option>`).join('');
  if (genres.includes(selectedGenre)) $('#genre-filter').value = selectedGenre;
  const items = visibleEntries();
  const layout = state.settings.layout;
  $('#result-count').textContent = `${items.length} of ${state.entries.length} titles`;
  $$('[data-view]').forEach(el => { el.classList.toggle('selected', el.dataset.view === layout); el.setAttribute('aria-pressed', String(el.dataset.view === layout)); });
  $('#collection').classList.toggle('list', layout === 'list');
  $('#collection').classList.toggle('details', layout === 'details' && items.length > 0);
  if (layout === 'details' && items.length) { $('#collection').innerHTML = detailsTable(items); return; }
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
  for (const key of SETTING_FIELDS) {
    if (form.elements[key].type === 'checkbox') form.elements[key].checked = state.settings[key];
    else form.elements[key].value = state.settings[key];
  }
  form.elements.tmdbToken.value = '';
  $('#remove-token').checked = false;
  $('#credential-status').textContent = state.settings.hasTmdbToken ? 'A credential is saved. Leave blank to keep it.' : 'No credential saved. Keyless lookup is active.';
  backgroundImage = undefined;
  $('#background-upload').value = '';
  $('#presets').innerHTML = PRESETS.map(([name, value], index) => `<button type="button" class="preset" data-preset="${index}" style="--preset-bg:${value.background};--preset-accent:${value.accent}"><span class="swatch" aria-hidden="true"></span>${escape(name)}</button>`).join('');
  previewSettings();
}
function formSettings() {
  const form = $('#settings-form');
  const data = {};
  for (const key of SETTING_FIELDS) {
    const field = form.elements[key];
    data[key] = field.type === 'checkbox' ? field.checked : field.type === 'range' ? Number(field.value) : field.value;
  }
  data.country = data.country.toUpperCase();
  return data;
}
function previewSettings() {
  const data = { ...state.settings, ...formSettings() };
  if (backgroundImage !== undefined) data.backgroundImage = backgroundImage;
  $('#opacity-value').textContent = data.backgroundOpacity + '%';
  $('#blur-value').textContent = data.backgroundBlur + ' px';
  applyAppearance(data);
}
function tab(name) {
  if (!['library', 'reports', 'export', 'settings'].includes(name)) name = 'library';
  $$('.tab').forEach(el => { el.hidden = el.id !== name; });
  $$('.nav').forEach(el => { el.classList.toggle('active', el.dataset.tab === name); el.setAttribute('aria-current', el.dataset.tab === name ? 'page' : 'false'); });
  if (name === 'settings') populateSettings();
  else applyAppearance();
  location.hash = name;
}
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.tab) tab(button.dataset.tab);
  if (button.dataset.close) $('#' + button.dataset.close).close();
  if (button.id === 'add-open' || button.hasAttribute('data-add')) $('#add-dialog').showModal();
  if (button.dataset.filter) { filter = button.dataset.filter; $$('[data-filter]').forEach(el => el.classList.toggle('selected', el === button)); renderLibrary(); }
  if (button.dataset.view && button.dataset.view !== state.settings.layout) action(async () => {
    const previous = state.settings.layout;
    state.settings.layout = button.dataset.view;
    renderLibrary();
    try { await api('settings', 'PUT', { layout: button.dataset.view }); }
    catch (error) { state.settings.layout = previous; renderLibrary(); throw error; }
  });
  if (button.dataset.sortBy && Object.hasOwn(SORT_COLUMNS, button.dataset.sortBy)) {
    const key = button.dataset.sortBy;
    $('#sort').value = key === 'added' ? ($('#sort').value === 'added' ? 'newest' : 'added') : key;
    renderLibrary();
    $(`[data-sort-by="${key}"]`)?.focus();
  }
  if (button.dataset.preset !== undefined) {
    const [, preset] = PRESETS[Number(button.dataset.preset)];
    const form = $('#settings-form');
    for (const [key, value] of Object.entries(preset)) form.elements[key].value = value;
    previewSettings();
  }
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
  if (button.dataset.suggest !== undefined) { $('#lookup-title').value = button.dataset.suggest; $('#lookup-form').requestSubmit(); }
  if (button.hasAttribute('data-switch-kind')) { $('#lookup-kind').value = $('#lookup-kind').value === 'movie' ? 'tv' : 'movie'; $('#lookup-form').requestSubmit(); }
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
      const typed = $('#lookup-title').value.trim();
      const kind = $('#lookup-kind').value;
      const data = await (await api('search?q=' + encodeURIComponent(typed) + '&kind=' + kind)).json();
      results = data.results;
      $('#lookup-notice').textContent = data.notice;
      const chips = (data.suggestions || []).map(value => `<button type="button" class="chip" data-suggest="${escape(value)}">${escape(value)}</button>`).join('');
      const other = kind === 'movie' ? 'TV shows' : 'movies';
      $('#lookup-results').innerHTML = (data.correctedQuery ? `<p class="did-you-mean">Showing closest matches for <strong>${escape(data.correctedQuery)}</strong>. You typed “${escape(typed)}”.</p>` : '')
        + (chips ? `<p class="did-you-mean">${results.length ? 'Not it? Try' : 'Did you mean'} ${chips}</p>` : '')
        + (results.map((item, index) => `<article class="lookup-result">${safeUrl(item.poster) ? `<img src="${safeUrl(item.poster)}" alt="" loading="lazy">` : '<img src="/logo.svg" alt="">'}<div><h3>${escape(item.title)} ${item.year ? '(' + item.year + ')' : ''}</h3><p>${escape(item.summary)}</p></div><button class="primary" data-pick="${index}">+ Add</button></article>`).join('')
        || `<p class="did-you-mean">No close matches.</p>`)
        + (data.confident ? '' : `<p class="did-you-mean">Looking for ${kind === 'movie' ? 'a TV show' : 'a movie'}? <button type="button" class="chip" data-switch-kind>Search ${other} instead</button></p>`);
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
      const data = formSettings();
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
  notify('Image previewed. Save preferences to keep it.');
  previewSettings();
}));
$('#clear-background').addEventListener('click', () => { backgroundImage = ''; $('#background-upload').value = ''; previewSettings(); notify('Background removed from the preview. Save preferences to keep this change.'); });
$('#settings-form').addEventListener('input', event => { if (event.target.name !== 'tmdbToken') previewSettings(); });
$('#reset-appearance').addEventListener('click', () => action(async () => {
  await api('settings', 'PUT', state.defaults);
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
