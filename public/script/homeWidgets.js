import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { firebaseConfig, WORKER_URL } from "./secrets.js";

const app = (getApps && getApps().length) ? getApps()[0] : initializeApp(firebaseConfig);
const fs = getFirestore(app);

function escapeHtml(s) {
  if (!s && s !== 0) return '';
  return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function mountHomeWidgets(containerId, uidParam) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const qs = new URLSearchParams(location.search);
  const uid = uidParam || qs.get('uid');

  async function render(u) {
    container.innerHTML = `<div class="widget-loading">Loading widgets…</div>`;
    try {
      const snap = await getDoc(doc(fs, 'users', u));
      const data = snap && snap.exists() ? snap.data() : {};
      const widgets = data.widgets || {};

      const topLanguage = widgets.topLanguage || data.topLanguage || 'JavaScript';
      const spotifyNow = widgets.spotifyNow || data.spotifyNow || (widgets.spotifyUser ? `@${widgets.spotifyUser}` : '—');
      const discordPlaying = widgets.discordStatus || data.discordStatus || (widgets.showDiscord ? 'Available' : '—');

      // Try to compute commits from Firestore githubRepos snapshot if present
      let commitCount = null;
      try {
        if (data.githubRepos) {
          commitCount = Object.values(data.githubRepos).reduce((s, r) => s + (Number(r.commits) || 0), 0);
        }
      } catch (e) { /* ignore */ }
      if (!commitCount && widgets.githubCommits) commitCount = Number(widgets.githubCommits) || commitCount;

      const topLangHtml = `
        <div class="widget-card top-lang" id="widget-toplang">
          <div style="display:flex;align-items:center;gap:10px">
            <div class="widget-icon js-badge">JS</div>
            <div>
              <div class="widget-title">Top Language</div>
              <div class="widget-value" id="widget-toplang-value">${escapeHtml(topLanguage)}</div>
            </div>
          </div>
        </div>`;

      const discordHtml = `
        <div class="widget-card discord" id="widget-discord">
          <div style="display:flex;align-items:center;gap:10px">
            <div class="widget-icon discord-icon">${escapeHtml('🎮')}</div>
            <div>
              <div class="widget-title">Playing</div>
              <div class="widget-value" id="widget-discord-value">${escapeHtml(discordPlaying)}</div>
            </div>
          </div>
        </div>`;

      const githubHtml = `
        <div class="widget-card github" id="widget-github">
          <div style="display:flex;align-items:center;gap:10px">
            <div class="widget-icon github-icon">${escapeHtml('🐙')}</div>
            <div>
              <div class="widget-title" id="widget-github-title">${commitCount !== null ? 'Commits' : 'GitHub'}</div>
              <div class="widget-value" id="widget-github-value">${commitCount !== null ? escapeHtml(String(commitCount)) + ' commits' : 'No data'}</div>
            </div>
          </div>
        </div>`;

      const spotifyHtml = `
        <div class="widget-card spotify" id="widget-spotify">
          <div style="display:flex;align-items:center;gap:10px">
            <div class="widget-icon spotify-icon">${escapeHtml('♪')}</div>
            <div>
              <div class="widget-title">Top Track</div>
              <div class="widget-value" id="widget-spotify-value">${escapeHtml(spotifyNow)}</div>
            </div>
          </div>
        </div>`;

      container.innerHTML = `<div class="home-widgets-grid">${topLangHtml}${discordHtml}${githubHtml}${spotifyHtml}</div>`;

      // Attempt to fetch live statuses from Worker endpoints if configured
      const base = (WORKER_URL && WORKER_URL.replace(/\/$/, '')) || '';
      if (base) {
        (async () => {
          try {
            // Spotify
            try {
              const sres = await fetch(`${base}/spotify/fetch?uid=${encodeURIComponent(u)}`);
              if (sres.ok) {
                const sj = await sres.json();
                if (sj && sj.success && sj.nowPlaying) {
                  const el = document.getElementById('widget-spotify-value');
                  if (el) el.textContent = sj.nowPlaying;
                }
              }
            } catch (e) { console.warn('spotify fetch failed', e); }

            // Discord
            try {
              const dres = await fetch(`${base}/discord/fetch?uid=${encodeURIComponent(u)}`);
              if (dres.ok) {
                const dj = await dres.json();
                if (dj && dj.success && dj.status) {
                  const el = document.getElementById('widget-discord-value');
                  if (el) el.textContent = dj.status;
                }
              }
            } catch (e) { console.warn('discord fetch failed', e); }
            // GitHub: attempt to fetch repos for user's owner
            try {
              // resolve a probable owner from user doc / widgets
              const owner = (widgets && ((widgets.useLinkedGithub ? data.githubOwner || widgets.githubOwner : widgets.githubOwner) || data.githubOwner)) || data.username || data.githubOwner || data.displayName || null;
              if (owner) {
                const gres = await fetch(`${base}/github/fetch?owner=${encodeURIComponent(owner)}&uid=${encodeURIComponent(u)}&return=1`);
                if (gres.ok) {
                  const gj = await gres.json();
                  if (gj && gj.success && Array.isArray(gj.repos)) {
                    const repoCount = gj.repos.length;
                    const top = gj.repos.slice().sort((a,b)=> (Number(b.stargazers_count||0) - Number(a.stargazers_count||0)))[0];
                    const titleEl = document.getElementById('widget-github-title');
                    const valEl = document.getElementById('widget-github-value');
                    if (titleEl) titleEl.textContent = 'Repositories';
                    if (valEl) valEl.textContent = repoCount + ' repos' + (top ? ` • ${owner}/${top.name} ★${top.stargazers_count||0}` : '');
                  }
                }
              }
            } catch (e) { console.warn('github fetch failed', e); }
          } catch (e) { console.warn('worker widget fetches failed', e); }
        })();
      }
    } catch (e) {
      container.innerHTML = `<div class="widget-empty">Failed to load widgets</div>`;
      console.warn('mountHomeWidgets error', e);
    }
  }

  if (uid) render(uid);
}

export default mountHomeWidgets;
