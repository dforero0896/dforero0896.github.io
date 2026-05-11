// js/main.js

// ---------- PUBLICATIONS LOADER ----------
(async function loadPublications() {
    const container = document.getElementById('publications-list');
    // Your name variations
    const nameVariations = [
        'forero-sánchez', 'forero-sanchez', 'forero sánchez', 'forero sanchez',
        'd. forero', 'daniel forero'
    ];
    const maxAuthorsToShow = 5;   // Adjust as needed

    function authorPosition(authors) {
        const lower = authors.map(a => a.toLowerCase());
        let pos = -1;
        nameVariations.forEach(v => {
            const idx = lower.findIndex(a => a.includes(v));
            if (idx !== -1 && (pos === -1 || idx < pos)) pos = idx;
        });
        return pos;
    }

    try {
        const res = await fetch('publications.json');
        if (!res.ok) throw new Error('File not found');
        const publications = await res.json();

        if (publications.length === 0) {
            container.innerHTML = '<p>No publications found.</p>';
            return;
        }

        // Sort: first‑author > within first 10 > rest
        publications.sort((a, b) => {
            const posA = authorPosition(a.authors || []);
            const posB = authorPosition(b.authors || []);
            const groupA = (posA === 0) ? 0 : (posA > 0 && posA < 10) ? 1 : 2;
            const groupB = (posB === 0) ? 0 : (posB > 0 && posB < 10) ? 1 : 2;
            if (groupA !== groupB) return groupA - groupB;
            return (parseInt(b.year) || 0) - (parseInt(a.year) || 0);
        });

        let html = '';
        publications.forEach(pub => {
            const authors = pub.authors || [];
            let authorHtml = 'Unknown authors';
            if (authors.length > 0) {
                const shown = authors.slice(0, maxAuthorsToShow);
                const highlighted = shown.map(name => {
                    const lower = name.toLowerCase();
                    const isYou = nameVariations.some(v => lower.includes(v));
                    return isYou ? `<span class="author-highlight">${name}</span>` : name;
                });
                authorHtml = highlighted.join('; ');
                if (authors.length > maxAuthorsToShow) authorHtml += ' et al.';
            }

            let links = '';
            if (pub.doi) links += `<a href="https://doi.org/${pub.doi}" target="_blank">DOI</a> `;
            if (pub.arxiv) links += `<a href="https://arxiv.org/abs/${pub.arxiv}" target="_blank">arXiv</a> `;
            if (!pub.doi && !pub.arxiv) links += `<a href="https://orcid.org/0000-0001-5957-332X" target="_blank">ORCID</a> `;

            html += `
                <div class="publication">
                    <div class="pub-title">${pub.title}</div>
                    <div class="pub-authors">${authorHtml}</div>
                    <div class="pub-journal">${pub.journal} (${pub.year})</div>
                    <div class="pub-links">${links}</div>
                </div>
            `;
        });
        container.innerHTML = html;
    } catch (err) {
        console.error('Publications load error:', err);
        container.innerHTML = `<p>Unable to load publications. <a href="https://orcid.org/0000-0001-5957-332X" target="_blank">View on ORCID</a>.</p>`;
    }
})();

// ---------- ACADEMIC STATS WIDGET (Semantic Scholar) ----------
(async function loadStats() {
    const widget = document.getElementById('stats-widget');
    if (!widget) return;

    const orcid = '0000-0001-5957-332X';
    const apiUrl = `https://www.semanticscholar.org/author/Daniel-Felipe-Forero-Sanchez/2117707118?fields=hIndex,citationCount,paperCount,url`;

    try {
        const res = await fetch(apiUrl);
        if (!res.ok) {
            console.warn('SS API status:', res.status);
            throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        console.log('SS data:', data); // Debug: see the full object

        if (!data || data.error || typeof data.paperCount === 'undefined') {
            throw new Error('Invalid or missing author data');
        }

        const hIndex = data.hIndex ?? '—';
        const citationCount = data.citationCount ?? '—';
        const paperCount = data.paperCount ?? '—';
        const authorUrl = data.url || `https://www.semanticscholar.org/author/${data.authorId}`;

        widget.innerHTML = `
            <div class="stats-grid">
                <div class="stat">
                    <span class="stat-number">${hIndex}</span>
                    <span class="stat-label">h-index</span>
                </div>
                <div class="stat">
                    <span class="stat-number">${citationCount}</span>
                    <span class="stat-label">citations</span>
                </div>
                <div class="stat">
                    <span class="stat-number">${paperCount}</span>
                    <span class="stat-label">papers</span>
                </div>
            </div>
            <p class="stats-source"><a href="${authorUrl}" target="_blank">via Semantic Scholar <i class="fas fa-external-link-alt"></i></a></p>
        `;
    } catch (err) {
        console.error('Stats widget error:', err);
        // Hide widget if data can't be loaded – it degrades gracefully
        widget.innerHTML = '';
    }
})();