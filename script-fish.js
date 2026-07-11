const API_BASE        = 'https://environment.data.gov.uk/ecology/api/v1';
const INATURALIST_API = 'https://api.inaturalist.org/v1/taxa';
const CORS_PROXY      = 'https://api.allorigins.win/raw?url=';
const WIKI_API        = 'https://en.wikipedia.org/api/rest_v1/page/summary';
const PAGE_SIZE       = 10;

let allSpecies      = [];
let filteredSpecies = [];
let currentPage     = 0;
let activeSource    = ''; // '' = Totes les fonts

// Caché de dades de Wikipedia per nom científic
const wikiCache = new Map();

/**
 * Fetch a l'API d'ecologia amb fallback a proxy CORS.
 * Necessari quan la pàgina s'obre des de file:// o un host sense capçaleres CORS.
 */
async function ecologyFetch(path) {
    const directUrl = `${API_BASE}${path}`;
    try {
        const res = await fetch(directUrl);
        if (res.ok) return res.json();
        throw new Error(`HTTP ${res.status}`);
    } catch {
        // Fallback: proxy CORS (allorigins.win)
        const res = await fetch(`${CORS_PROXY}${encodeURIComponent(directUrl)}`);
        if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);
        return res.json();
    }
}

async function fetchWithCORSFallback(url) {
    try {
        const res = await fetch(url);
        if (res.ok) return res.json();
        throw new Error(`HTTP ${res.status}`);
    } catch {
        const res = await fetch(`${CORS_PROXY}${encodeURIComponent(url)}`);
        if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);
        return res.json();
    }
}

async function fetchWikiData(scientificName) {
    if (wikiCache.has(scientificName)) return wikiCache.get(scientificName);
    try {
        const title = encodeURIComponent(scientificName.trim().replace(/ /g, '_'));
        const res = await fetch(`${WIKI_API}/${title}`);
        if (!res.ok) throw new Error('not found');
        const d = await res.json();
        const result = {
            image:   d.thumbnail?.source   ?? null,
            extract: d.extract             ?? null,
            url:     d.content_urls?.desktop?.page ?? null
        };
        wikiCache.set(scientificName, result);
        return result;
    } catch {
        const empty = { image: null, extract: null, url: null };
        wikiCache.set(scientificName, empty);
        return empty;
    }
}

/* ─── Inicialització ─────────────────────────────────────────── */

async function init() {
    showLoading(true);

    // ── Fase 1: UK Ecology API (font principal) ────────────────────
    const ukSpecies = await fetchUKEcology();
    allSpecies      = ukSpecies;
    filteredSpecies = allSpecies;
    setupSearch();
    setupSourceFilter();
    renderPage(0);
    showLoading(false);
    updateSourceCounts();

    // ── Fase 2: iNaturalist en segon pla ──────────────────────────
    try {
        const inatSpecies = await fetchINaturalistFish();
        if (inatSpecies.length) {
            const ukNames = new Set(ukSpecies.map(sp => (sp.alt_label ?? '').toLowerCase()));
            const inatNew = inatSpecies.filter(sp => !ukNames.has((sp.alt_label ?? '').toLowerCase()));
            allSpecies = [...ukSpecies, ...inatNew]
                .sort((a, b) => (a.label ?? '').localeCompare(b.label ?? ''));
            applyFilters();
            updateSourceCounts();
        }
    } catch { /* iNaturalist fallida silenciosament */ }
}

function showLoading(show) {
    document.getElementById('loading').style.display = show ? 'flex' : 'none';
}

/* ─── Fonts de dades ─────────────────────────────────────────── */

async function fetchUKEcology() {
    try {
        const data = await ecologyFetch('/species?skip=0&take=600');
        if (!Array.isArray(data) || data.length === 0) throw new Error('buit');
        return data.map(sp => ({ ...sp, source: 'UK Ecology' }));
    } catch {
        if (typeof SPECIES_FALLBACK !== 'undefined' && SPECIES_FALLBACK.length) {
            return SPECIES_FALLBACK.map(sp => ({ ...sp, source: 'UK Ecology' }));
        }
        document.getElementById('loading').innerHTML =
            '<p class="error-msg">⚠️ No s\'ha pogut connectar a l\'API. Comproveu la connexió.</p>';
        showLoading(true);
        return [];
    }
}

