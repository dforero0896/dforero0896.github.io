// scripts/update_repos.js
const fs = require('fs');

const GITHUB_TOKEN = process.env.GH_TOKEN;
if (!GITHUB_TOKEN) {
    console.error('Missing GH_TOKEN environment variable');
    process.exit(1);
}

const USERNAME = 'dforero0896';   // <-- your GitHub username (from the domain)
const API_URL = `https://api.github.com/users/${USERNAME}/repos?per_page=100&sort=updated`;

async function fetchRepos() {
    const response = await fetch(API_URL, {
        headers: {
            'Authorization': `token ${GITHUB_TOKEN}`,
            'User-Agent': 'update-repos-script',
            'Accept': 'application/vnd.github.v3+json'
        }
    });
    if (!response.ok) {
        throw new Error(`GitHub API error ${response.status}: ${await response.text()}`);
    }
    const repos = await response.json();

    // Filter out forks if you prefer only original repos; keep all public ones for now
    const filtered = repos.filter(repo => !repo.fork); // remove this line if you want forks too

    const reposData = filtered.map(repo => ({
        name: repo.name,
        description: repo.description || '',
        language: repo.language || 'Other',
        stars: repo.stargazers_count,
        url: repo.html_url,
        updated: repo.updated_at
    }));

    fs.writeFileSync('repos.json', JSON.stringify(reposData, null, 2));
    console.log(`Saved ${reposData.length} repositories.`);
}

fetchRepos().catch(err => {
    console.error('Failed to fetch repos:', err);
    // Write an empty array so the page still works
    fs.writeFileSync('repos.json', JSON.stringify([]));
    process.exit(1);
});