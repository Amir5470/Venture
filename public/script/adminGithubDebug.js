import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js"
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js"
import { getDatabase, ref as rtdbRef, get as rtdbGet, set as rtdbSet } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js"
import { getFirestore, doc, getDoc, updateDoc, setDoc } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js"
import { firebaseConfig } from "./secrets.js"

// Configure admin emails here (or rely on DEV_PREVIEW which allows local testing)
const ADMIN_EMAILS = ["amirmechkour5474@gmail.com"]

const app = (getApps && getApps().length) ? getApps()[0] : initializeApp(firebaseConfig)
const auth = getAuth(app)
const db = getDatabase(app)
const fs = getFirestore(app)

const notSignedInEl = document.getElementById('not-signed-in')
const noAccessEl = document.getElementById('no-access')
const uiEl = document.getElementById('debug-ui')
const ownerInput = document.getElementById('owner-input')
const uidInput = document.getElementById('uid-input')
const loadRtdbBtn = document.getElementById('load-rtdb-btn')
const loadFsBtn = document.getElementById('load-fs-btn')
const openProfileBtn = document.getElementById('open-profile-btn')
const rtdbPre = document.getElementById('rtdb-result')
const fsPre = document.getElementById('fs-result')
const tokenInput = document.getElementById('token-input')
const fetchGithubBtn = document.getElementById('fetch-github-btn')

const DEV_PREVIEW = location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname === ''

function okToView(user) {
  if (!user) return false
  if (DEV_PREVIEW) return true
  const email = (user.email || '').toLowerCase()
  return ADMIN_EMAILS.some(e => e.toLowerCase() === email)
}

onAuthStateChanged(auth, async user => {
  if (!user) {
    notSignedInEl.style.display = 'block'
    noAccessEl.style.display = 'none'
    uiEl.style.display = 'none'
    return
  }
  notSignedInEl.style.display = 'none'
  if (!okToView(user)) {
    noAccessEl.style.display = 'block'
    uiEl.style.display = 'none'
    return
  }
  noAccessEl.style.display = 'none'
  uiEl.style.display = 'block'
})

async function loadRtdb(owner) {
  if (!owner) return rtdbPre.textContent = 'Missing owner'
  try {
    const snap = await rtdbGet(rtdbRef(db, `github/repos/${owner}`))
    if (!snap.exists()) return rtdbPre.textContent = 'No RTDB data for owner'
    const val = snap.val()
    rtdbPre.textContent = JSON.stringify(val, null, 2)
  } catch (e) {
    rtdbPre.textContent = 'RTDB read error: ' + String(e)
  }
}

async function loadFirestore(uid) {
  if (!uid) return fsPre.textContent = 'Missing uid'
  try {
    const snap = await getDoc(doc(fs, 'users', uid))
    if (!snap.exists()) return fsPre.textContent = 'No user doc for uid'
    const data = snap.data()
    fsPre.textContent = JSON.stringify(data.githubRepos || data.githubRepos || data, null, 2)
  } catch (e) {
    fsPre.textContent = 'Firestore read error: ' + String(e)
  }
}

loadRtdbBtn.addEventListener('click', () => loadRtdb(ownerInput.value.trim()))
loadFsBtn.addEventListener('click', () => loadFirestore(uidInput.value.trim()))
openProfileBtn.addEventListener('click', () => {
  const owner = ownerInput.value.trim()
  if (!owner) return alert('Enter owner to preview')
  window.open(`../profile.html?owner=${encodeURIComponent(owner)}`, '_blank')
})

// Pre-fill owner if present in query params
try {
  const qs = new URLSearchParams(location.search)
  const owner = qs.get('owner')
  if (owner && ownerInput) ownerInput.value = owner
  const uid = qs.get('uid')
  if (uid && uidInput) uidInput.value = uid
} catch (e) {}

