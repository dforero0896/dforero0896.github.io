// scripts/update_ads_stats.js
const fs = require('fs');

const ADS_API_KEY = process.env.ADS_API_KEY;
if (!ADS_API_KEY) {
    console.error('Missing ADS_API_KEY environment variable');
    process.exit(1);
}

const BASE = 'https://api.adsabs.harvard.edu/v1';
const ORCID = '0000-0001-5957-332X';

async function fetchMetrics() {
    const body = JSON.stringify({
        query: `orcid:${ORCID}`,
        types: ["h"]           // explicitly request h-index; other stats come by default
    });

    const res = await fetch(`${BASE}/metrics`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${ADS_API_KEY}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body
    });

    if (!res.ok) {
        throw new Error(`ADS metrics error ${res.status}: ${await res.text()}`);
    }
    return res.json();
}

async function main() {
    const data = await fetchMetrics();
    console.log('Metrics response:', JSON.stringify(data, null, 2));

    // The response is flat: { "h": 12, "citation stats": { "total number of citations": 4635 }, ... }
    const hIndex = data.h ?? null;
    const citationStats = data['citation stats'] || {};
    const citationCount = citationStats['total number of citations'] || null;
    const basicStats = data['basic stats'] || {};
    const paperCount = basicStats['number of papers'] || null;

    const stats = {
        hIndex,
        citationCount,
        paperCount,
        authorUrl: `https://ui.adsabs.harvard.edu/search/q=orcid%3A${ORCID}&sort=date%20desc`,
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