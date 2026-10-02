// scripts/update_repos.js
const fs = require('fs');

const GITHUB_TOKEN = process.env.GH_TOKEN;
if (!GITHUB_TOKEN) {
    console.error('Missing GH_TOKEN environment variable');
    process.exit(1);
}

const USERNAME = 'dforero0896';
// Repos you never want to show (e.g., the website repo itself)
const EXCLUDE_REPOS = [`${USERNAME}.github.io`];

const headers = {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'User-Agent': 'update-repos-script',
    'Accept': 'application/vnd.github.v3+json'
};

async function fetchJSON(url, extraHeaders = {}) {
    const res = await fetch(url, { headers: { ...headers, ...extraHeaders } });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    return res.json();
}

// 1. Own repositories (originals + forks, excluding the .github.io repo)
async function fetchOwnRepos() {
    const url = `https://api.github.com/users/${USERNAME}/repos?per_page=100&sort=updated`;
    const repos = await fetchJSON(url);
    return repos
        .filter(repo => !EXCLUDE_REPOS.includes(repo.name))   // keep forks
        .map(repo => ({
            name: repo.name,
            description: repo.description || '',
            language: repo.language || 'Other',
            stars: repo.stargazers_count,
            url: repo.html_url,
            updated: repo.updated_at,
            owner: repo.owner.login,
            isOwn: true,
            isFork: repo.fork,
            parent: repo.parent ? repo.parent.full_name : null
        }));
}

// 2. External repos you contribute to (aggregated from recent commits)
async function fetchContributedRepos() {
    const url = `https://api.github.com/search/commits?q=author:${USERNAME}&sort=committer-date&order=desc&per_page=100`;
    let data;
    try {
        data = await fetchJSON(url, { 'Accept': 'application/vnd.github.cloak-preview+json' });
    } catch (err) {
        console.warn('Search commits failed:', err.message);
        return [];
    }
    const items = data.items || [];
    const repoMap = new Map();

    items.forEach(item => {
        const repo = item.repository;
        if (!repo) return;
        if (EXCLUDE_REPOS.includes(repo.name)) return;
        if (repo.owner.login === USERNAME) return; // skip own repos and own forks (already listed)

        const fullName = repo.full_name;
        if (!repoMap.has(fullName)) {
            repoMap.set(fullName, {
                name: repo.name,
                description: repo.description || '',
                language: repo.language || 'Other',
                stars: repo.stargazers_count || 0,
                url: repo.html_url,
                updated: repo.updated_at,
                owner: repo.owner.login,
                isOwn: false,
                isFork: false,
                commits: 0
            });
        }
        repoMap.get(fullName).commits += 1;
    });

    return Array.from(repoMap.values());
}

async function main() {
    console.log('Fetching own repositories...');
    const ownRepos = await fetchOwnRepos();
    console.log(`Found ${ownRepos.length} own repos (including forks).`);

    console.log('Fetching contributed repositories...');
    const contributedRepos = await fetchContributedRepos();
    console.log(`Found ${contributedRepos.length} contributed repos.`);

    // Sort: own originals first (by stars, then updated), then own forks (by stars),
    // then external contributions (by commits, then stars)
    ownRepos.sort((a, b) => {
        if (a.isFork !== b.isFork) return a.isFork ? 1 : -1;   // originals before forks
        return b.stars - a.stars || new Date(b.updated) - new Date(a.updated);
    });
    contributedRepos.sort((a, b) => b.commits - a.commits || b.stars - a.stars);

    const allRepos = [...ownRepos, ...contributedRepos];

    fs.writeFileSync('repos.json', JSON.stringify(allRepos, null, 2));
    console.log(`Saved ${allRepos.length} repositories total.`);
}

main().catch(err => {
    console.error('Failed to fetch repos:', err);
    // Write an empty array so the page still works
    fs.writeFileSync('repos.json', JSON.stringify([]));
    process.exit(1);
});