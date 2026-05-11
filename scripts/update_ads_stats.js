// scripts/update_ads_stats.js
const fs = require('fs');

const ADS_API_KEY = process.env.ADS_API_KEY;
if (!ADS_API_KEY) {
    console.error('Missing ADS_API_KEY environment variable');
    process.exit(1);
}

const BASE = 'https://api.adsabs.harvard.edu/v1';
const QUERY = 'orcid:0000-0001-5957-332X';

async function fetchJSON(url, options = {}) {
    const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${ADS_API_KEY}`, 'Accept': 'application/json' },
        ...options
    });
    if (!res.ok) {
        throw new Error(`ADS API error ${res.status}: ${await res.text()}`);
    }
    return res.json();
}

async function main() {
    // 1. Get all bibcodes for the author (paginated, max 2000)
    let bibcodes = [];
    let start = 0;
    const rows = 2000; // max allowed
    console.log(`Fetching bibcodes for query: ${QUERY}`);

    while (true) {
        const url = `${BASE}/search/query?q=${encodeURIComponent(QUERY)}&fl=bibcode&rows=${rows}&start=${start}&sort=date%20desc`;
        const data = await fetchJSON(url);
        const docs = data.response?.docs || [];
        bibcodes.push(...docs.map(d => d.bibcode));
        const numFound = data.response?.numFound || 0;  // ← FIXED
        console.log(`Retrieved ${bibcodes.length} of ${numFound} bibcodes...`);
        if (start + rows >= numFound) break;
        start += rows;
    }

    console.log(`Total bibcodes collected: ${bibcodes.length}`);

    // 2. Get metrics (h-index, total citations) using POST /v1/metrics
    const metricsUrl = `${BASE}/metrics`;
    const metricsRes = await fetchJSON(metricsUrl, {
        method: 'POST',
        body: JSON.stringify({ bibcodes: bibcodes }),
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${ADS_API_KEY}`
        }
    });

    const metrics = metricsRes['indicators'] || {};
    const hIndex = metrics.h ? Math.round(metrics.h) : null;       // h-index
    const citationCount = metrics['citation stats']?.citations || null; // total citations
    const paperCount = metrics['basic stats']?.['number of papers'] || bibcodes.length;

    const stats = {
        hIndex,
        citationCount,
        paperCount,
        authorUrl: `https://ui.adsabs.harvard.edu/search/q=${encodeURIComponent(QUERY)}&sort=date%20desc`,
        updated: new Date().toISOString()
    };

    fs.writeFileSync('stats.json', JSON.stringify(stats, null, 2));
    console.log('Stats updated:', stats);
}

main().catch(err => {
    console.error('Failed to update ADS stats:', err);
    // Write an empty file to avoid page errors
    fs.writeFileSync('stats.json', JSON.stringify({ error: true }));
    process.exit(1);
});