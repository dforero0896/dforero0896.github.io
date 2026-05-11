// update_publications.js
const fs = require('fs');

const ORCID = '0000-0001-5957-332X';
const BASE = 'https://pub.orcid.org/v3.0';

async function fetchJSON(url) {
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`Failed ${url}: ${res.status}`);
    return res.json();
}

async function main() {
    // 1. Get works summary (list of papers)
    const summary = await fetchJSON(`${BASE}/${ORCID}/works`);
    const groups = summary.group || [];

    // 2. Collect works of interest
    const works = [];
    for (const group of groups) {
        const workSummary = group['work-summary'][0];
        if (!workSummary) continue;
        const type = workSummary.type;
        if (!['journal-article', 'working-paper', 'conference-paper'].includes(type)) continue;

        // Get detail for full author list
        // The work summary contains a 'path' field like "/0000-0001-5957-332X/work/123456"
        const detailUrl = BASE + workSummary.path;
        const detail = await fetchJSON(detailUrl);

        // Extract authors
        const contributors = detail['contributors']?.['contributor'] || [];
        const authors = contributors.map(c => c['credit-name']?.value || '').filter(Boolean);

        // External IDs
        const extIds = detail['external-ids']?.['external-id'] || [];
        const doi = extIds.find(id => id['external-id-type'] === 'doi')?.['external-id-value'] || '';
        const arxiv = extIds.find(id => id['external-id-type'] === 'arxiv')?.['external-id-value'] || '';

        works.push({
            title: detail.title?.title?.value || 'No title',
            authors,
            journal: detail['journal-title']?.value || '',
            year: detail['publication-date']?.year?.value?.toString() || '',
            doi,
            arxiv,
            type
        });
    }

    // Sort by year descending
    works.sort((a, b) => (b.year || 0) - (a.year || 0));

    // Write JSON file
    fs.writeFileSync('publications.json', JSON.stringify(works, null, 2));
    console.log(`Updated publications.json with ${works.length} works.`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});