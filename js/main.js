// js/main.js

// ---------- PUBLICATIONS LOADER (with “Show more” button) ----------
(async function loadPublications() {
    const container = document.getElementById('publications-list');
    const nameVariations = [
        'forero-sánchez', 'forero-sanchez', 'forero sánchez', 'forero sanchez',
        'd. forero', 'daniel forero'
    ];
    const maxAuthorsToShow = 8;

    // Number of publications to show initially
    const INITIAL_COUNT = 10;

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
        const allWorks = await res.json();

        if (allWorks.length === 0) {
            container.innerHTML = '<p>No publications found.</p>';
            return;
        }

        // Sort: first-author → within first 10 → rest, each group by year desc
        allWorks.sort((a, b) => {
            const posA = authorPosition(a.authors || []);
            const posB = authorPosition(b.authors || []);
            const groupA = (posA === 0) ? 0 : (posA > 0 && posA < 10) ? 1 : 2;
            const groupB = (posB === 0) ? 0 : (posB > 0 && posB < 10) ? 1 : 2;
            if (groupA !== groupB) return groupA - groupB;
            return (parseInt(b.year) || 0) - (parseInt(a.year) || 0);
        });

        // Helper to render an array of works to HTML
        function renderWorks(works) {
            let html = '';
            works.forEach(pub => {
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
            return html;
        }

        // Render initial subset
        const initialWorks = allWorks.slice(0, INITIAL_COUNT);
        let html = renderWorks(initialWorks);
        container.innerHTML = html;

        // Add “Show more” button if there are more to show
        if (allWorks.length > INITIAL_COUNT) {
            const remaining = allWorks.length - INITIAL_COUNT;
            const buttonContainer = document.createElement('div');
            buttonContainer.style.textAlign = 'center';
            buttonContainer.style.marginTop = '1.5rem';
            const button = document.createElement('button');
            button.className = 'btn';          // reuse your existing button style
            button.textContent = `Show all ${allWorks.length} publications (${remaining} more)`;
            button.addEventListener('click', () => {
                // Replace content with the full list and remove the button
                container.innerHTML = renderWorks(allWorks);
            });
            buttonContainer.appendChild(button);
            container.appendChild(buttonContainer);
        }
    } catch (err) {
        console.error('Publications load error:', err);
        container.innerHTML = `<p>Unable to load publications. <a href="https://orcid.org/0000-0001-5957-332X" target="_blank">View on ORCID</a>.</p>`;
    }
})();
// ---------- ACADEMIC STATS WIDGET (from static stats.json) ----------
(async function loadStats() {
    const widget = document.getElementById('stats-widget');
    if (!widget) return;

    try {
        const res = await fetch('stats.json');
        if (!res.ok) throw new Error('Stats file not found');
        const data = await res.json();

        if (data.error) throw new Error('Stats unavailable');

        const hIndex = data.hIndex ?? '—';
        const citationCount = data.citationCount ?? '—';
        const paperCount = data.paperCount ?? '—';
        const authorUrl = data.authorUrl || 'https://www.semanticscholar.org/';

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
            <p class="stats-source"><a href="${authorUrl}" target="_blank">via ADS <i class="fas fa-external-link-alt"></i></a></p>
        `;
    } catch (err) {
        console.warn('Stats widget:', err.message);
        widget.innerHTML = ''; // hide on failure
    }
})();