async function fetchINaturalistFish() {
    const results = [];
    for (let page = 1; page <= 2; page++) {
        try {
            const url = `${INATURALIST_API}?taxon_id=47178&rank=species&per_page=200` +
                        `&order_by=observations_count&order=desc&page=${page}&locale=en`;
            const data = await fetchWithCORSFallback(url);
            if (!Array.isArray(data.results) || !data.results.length) break;
            results.push(...data.results);
            if (data.results.length < 200) break;
        } catch { break; }
    }
    return results
        .filter(item => item.name)
        .map(item => ({
            label:     item.preferred_common_name || item.name,
            alt_label: item.name,
            notation:  String(item.id),
            species:   `https://www.inaturalist.org/taxa/${item.id}`,
            photo:     item.default_photo?.medium_url ?? null,
            source:    'iNaturalist'
        }));
}

/* ─── Filtres combinats (cerca + font) ───────────────────────── */

function applyFilters() {
    const q = (document.getElementById('species-search')?.value ?? '').trim().toLowerCase();
    filteredSpecies = allSpecies.filter(sp => {
        const matchSrc = !activeSource || sp.source === activeSource;
        const matchQ   = !q
            || (sp.label     ?? '').toLowerCase().includes(q)
            || (sp.alt_label ?? '').toLowerCase().includes(q);
        return matchSrc && matchQ;
    });
    const countEl  = document.getElementById('search-count');
    const clearBtn = document.getElementById('search-clear');
    if (countEl)  countEl.textContent = q
        ? `${filteredSpecies.length} resultat${filteredSpecies.length !== 1 ? 's' : ''}`
        : '';
    if (clearBtn) clearBtn.hidden = !q;
    renderPage(0);
}

function setupSourceFilter() {
    document.querySelectorAll('.source-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            activeSource = btn.dataset.source;
            document.querySelectorAll('.source-btn')
                    .forEach(b => b.classList.toggle('active', b === btn));
            applyFilters();
        });
    });
}

function updateSourceCounts() {
    const counts = { '': allSpecies.length };
    allSpecies.forEach(sp => { counts[sp.source] = (counts[sp.source] ?? 0) + 1; });
    document.querySelectorAll('.source-btn').forEach(btn => {
        const src  = btn.dataset.source;
        const cnt  = counts[src] ?? 0;
        const base = btn.dataset.label ?? btn.textContent.replace(/\s*\(\d+\)$/, '').trim();
        btn.dataset.label = base;
        btn.textContent   = cnt ? `${base} (${cnt})` : base;
    });
}

/* ─── Renderització de pàgina ────────────────────────────────── */

function setupSearch() {
    const input    = document.getElementById('species-search');
    const clearBtn = document.getElementById('search-clear');
    if (!input) return;
    input.addEventListener('input', applyFilters);
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            input.value = '';
            input.focus();
            applyFilters();
        });
    }
}

