// scripts/update_profile.js
const fs = require('fs');

const GITHUB_TOKEN = process.env.GH_TOKEN;
if (!GITHUB_TOKEN) {
    console.error('Missing GH_TOKEN environment variable');
    process.exit(1);
}

const USERNAME = 'dforero0896'; // your GitHub username
const API_URL = `https://api.github.com/users/${USERNAME}`;

async function fetchProfile() {
    const response = await fetch(API_URL, {
        headers: {
            'Authorization': `token ${GITHUB_TOKEN}`,
            'User-Agent': 'update-profile-script',
            'Accept': 'application/vnd.github.v3+json'
        }
    });
    if (!response.ok) {
        throw new Error(`GitHub API error ${response.status}: ${await response.text()}`);
    }
    const data = await response.json();

    const profile = {
        name: data.name || USERNAME,
        avatar_url: data.avatar_url,
        bio: data.bio || '',
        blog: data.blog || '',
        location: data.location || ''
    };

    fs.writeFileSync('profile.json', JSON.stringify(profile, null, 2));
    console.log('Profile updated:', profile);
}

fetchProfile().catch(err => {
    console.error('Failed to update profile:', err);
    process.exit(1);
});