async function fetchFromGitHubAndWrite(token, owner) {
  if (!token) return alert('Provide a personal access token for testing')
  if (!owner) return alert('Provide an owner')
  const query = `query($login:String!,$first:Int!){ repositoryOwner(login:$login){ ... on User { repositories(first:$first, ownerAffiliations: OWNER, orderBy:{field:STARGAZERS,direction:DESC}){ nodes{ name url stargazerCount pushedAt primaryLanguage { name } defaultBranchRef { target { ... on Commit { history { totalCount } } } } watchers { totalCount } } } } ... on Organization { repositories(first:$first, orderBy:{field:STARGAZERS,direction:DESC}){ nodes{ name url stargazerCount pushedAt primaryLanguage { name } defaultBranchRef { target { ... on Commit { history { totalCount } } } } watchers { totalCount } } } } }`;
  try {
    // First, verify token by calling /user and show scopes
    const infoResp = await fetch('https://api.github.com/user', { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' } })
    const infoTxt = await infoResp.text().catch(()=>'<no body>')
    let infoJson = null
    try { infoJson = JSON.parse(infoTxt) } catch(e) {}
    const scopes = infoResp.headers.get('x-oauth-scopes') || infoResp.headers.get('x-oauth-scopes') || ''
    rtdbPre.textContent = `GitHub /user response (${infoResp.status}), scopes: ${scopes}\n${infoTxt}\n\n`;
    if (!infoResp.ok) {
      return rtdbPre.textContent = `GitHub /user failed: ${infoResp.status}\n${infoTxt}`
    }

    const resp = await fetch('https://api.github.com/graphql', {
      method: 'POST', headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { login: owner, first: 50 } })
    })
    const text = await resp.text().catch(()=>'<no body>')
    let json = null
    try { json = JSON.parse(text) } catch(e) {}
    if (!resp.ok) {
      return rtdbPre.textContent = `GraphQL fetch failed ${resp.status}: ${text}`
    }
    // show full GraphQL response for debugging when no nodes
    const nodes = json?.data?.repositoryOwner?.repositories?.nodes || json?.data?.user?.repositories?.nodes || []
    if (!nodes || nodes.length === 0) {
      const errs = json?.errors ? `Errors: ${JSON.stringify(json.errors, null, 2)}\n` : ''
      rtdbPre.textContent += `GraphQL response did not contain repositories. ${errs}Attempting REST fallback...\n`;
      // REST fallback: list public repos via /users/:owner/repos
      try {
        const listResp = await fetch(`https://api.github.com/users/${encodeURIComponent(owner)}/repos?per_page=100`, { headers: { Authorization: token ? `token ${token}` : undefined, Accept: 'application/vnd.github.v3+json' } })
        const listText = await listResp.text().catch(()=>'<no body>')
        if (!listResp.ok) {
          rtdbPre.textContent += `REST list failed ${listResp.status}: ${listText}`
          return
        }
        const listJson = JSON.parse(listText)
        if (!Array.isArray(listJson) || listJson.length === 0) {
          rtdbPre.textContent += 'REST list returned no repositories.'
          return
        }
        const results = {}
        for (const item of listJson) {
          const name = item.name
          const stat = {
            owner,
            name,
            url: item.html_url,
            stargazerCount: item.stargazers_count || 0,
            watchersCount: item.watchers_count || 0,
            commits: null,
            pushedAt: item.pushed_at || null,
            primaryLanguage: item.language ? { name: item.language } : null,
          }
          try { await rtdbSet(rtdbRef(db, `github/repos/${owner}/${name}`), stat) } catch(e){ console.warn('RTDB write failed', e) }
          results[name] = stat
        }
        rtdbPre.textContent += `REST fallback wrote ${Object.keys(results).length} repos:\n${JSON.stringify(results, null, 2)}`
        // If a UID was provided, persist the mapping into Firestore so the profile shows widgets
        const targetUid = uidInput?.value?.trim()
        if (targetUid) {
          try {
            const updates = { githubOwner: owner, 'widgets.githubOwner': owner };
            try {
              await updateDoc(doc(fs, 'users', targetUid), updates);
            } catch (e) {
              await setDoc(doc(fs, 'users', targetUid), updates, { merge: true });
            }
            fsPre.textContent = `Wrote githubOwner=${owner} to users/${targetUid}`
          } catch (e) {
            fsPre.textContent = 'Failed to write githubOwner to Firestore: ' + String(e)
          }
        }
        return
      } catch (e) {
        rtdbPre.textContent += 'REST fallback error: ' + String(e)
        return
      }
    }
    const results = {}
    for (const n of nodes) {
      const name = n.name
      const stat = {
        owner,
        name,
        url: n.url || `https://github.com/${owner}/${name}`,
        stargazerCount: n.stargazerCount || 0,
        watchersCount: n.watchers?.totalCount || 0,
        commits: n.defaultBranchRef?.target?.history?.totalCount || null,
        pushedAt: n.pushedAt || null,
        primaryLanguage: n.primaryLanguage ? { name: n.primaryLanguage.name } : null,
      }
      try {
        await rtdbSet(rtdbRef(db, `github/repos/${owner}/${name}`), stat)
      } catch (e) {
        console.warn('RTDB write failed for', name, e)
      }
      results[name] = stat
    }
    rtdbPre.textContent = JSON.stringify(results, null, 2)
  } catch (e) {
    rtdbPre.textContent = 'Fetch/write error: ' + String(e)
  }
}

fetchGithubBtn?.addEventListener('click', () => fetchFromGitHubAndWrite(tokenInput.value.trim(), ownerInput.value.trim()))
