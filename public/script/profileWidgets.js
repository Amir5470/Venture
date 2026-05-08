import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js"
import { getDatabase, ref, onValue, get } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js"
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js"
import { getFirestore, doc, getDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js"
import { firebaseConfig, WORKER_URL } from "./secrets.js"

const app = (getApps && getApps().length) ? getApps()[0] : initializeApp(firebaseConfig)
const db = getDatabase(app)
const auth = getAuth(app)
const fs = getFirestore(app)

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
}

function renderEmpty(container) {
  container.innerHTML = `<div class="widget-empty">No GitHub data yet. Connect your account.</div>`
}

function renderInto(container, reposObj, widgets = {}) {
  const repos = Object.values(reposObj || {}).map(r => ({ ...(r || {}) }))
  if (!repos.length) { renderEmpty(container); return }

  const totalStars = repos.reduce((s, r) => s + (Number(r.stargazerCount) || 0), 0)
  const langCounts = {}
  for (const r of repos) {
    const lang = (r.primaryLanguage && r.primaryLanguage.name) || 'Unknown'
    langCounts[lang] = (langCounts[lang] || 0) + 1
  }
  const langEntries = Object.entries(langCounts).sort((a,b)=>b[1]-a[1])

  repos.sort((a,b)=>{
    const ta = new Date(a.pushedAt || a.last_updated || 0).getTime()
    const tb = new Date(b.pushedAt || b.last_updated || 0).getTime()
    return tb - ta
  })
  const recent = repos.slice(0,5)

  const showStars = widgets.showStars === undefined ? true : !!widgets.showStars
  const showLanguages = widgets.showLanguages === undefined ? true : !!widgets.showLanguages
  const showRecent = widgets.showRecent === undefined ? true : !!widgets.showRecent
  const showTop = widgets.showTopRepos === undefined ? true : !!widgets.showTopRepos

  const cards = []
  if (showStars) {
    cards.push(`
      <div class="widget-card">
        <div class="widget-title">Total Stars</div>
        <div class="widget-value">${totalStars}</div>
      </div>`)
  }
  if (showLanguages) {
    cards.push(`
      <div class="widget-card">
        <div class="widget-title">Language Mix</div>
        <div class="widget-langs">
          ${langEntries.map(([lang,count])=>`<span class="lang-pill">${escapeHtml(lang)} (${count})</span>`).join('')}
        </div>
      </div>`)
  }
  if (showRecent) {
    cards.push(`
      <div class="widget-card">
        <div class="widget-title">Recent Activity</div>
        <div class="widget-list">
          ${recent.map(r=>`<div class="repo-row"><a href="${escapeHtml(r.url||`https://github.com/${r.owner}/${r.name}`)}" target="_blank">${escapeHtml((r.owner||'') + '/' + (r.name||''))}</a><span class="repo-time">${new Date(r.pushedAt||r.last_updated||r.updated_at).toLocaleString()}</span></div>`).join('')}
        </div>
      </div>`)
  }

  if (showTop) {
    const topByStars = repos.slice().sort((a,b)=> (Number(b.stargazerCount)||0) - (Number(a.stargazerCount)||0)).slice(0,5)
    cards.push(`
      <div class="widget-card">
        <div class="widget-title">Top Repositories</div>
        <div class="widget-list">
          ${topByStars.map(r=>`<div class="repo-row"><a href="${escapeHtml(r.url||`https://github.com/${r.owner}/${r.name}`)}" target="_blank">${escapeHtml((r.owner||'') + '/' + (r.name||''))}</a><span class="repo-meta">★ ${Number(r.stargazerCount)||0} • 👁 ${Number(r.watchersCount||r.watchers||0)} • ⬤ ${Number(r.commits||0)}</span></div>`).join('')}
        </div>
      </div>`)
  }

  container.innerHTML = `<div class="widget-cards">${cards.join('')}</div>`
}

