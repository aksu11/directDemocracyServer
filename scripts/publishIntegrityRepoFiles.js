#!/usr/bin/env node
/**
 * Julkaisee (luo tai päivittää) scripts/integrity-repo/-kansion tiedostot
 * (README.md, verify.js) GITHUB_INTEGRITY_REPO-repon juureen. Ajetaan
 * käsin aina kun noita tiedostoja muokataan - ei osa automaattista
 * ankkurointia (ks. src/services/integrityAnchor.js), koska nämä
 * muuttuvat harvoin eikä niitä ole tarkoitus ylikirjoittaa joka päivä.
 *
 * Käyttö: npm run publish-integrity-repo
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const GITHUB_API_BASE = 'https://api.github.com';
const SOURCE_DIR = path.join(__dirname, 'integrity-repo');
const FILES = ['README.md', 'verify.js'];

function getConfig() {
  const token = process.env.GITHUB_INTEGRITY;
  const repo = process.env.GITHUB_INTEGRITY_REPO;
  if (!token || !repo) {
    throw new Error('GITHUB_INTEGRITY ja GITHUB_INTEGRITY_REPO vaaditaan .env-tiedostossa.');
  }
  return { token, repo };
}

function githubRequest(config, apiPath, options = {}) {
  return fetch(`${GITHUB_API_BASE}${apiPath}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'DirectDemocracy-integrity-anchor',
      ...(options.headers || {}),
    },
  });
}

async function publishFile(config, filename) {
  const localPath = path.join(SOURCE_DIR, filename);
  const fileBuf = fs.readFileSync(localPath);
  const content = fileBuf.toString('base64');

  const existing = await githubRequest(config, `/repos/${config.repo}/contents/${filename}`);
  let sha;
  if (existing.status === 200) {
    sha = (await existing.json()).sha;
  } else if (existing.status !== 404) {
    throw new Error(`${filename}: tarkistus epäonnistui (${existing.status}): ${await existing.text().catch(() => '')}`);
  }

  const putRes = await githubRequest(config, `/repos/${config.repo}/contents/${filename}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: sha ? `Update ${filename}` : `Add ${filename}`,
      content,
      ...(sha && { sha }),
    }),
  });

  if (!putRes.ok) {
    throw new Error(`${filename}: kirjoitus epäonnistui (${putRes.status}): ${await putRes.text().catch(() => '')}`);
  }

  console.log(`✓ ${filename} ${sha ? 'päivitetty' : 'luotu'}`);
}

async function main() {
  const config = getConfig();
  for (const filename of FILES) {
    await publishFile(config, filename);
  }
}

main().catch((err) => {
  console.error('Julkaisu epäonnistui:', err.message);
  process.exit(1);
});
