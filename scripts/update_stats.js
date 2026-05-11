// scripts/update_stats.js
const fs = require('fs');

const ORCID = '0000-0001-5957-332X';
// Semantic Scholar author ID (fallback if ORCID lookup fails)
const MANUAL_AUTHOR_ID = '2117707118'; // e.g., '145121414' – get it from your S2 profile URL

async function fetchStats() {
    // First try ORCID lookup
    let url = `https://api.semanticscholar.org/graph/v1/author/ORCID:${ORCID}?fields=hIndex,citationCount,paperCount,url`;
    let res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    
    // If ORCID lookup fails, try manual ID if provided
    if (!res.ok && MANUAL_AUTHOR_ID) {
        console.warn(`ORCID lookup failed (${res.status}), trying author ID ${MANUAL_AUTHOR_ID}`);
        url = `https://api.semanticscholar.org/graph/v1/author/${MANUAL_AUTHOR_ID}?fields=hIndex,citationCount,paperCount,url`;
        res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    }
    
    if (!res.ok) throw new Error(`Semantic Scholar API error: ${res.status}`);
    const data = await res.json();
    
    if (!data || typeof data.paperCount === 'undefined') {
        throw new Error('Invalid author data returned');
    }
    
    return {
        hIndex: data.hIndex ?? null,
        citationCount: data.citationCount ?? null,
        paperCount: data.paperCount ?? null,
        authorUrl: data.url || null,
        updated: new Date().toISOString()
    };
}

fetchStats()
    .then(stats => {
        fs.writeFileSync('stats.json', JSON.stringify(stats, null, 2));
        console.log('Stats updated:', stats);
    })
    .catch(err => {
        console.error('Failed to update stats:', err);
        // Write an empty file to avoid page errors
        fs.writeFileSync('stats.json', JSON.stringify({ error: true }));
        process.exit(1);
    });