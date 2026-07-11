const API_BASE   = 'https://environment.data.gov.uk/ecology/api/v1';
const CORS_PROXY = 'https://api.allorigins.win/raw?url=';
const WIKI_API   = 'https://en.wikipedia.org/api/rest_v1/page/summary';
const PAGE_SIZE  = 10;

let allSpecies = [];
let currentPage = 0;

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
    try {
        allSpecies = await ecologyFetch('/species?skip=0&take=600');
        if (!Array.isArray(allSpecies) || allSpecies.length === 0) throw new Error('buit');
    } catch {
        // Fallback: dades locals embegudes (SPECIES_FALLBACK de fish-data.js)
        if (typeof SPECIES_FALLBACK !== 'undefined' && SPECIES_FALLBACK.length) {
            allSpecies = SPECIES_FALLBACK;
        } else {
            document.getElementById('loading').innerHTML =
                '<p class="error-msg">⚠️ No s\'ha pogut connectar a l\'API. Comproveu la connexió.</p>';
            showLoading(true);
            return;
        }
    }
    renderPage(0);
    showLoading(false);
}

function showLoading(show) {
    document.getElementById('loading').style.display = show ? 'flex' : 'none';
}

/* ─── Renderització de pàgina ────────────────────────────────── */

function renderPage(page) {
    currentPage = page;
    const container = document.getElementById('fish-container');
    container.innerHTML = '';

    const start = page * PAGE_SIZE;
    const pageSpecies = allSpecies.slice(start, start + PAGE_SIZE);

    pageSpecies.forEach(sp => {
        const card = document.createElement('div');
        card.className = 'card';
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-label', `Veure detalls de ${sp.label}`);
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
            </div>
        `;
        card.addEventListener('click', () => showDetail(sp));
        card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') showDetail(sp); });
        container.appendChild(card);

        // Carrega la imatge de Wikipedia en segon pla
        fetchWikiData(sp.alt_label).then(wiki => {
            if (!wiki.image) return;
            const imgEl = card.querySelector('.card-img');
            const phEl  = card.querySelector('.card-img-placeholder');
            imgEl.onload = () => { phEl.style.display = 'none'; imgEl.style.display = 'block'; };
            imgEl.onerror = () => {};
            imgEl.src = wiki.image;
        });
    });

    renderPagination();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ─── Paginació ──────────────────────────────────────────────── */

function renderPagination() {
    const totalPages = Math.ceil(allSpecies.length / PAGE_SIZE);
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
    html += `<span class="page-info">Pàgina ${currentPage + 1} / ${totalPages} &nbsp;·&nbsp; ${allSpecies.length} espècies</span>`;

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

    // Carrega Wikipedia (imatge + extracte) en paral·lel
    fetchWikiData(sp.alt_label).then(wiki => {
        if (wiki.image) {
            const imgEl = content.querySelector('.modal-hero-img');
            const phEl  = content.querySelector('.modal-hero-placeholder');
            imgEl.onload = () => { phEl.style.display = 'none'; imgEl.style.display = 'block'; };
            imgEl.src = wiki.image;
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

    // Petició d'observacions filtrades per aquesta espècie
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

