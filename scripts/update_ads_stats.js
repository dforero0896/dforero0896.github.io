// scripts/update_ads_stats.js
const fs = require('fs');

const ADS_API_KEY = process.env.ADS_API_KEY;
if (!ADS_API_KEY) {
    console.error('Missing ADS_API_KEY environment variable');
    process.exit(1);
}

const BASE = 'https://api.adsabs.harvard.edu/v1';
const ORCID = '0000-0001-5957-332X';

async function fetchJSON(url, options = {}) {
    const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${ADS_API_KEY}`, 'Accept': 'application/json' },
        ...options
    });
    if (!res.ok) {
        throw new Error(`ADS API error ${res.status} on ${url}: ${await res.text()}`);
    }
    return res.json();
}

async function main() {
    // ---------- 1. Collect all bibcodes via ORCID search ----------
    let bibcodes = [];
    let start = 0;
    const rows = 2000; // maximum allowed per page
    const query = `orcid:${ORCID}`;

    console.log(`Fetching bibcodes for query: ${query}`);
    while (true) {
        const url = `${BASE}/search/query?q=${encodeURIComponent(query)}&fl=bibcode&rows=${rows}&start=${start}&sort=date%20desc`;
        const data = await fetchJSON(url);
        const docs = data.response?.docs || [];
        bibcodes.push(...docs.map(d => d.bibcode));
        const numFound = data.response?.numFound || 0;
        console.log(`Retrieved ${bibcodes.length} of ${numFound} bibcodes...`);
        if (start + rows >= numFound) break;
        start += rows;
    }
    console.log(`Total bibcodes collected: ${bibcodes.length}`);

    // ---------- 2. Get detailed metrics from bibcodes ----------
    const metricsUrl = `${BASE}/metrics`;
    const metricsRes = await fetchJSON(metricsUrl, {
        method: 'POST',
        body: JSON.stringify({ bibcodes: bibcodes.join(',') }),
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${ADS_API_KEY}`
        }
    });

    // The response is a flat object, e.g.:
    // { "basic stats": { "number of papers": 37 }, "citation stats": { "total number of citations": 4635 }, ... }
    const basicStats = metricsRes['basic stats'] || {};
    const citationStats = metricsRes['citation stats'] || {};

    const paperCount = basicStats['number of papers'] || bibcodes.length;
    const citationCount = citationStats['total number of citations'] || null;

    // ---------- 3. Get h-index from author metrics endpoint (not available in bibcode metrics) ----------
    const authorMetricsUrl = `${BASE}/metrics/author/ORCID:${ORCID}`;
    let hIndex = null;
    try {
        const authorMetrics = await fetchJSON(authorMetricsUrl);
        hIndex = authorMetrics.h ?? null;
        console.log('Author h-index:', hIndex);
    } catch (err) {
        console.warn('Could not fetch author h-index:', err.message);
    }

    // ---------- 4. Write stats.json ----------
    const stats = {
        hIndex,
        citationCount,
        paperCount,
        authorUrl: `https://ui.adsabs.harvard.edu/search/q=${encodeURIComponent(query)}&sort=date%20desc`,
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