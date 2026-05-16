// js/main.js

// ---------- PUBLICATIONS LOADER (with “Show more” button) ----------
// ---------- PUBLICATIONS LOADER (with author expansion) ----------
(async function loadPublications() {
    const container = document.getElementById('publications-list');
    const nameVariations = [
        'forero-sánchez', 'forero-sanchez', 'forero sánchez', 'forero sanchez',
        'd. forero', 'daniel forero'
    ];
    const maxAuthorsToShow = 7;
    const INITIAL_COUNT = 10;   // number of publications initially visible

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

        // Sort: first-author → within first 10 → rest; each group by year desc
        allWorks.sort((a, b) => {
            const posA = authorPosition(a.authors || []);
            const posB = authorPosition(b.authors || []);
            const groupA = (posA === 0) ? 0 : (posA > 0 && posA < 10) ? 1 : 2;
            const groupB = (posB === 0) ? 0 : (posB > 0 && posB < 10) ? 1 : 2;
            if (groupA !== groupB) return groupA - groupB;
            return (parseInt(b.year) || 0) - (parseInt(a.year) || 0);
        });

        function renderWorks(works) {
            let html = '';
            works.forEach(pub => {
                const authors = pub.authors || [];
                let authorHtml = '';
                let expandHtml = '';

                if (authors.length > 0) {
                    // Build abbreviated author list (first maxAuthorsToShow)
                    const shown = authors.slice(0, maxAuthorsToShow);
                    const highlightedShort = shown.map(name => {
                        const lower = name.toLowerCase();
                        const isYou = nameVariations.some(v => lower.includes(v));
                        return isYou ? `<span class="author-highlight">${name}</span>` : name;
                    }).join('; ');

                    authorHtml = highlightedShort;
                    if (authors.length > maxAuthorsToShow) {
                        authorHtml += ' et al.';
                        // Prepare full author list (hidden)
                        const highlightedFull = authors.map(name => {
                            const lower = name.toLowerCase();
                            const isYou = nameVariations.some(v => lower.includes(v));
                            return isYou ? `<span class="author-highlight">${name}</span>` : name;
                        }).join('; ');

                        // We'll use a unique id for each publication based on its DOI or title
                        const pubId = (pub.doi || pub.title).replace(/\W/g, '_');
                        expandHtml = `
                            <div class="author-expand">
                                <button class="author-toggle" data-target="authors-${pubId}">
                                    Show all ${authors.length} authors <i class="fas fa-chevron-down"></i>
                                </button>
                                <span id="authors-${pubId}" class="full-authors" style="display:none;">
                                    ${highlightedFull}
                                </span>
                            </div>`;
                    }
                } else {
                    authorHtml = 'Unknown authors';
                }

                let links = '';
                if (pub.doi) links += `<a href="https://doi.org/${pub.doi}" target="_blank">DOI</a> `;
                if (pub.arxiv) links += `<a href="https://arxiv.org/abs/${pub.arxiv}" target="_blank">arXiv</a> `;
                if (!pub.doi && !pub.arxiv) links += `<a href="https://orcid.org/0000-0001-5957-332X" target="_blank">ORCID</a> `;

                html += `
                    <div class="publication">
                        <div class="pub-title">${pub.title}</div>
                        <div class="pub-authors">
                            ${authorHtml}
                            ${expandHtml}
                        </div>
                        <div class="pub-journal">${pub.journal} (${pub.year})</div>
                        <div class="pub-links">${links}</div>
                    </div>
                `;
            });
            return html;
        }

        // Render initial subset
        let html = renderWorks(allWorks.slice(0, INITIAL_COUNT));
        container.innerHTML = html;
        attachAuthorToggleEvents(); // bind click handlers after rendering

        // "Show more" publications button
        if (allWorks.length > INITIAL_COUNT) {
            const remaining = allWorks.length - INITIAL_COUNT;
            const btnDiv = document.createElement('div');
            btnDiv.style.textAlign = 'center';
            btnDiv.style.marginTop = '1.5rem';
            const btn = document.createElement('button');
            btn.className = 'btn';
            btn.textContent = `Show all ${allWorks.length} publications (${remaining} more)`;
            btn.addEventListener('click', () => {
                container.innerHTML = renderWorks(allWorks);
                attachAuthorToggleEvents(); // rebind after replacing HTML
            });
            btnDiv.appendChild(btn);
            container.appendChild(btnDiv);
        }

        // Function to attach event listeners to all toggle buttons
        function attachAuthorToggleEvents() {
            document.querySelectorAll('.author-toggle').forEach(button => {
                button.addEventListener('click', function () {
                    const targetId = this.getAttribute('data-target');
                    const fullList = document.getElementById(targetId);
                    if (fullList) {
                        if (fullList.style.display === 'none') {
                            fullList.style.display = 'inline';
                            this.innerHTML = 'Show less <i class="fas fa-chevron-up"></i>';
                        } else {
                            fullList.style.display = 'none';
                            this.innerHTML = `Show all ${fullList.innerText.split(';').length} authors <i class="fas fa-chevron-down"></i>`;
                        }
                    }
                });
            });
        }
    } catch (err) {
        console.error('Publications load error:', err);
        container.innerHTML = `<p>Unable to load publications. <a href="https://orcid.org/0000-0001-5957-332X" target="_blank">View on ORCID</a>.</p>`;
    }
})();
// ---------- ACADEMIC STATS WIDGET (from static stats.json) ----------
// ---------- ACADEMIC STATS WIDGET (with count-up animation) ----------
(async function loadStats() {
    const widget = document.getElementById('stats-widget');
    if (!widget) return;

    // 1. Load data from stats.json and publications.json (same as before)
    let hIndex = '—', citationCount = '—', authorUrl = 'https://www.semanticscholar.org/';
    try {
        const s2Res = await fetch('stats.json');
        if (s2Res.ok) {
            const s2Data = await s2Res.json();
            if (!s2Data.error) {
                hIndex = s2Data.hIndex ?? '—';
                citationCount = s2Data.citationCount ?? '—';
                authorUrl = s2Data.authorUrl || authorUrl;
            }
        }
    } catch (e) {}

    let paperCount = '—';
    try {
        const pubRes = await fetch('publications.json');
        if (pubRes.ok) {
            const pubs = await pubRes.json();
            paperCount = Array.isArray(pubs) ? pubs.length : '—';
        }
    } catch (e) {}

    // 2. Build widget HTML with data-value attributes for animation
    widget.innerHTML = `
        <div class="stats-grid">
            <div class="stat">
                <span class="stat-number count-up" data-target="${hIndex}">0</span>
                <span class="stat-label">h-index</span>
            </div>
            <div class="stat">
                <span class="stat-number count-up" data-target="${citationCount}">0</span>
                <span class="stat-label">citations</span>
            </div>
            <div class="stat">
                <span class="stat-number count-up" data-target="${paperCount}">0</span>
                <span class="stat-label">papers</span>
            </div>
        </div>
        <p class="stats-source"><a href="${authorUrl}" target="_blank">via ADS</a> · paper count from <a href="https://orcid.org/0000-0001-5957-332X" target="_blank">ORCID</a></p>
    `;

    // 3. Animate counters when they scroll into view
    const counters = widget.querySelectorAll('.count-up');
    const observer = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const el = entry.target;
                const target = parseInt(el.getAttribute('data-target'), 10);
                if (isNaN(target)) return;
                let current = 0;
                const increment = target / 50; // smooth 50 steps
                const timer = setInterval(() => {
                    current += increment;
                    if (current >= target) {
                        el.textContent = target;
                        clearInterval(timer);
                    } else {
                        el.textContent = Math.floor(current);
                    }
                }, 20);
                obs.unobserve(el);
            }
        });
    }, { threshold: 0.5 });
    counters.forEach(counter => observer.observe(counter));
})();