function renderPage(page) {
    currentPage = page;
    const container = document.getElementById('fish-container');
    container.innerHTML = '';

    const start = page * PAGE_SIZE;
    const pageSpecies = filteredSpecies.slice(start, start + PAGE_SIZE);

    pageSpecies.forEach(sp => {
        const card = document.createElement('div');
        card.className = 'card';
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-label', `Veure detalls de ${sp.label}`);
        const srcKey = (sp.source ?? 'local').toLowerCase().replace(/\s+/g, '-');
        card.innerHTML = `
            <div class="card-img-wrap">
                <div class="card-img-placeholder">🐟</div>
                <img class="card-img" alt="${escHtml(sp.label)}" />
                <div class="card-img-label">${escHtml(sp.label)}</div>
            </div>
            <div class="card-content">
                <h2>${escHtml(sp.label)}</h2>
                <p class="scientific-name"><em>${escHtml(sp.alt_label)}</em></p>
                <p class="species-code">Codi: <strong>${escHtml(sp.notation)}</strong></p>
                <span class="source-badge source-badge--${escHtml(srcKey)}">${escHtml(sp.source ?? 'Local')}</span>
            </div>
        `;
        card.addEventListener('click', () => showDetail(sp));
        card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') showDetail(sp); });
        container.appendChild(card);

        // Imatge de la card: directa (iNaturalist) o des de Wikipedia
        if (sp.photo) {
            const imgEl = card.querySelector('.card-img');
            const phEl  = card.querySelector('.card-img-placeholder');
            imgEl.onload  = () => { phEl.style.display = 'none'; imgEl.style.display = 'block'; };
            imgEl.onerror = () => {};
            imgEl.src = sp.photo;
        } else {
            fetchWikiData(sp.alt_label).then(wiki => {
                if (!wiki.image) return;
                const imgEl = card.querySelector('.card-img');
                const phEl  = card.querySelector('.card-img-placeholder');
                imgEl.onload  = () => { phEl.style.display = 'none'; imgEl.style.display = 'block'; };
                imgEl.onerror = () => {};
                imgEl.src = wiki.image;
            });
        }
    });

    renderPagination();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ─── Paginació ──────────────────────────────────────────────── */

function renderPagination() {
    const totalPages = Math.ceil(filteredSpecies.length / PAGE_SIZE);
    const pag = document.getElementById('pagination');

    const makeBtn = (label, targetPage, active = false, disabled = false) => {
        const cls = active ? ' class="active"' : '';
        const dis = disabled ? ' disabled' : '';
        return `<button${cls}${dis} onclick="renderPage(${targetPage})">${label}</button>`;
    };

    let lo = Math.max(0, currentPage - 2);
    let hi = Math.min(totalPages - 1, lo + 4);
    lo = Math.max(0, hi - 4);

    let html = makeBtn('‹', currentPage - 1, false, currentPage === 0);

    if (lo > 0) {
        html += makeBtn('1', 0);
        if (lo > 1) html += '<span class="ellipsis">…</span>';
    }
    for (let i = lo; i <= hi; i++) {
        html += makeBtn(i + 1, i, i === currentPage);
    }
    if (hi < totalPages - 1) {
        if (hi < totalPages - 2) html += '<span class="ellipsis">…</span>';
        html += makeBtn(totalPages, totalPages - 1);
    }

    html += makeBtn('›', currentPage + 1, false, currentPage === totalPages - 1);
    html += `<span class="page-info">Pàgina ${currentPage + 1} / ${totalPages} &nbsp;·&nbsp; ${filteredSpecies.length} espècies</span>`;

    pag.innerHTML = html;
}

/* ─── Modal de detall ────────────────────────────────────────── */

async function showDetail(sp) {
    const overlay = document.getElementById('modal-overlay');
    const content = document.getElementById('modal-content');
    overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    // Mostra el modal amb estructura bàsica + placeholder d'imatge
    content.innerHTML = `
        <div class="modal-hero">
            <div class="modal-hero-img-wrap">
                <div class="modal-hero-placeholder">🐟</div>
                <img class="modal-hero-img" alt="${escHtml(sp.label)}" />
            </div>
            <div class="modal-hero-info">
                <h2 id="modal-title">${escHtml(sp.label)}</h2>
                <p class="scientific-name"><em>${escHtml(sp.alt_label)}</em></p>
                <p id="modal-extract" class="modal-extract"></p>
            </div>
        </div>

        <table class="spec-table">
            <tbody>
                <tr><th>Nom comú</th><td>${escHtml(sp.label)}</td></tr>
                <tr><th>Nom científic</th><td><em>${escHtml(sp.alt_label)}</em></td></tr>
                <tr><th>Codi (notation)</th><td><code>${escHtml(sp.notation)}</code></td></tr>
                <tr><th>Font dades</th><td><span class="source-badge source-badge--${escHtml((sp.source??'local').toLowerCase().replace(/\s+/g,'-'))}">${escHtml(sp.source??'Local')}</span></td></tr>
                <tr><th>Font Wikipedia</th><td id="wiki-link"><em>carregant…</em></td></tr>
                <tr><th>Recurs API</th><td><a href="${escHtml(sp.species)}" target="_blank" rel="noopener">Veure URI ↗</a></td></tr>
            </tbody>
        </table>

        <div id="obs-section">
            <h3 class="obs-title">Observacions de camp</h3>
            <div id="obs-loading" class="obs-loading">
                <div class="spinner small"></div> Carregant dades de camp…
            </div>
            <div id="obs-content"></div>
        </div>
    `;

    // Carrega imatge (directa o Wikipedia) + extracte en paral·lel
    fetchWikiData(sp.alt_label).then(wiki => {
        const imgUrl = sp.photo ?? wiki.image ?? null;
        if (imgUrl) {
            const imgEl = content.querySelector('.modal-hero-img');
            const phEl  = content.querySelector('.modal-hero-placeholder');
            imgEl.onload = () => { phEl.style.display = 'none'; imgEl.style.display = 'block'; };
            imgEl.src = imgUrl;
        }
        if (wiki.extract) {
            const extractEl = content.querySelector('#modal-extract');
            if (extractEl) extractEl.textContent = wiki.extract;
        }
        const wikiLinkTd = content.querySelector('#wiki-link');
        if (wikiLinkTd) {
            wikiLinkTd.innerHTML = wiki.url
                ? `<a href="${escHtml(wiki.url)}" target="_blank" rel="noopener">Veure a Wikipedia ↗</a>`
                : '<em>No disponible</em>';
        }
    });

    // Observacions: UK Ecology → consulta API; altres fonts → enllaç extern
    if (sp.source === 'iNaturalist') {
        document.getElementById('obs-loading').style.display = 'none';
        document.getElementById('obs-content').innerHTML =
            `<p class="no-data">Consulta les observacions d'aquesta espècie directament a
             <a href="${escHtml(sp.species)}" target="_blank" rel="noopener">iNaturalist ↗</a>.</p>`;
    } else {
        try {
            const encoded = encodeURIComponent(sp.species);
            const data = await ecologyFetch(`/observations?ultimate_foi_id=${encoded}&take=20`);
            document.getElementById('obs-loading').style.display = 'none';
            const obs = Array.isArray(data) ? data : (data.items ?? []);
            renderObservations(obs);
        } catch (err) {
            document.getElementById('obs-loading').style.display = 'none';
            document.getElementById('obs-content').innerHTML =
                `<p class="no-data">No s'han pogut carregar les observacions: ${escHtml(err.message)}</p>`;
        }
    }
}

function renderObservations(obs) {
    const el = document.getElementById('obs-content');

    if (!obs.length) {
        el.innerHTML = '<p class="no-data">No hi ha observacions de camp registrades per a aquesta espècie a l\'API.</p>';
        return;
    }

    // Filtrem claus de tipus URI per a millor llegibilitat
    const uriKeys = new Set(['observation', 'feature_of_interest', 'observed_property', 'type', 'site', 'survey', 'sampling_point']);
    const keys = [...new Set(obs.flatMap(o => Object.keys(o).filter(k => !uriKeys.has(k))))];

    let html = `<p class="obs-count">${obs.length} observació${obs.length !== 1 ? 's' : ''} trobada${obs.length !== 1 ? 's' : ''}</p>`;
    html += `<div class="obs-scroll"><table class="obs-table"><thead><tr>`;
    keys.forEach(k => { html += `<th>${escHtml(k.replace(/_/g, ' '))}</th>`; });
    html += `</tr></thead><tbody>`;

    obs.forEach(o => {
        html += '<tr>';
        keys.forEach(k => {
            const val = o[k] ?? '—';
            html += `<td>${escHtml(String(val))}</td>`;
        });
        html += '</tr>';
    });

    html += '</tbody></table></div>';
    el.innerHTML = html;
}

/* ─── Tancament del modal ────────────────────────────────────── */

function closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
    document.body.style.overflow = '';
}

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target.id === 'modal-overlay') closeModal();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* ─── Utils ──────────────────────────────────────────────────── */

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/* ─── Arrencada ──────────────────────────────────────────────── */
init();