export function mountGitHubWidgets(containerId, uidParam) {
  const container = document.getElementById(containerId)
  if (!container) return

  console.debug('mountGitHubWidgets: mounted on', containerId, 'uidParam=', uidParam, 'search=', location.search)

  const qs = new URLSearchParams(location.search)
  // Allow previewing by GitHub owner (/?owner=username)
  const owner = qs.get('owner')
  const uidFromQuery = qs.get('uid')
  const uid = uidParam || uidFromQuery

  function subscribeToProfile(u) {
    // Read user's widget settings from Firestore and subscribe to their chosen owner
    (async () => {
      try {
        const snap = await getDoc(doc(fs, 'users', u));
        const data = snap.exists() ? snap.data() : {};
        const widgets = data.widgets || {};
        // prefer linked GitHub owner when user enabled 'useLinkedGithub'
        let owner = null;
        if (widgets.useLinkedGithub) {
          owner = data.githubOwner || widgets.githubOwner || null;
        } else {
          owner = widgets.githubOwner || data.githubOwner || null;
        }
        console.debug('profileWidgets: uid', u, 'widgets=', widgets, 'resolvedOwner=', owner)
        if (owner) {
          // annotate widgets with the uid of the user who owns this mapping
          widgets.ownerUid = u;
          subscribeToOwner(owner, widgets);
          return
        }

        // No explicit owner saved — try reading a token entry in RTDB which may include an `owner` field
        try {
          const tokenRef = ref(db, `github/tokens/${u}`);
          const tokenSnap = await get(tokenRef);
          if (tokenSnap && tokenSnap.exists()) {
            const tdata = tokenSnap.val();
            const tokenOwner = (tdata && (tdata.owner || tdata.githubOwner)) || null;
            if (tokenOwner) {
              console.debug('profileWidgets: found owner from RTDB token entry', tokenOwner)
              widgets.ownerUid = u;
              subscribeToOwner(tokenOwner, widgets);
              return
            }
          }
        } catch (e) {
          console.debug('profileWidgets: failed to read github/tokens for uid', u, e)
        }

        // No explicit owner saved — attempt to auto-detect a GitHub owner
        // by checking common candidates in RTDB (username, displayName variations)
        const candidates = [];
        if (data.username) candidates.push(String(data.username).trim());
        if (data.githubOwner) candidates.push(String(data.githubOwner).trim());
        if (data.displayName) candidates.push(String(data.displayName).trim());
        // add lower/no-space variants
        for (const c of [...candidates]) {
          const lc = (c || '').toLowerCase().replace(/\s+/g, '');
          if (lc && !candidates.includes(lc)) candidates.push(lc);
        }

        for (const cand of candidates) {
          if (!cand) continue;
          try {
            const nodeRef = ref(db, `github/repos/${encodeURIComponent(cand)}`);
            const nodeSnap = await get(nodeRef);
            if (nodeSnap.exists()) {
              console.debug('profileWidgets: auto-detected owner', cand, 'for uid', u)
              subscribeToOwner(cand, widgets);
              return
            }
          } catch (e) {
            console.warn('profileWidgets: auto-detect RTDB check failed for', cand, e)
          }
        }

        // nothing found
        renderEmpty(container);
      } catch (e) {
        console.warn('Failed to resolve profile widgets owner', e);
        renderEmpty(container);
      }
    })();
  }

  function subscribeToOwner(o, widgets = {}) {
    // Worker writes repo stats under /github/repos/{owner}/{repo}
    const node = ref(db, `github/repos/${o}`)
    console.debug('profileWidgets: subscribing to RTDB path', `github/repos/${o}`)
    let hasFetched = false
    const off = onValue(node, async snap => {
      if (!snap.exists()) {
        console.debug('profileWidgets: no data at', `github/repos/${o}`)
        // If we haven't already requested a backend fetch, try to trigger it.
        if (!hasFetched) {
          hasFetched = true
          try {
            // Ask the worker to populate RTDB. If widgets came from a user profile
            // we may have the uid in Firestore; attempt to pass it via widgets.ownerUid
            const uidParam = widgets.ownerUid || ''
            const base = (WORKER_URL && WORKER_URL.replace(/\/$/, '')) || location.origin
            const workerUrl = `${base.replace(/\/$/, '')}/github/fetch`
            const url = `${workerUrl}?owner=${encodeURIComponent(o)}${uidParam ? `&uid=${encodeURIComponent(uidParam)}` : ''}`
            console.debug('profileWidgets: requesting backend populate', url)
            try { await fetch(url, { method: 'GET' }) } catch (e) { console.warn('profileWidgets: backend fetch request failed', e) }
          } catch (e) { console.warn('profileWidgets: trigger backend fetch failed', e) }
        }
        // Try Firestore fallback: look for a user doc that has githubRepos snapshot
        (async () => {
          try {
            const fallback = await fetchReposFromFirestoreOwner(o)
            if (fallback && Object.keys(fallback).length) {
              console.debug('profileWidgets: using Firestore fallback for', o)
              renderInto(container, fallback, widgets)
            } else {
              renderEmpty(container)
            }
          } catch (e) {
            console.warn('profileWidgets: firestore fallback failed', e)
            renderEmpty(container)
          }
        })();
        return
      }
      const val = snap.val()
      console.debug('profileWidgets: snapshot value for', o, '=', val)
      // snap.val() is an object keyed by repo name -> repo data
      renderInto(container, val, widgets)
    }, err => {
      console.warn('profileWidgets: RTDB onValue error for', o, err)
      renderEmpty(container)
    })
  }

  // Firestore fallback: query users collection for a doc whose githubOwner matches
  async function fetchReposFromFirestoreOwner(owner) {
    try {
      const q = query(collection(fs, 'users'), where('githubOwner', '==', owner));
      const snaps = await getDocs(q);
      for (const d of snaps.docs) {
        const data = d.data();
        if (data && data.githubRepos) return data.githubRepos;
      }
      return null;
    } catch (e) {
      console.warn('fetchReposFromFirestoreOwner error', e);
      return null;
    }
  }

  if (owner) {
    subscribeToOwner(owner)
    return
  }

  if (uid) {
    subscribeToProfile(uid)
  } else {
    onAuthStateChanged(auth, user => {
      if (!user) { renderEmpty(container); return }
      subscribeToProfile(user.uid)
    })
  }
}

export default mountGitHubWidgets