// ---------- CODE REPOSITORIES LOADER ----------
(async function loadRepos() {
    const container = document.getElementById('repos-list');
    if (!container) return;
    const INITIAL_COUNT = 6;   // change as you wish

    try {
        const res = await fetch('repos.json');
        if (!res.ok) throw new Error('File not found');
        const repos = await res.json();

        if (repos.length === 0) {
            container.innerHTML = '<p>No public repositories found.</p>';
            return;
        }

        // Sort by stars descending (popularity) or by update date – your call
        //repos.sort((a, b) => b.stars - a.stars);
        repos.sort((a, b) => new Date(b.updated) - new Date(a.updated))

        function renderRepos(list) {
            let html = '';
            list.forEach(repo => {
                html += `
                    <div class="repo-card">
                        <div class="repo-name">
                            <a href="${repo.url}" target="_blank"><i class="fas fa-code-branch"></i> ${repo.name}</a>
                        </div>
                        <div class="repo-description">${repo.description || 'No description yet.'}</div>
                        <div class="repo-meta">
                            <span><i class="fas fa-circle" style="color: #00bcd4; font-size:0.6rem;"></i> ${repo.language}</span>
                            <span><i class="fas fa-star"></i> ${repo.stars}</span>
                            <span><i class="far fa-clock"></i> Updated ${new Date(repo.updated).toLocaleDateString()}</span>
                        </div>
                    </div>
                `;
            });
            return html;
        }

        // Show initial subset
        container.innerHTML = renderRepos(repos.slice(0, INITIAL_COUNT));

        // "Show more" button if needed
        if (repos.length > INITIAL_COUNT) {
            const remaining = repos.length - INITIAL_COUNT;
            const btnDiv = document.createElement('div');
            btnDiv.style.textAlign = 'center';
            btnDiv.style.marginTop = '1.5rem';
            const btn = document.createElement('button');
            btn.className = 'btn';
            btn.textContent = `Show all ${repos.length} repositories (${remaining} more)`;
            btn.addEventListener('click', () => {
                container.innerHTML = renderRepos(repos);
            });
            btnDiv.appendChild(btn);
            container.appendChild(btnDiv);
        }
    } catch (err) {
        console.error('Repos load error:', err);
        container.innerHTML = `<p>Unable to load repositories. <a href="https://github.com/dforero0896" target="_blank">Visit GitHub</a>.</p>`;
    }
})();
// ---------- PROFILE PICTURE LOADER ----------
(async function loadProfilePic() {
    const img = document.getElementById('hero-avatar');
    if (!img) return;

    try {
        const res = await fetch('profile.json');
        if (!res.ok) throw new Error('Profile file not found');
        const profile = await res.json();
        if (profile.avatar_url) {
            img.src = profile.avatar_url;
        }
    } catch (err) {
        console.warn('Could not load GitHub avatar, keeping placeholder:', err.message);
    }
})();