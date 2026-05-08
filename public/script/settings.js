import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut,
  updateEmail,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  deleteUser,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  GoogleAuthProvider,
  GithubAuthProvider,
  signInWithPopup,
  linkWithPopup,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  updateDoc,
  setDoc,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { getDatabase, ref as rtdbRef, set as rtdbSet } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";
import { arrayUnion } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import {
  getStorage,
  ref as sRef,
  uploadString,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js";
import { firebaseConfig } from "./secrets.js";

// ── Firebase init ─────────────────────────────────────────────────────────────
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const fs = getFirestore(app);
const db = getDatabase(app);
const storage = getStorage(app);

// Local dev preview mode (bypass Firebase for UI testing)
const DEV_PREVIEW =
  location.hostname === "localhost" ||
  location.hostname === "127.0.0.1" ||
  location.hostname === "";

// ── DOM helpers ───────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg, isError = false) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast-show" + (isError ? " toast-error" : "");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => {
    t.textContent = "";
    t.className = "";
  }, 3200);
}

// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll(".settings-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    // deactivate tabs and panels
    document
      .querySelectorAll(".settings-tab")
      .forEach((t) => t.classList.remove("active-tab"));
    document
      .querySelectorAll(".tab-panel")
      .forEach((p) => p.classList.remove("active-panel"));

    // activate clicked tab + target panel using classes only
    tab.classList.add("active-tab");
    const panel = document.getElementById(tab.dataset.target);
    if (panel) panel.classList.add("active-panel");

    // Update main header title/description to match active panel
    const labelEl = tab.querySelector('.tab-label');
    const title = (labelEl && labelEl.textContent.trim()) || tab.textContent.trim();
    const descMap = {
      'panel-profile': 'Manage your public identity and account settings.',
      'panel-account': 'Account-related settings like email and password.',
      'panel-linked-accounts': 'Connect or disconnect external providers (Google, GitHub).',
      'panel-appearance': 'Customize theme, accent color, and chat appearance.',
      'panel-widgets': 'Choose which widgets appear on your profile and Home page.',
      'panel-privacy': 'Control discoverability and data-sharing settings for your account.'
    };
    const desc = descMap[tab.dataset.target] || '';
    const mainTitle = document.querySelector('.main-header h1');
    const mainDesc = document.querySelector('.main-header p');
    if (mainTitle) mainTitle.textContent = title;
    if (mainDesc) mainDesc.textContent = desc;
  });
});

// Initialize header based on currently active tab (on page load)
(() => {
  const active = document.querySelector('.settings-tab.active-tab') || document.querySelector('.settings-tab');
  if (!active) return;
  const labelEl = active.querySelector('.tab-label');
  const title = (labelEl && labelEl.textContent.trim()) || active.textContent.trim();
  const descMap = {
    'panel-profile': 'Manage your public identity and account settings.',
    'panel-account': 'Account-related settings like email and password.',
    'panel-linked-accounts': 'Connect or disconnect external providers (Google, GitHub).',
    'panel-appearance': 'Customize theme, accent color, and chat appearance.',
    'panel-widgets': 'Choose which widgets appear on your profile and Home page.',
    'panel-privacy': 'Control discoverability and data-sharing settings for your account.'
  };
  const desc = descMap[active.dataset.target] || '';
  const mainTitle = document.querySelector('.main-header h1');
  const mainDesc = document.querySelector('.main-header p');
  if (mainTitle) mainTitle.textContent = title;
  if (mainDesc) mainDesc.textContent = desc;
})();

// ── Auth state ────────────────────────────────────────────────────────────────
let currentUser = null;

// Provider instances for linking
const googleProvider = new GoogleAuthProvider();
const githubProvider = new GithubAuthProvider();
// Request repo scopes so we can read user's repositories when linking
try { githubProvider.addScope('repo'); } catch (e) { /* ignore if not supported */ }

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    if (DEV_PREVIEW) {
      // create a lightweight dev user for UI testing
      currentUser = {
        uid: "dev-user",
        displayName: "Local Dev",
        email: "dev@example.com",
        photoURL: null,
        metadata: { creationTime: new Date().toISOString() },
      };
      // Load any saved dev profile from localStorage
      const saved = localStorage.getItem("dev-profile");
      if (saved) {
        try {
          const data = JSON.parse(saved);
          $("display-name-input").value =
            data.username || currentUser.displayName;
          $("bio-input").value = data.bio || "";
          $("profile-display-name").textContent =
            data.username || currentUser.displayName;
          $("profile-bio-preview").textContent =
            data.bio || "...";
          if (data.pfp) $("profile-pic").src = data.pfp;
        } catch (_) {}
      } else {
        // populate minimal fields
        $("display-name-input").value = currentUser.displayName;
        $("profile-display-name").textContent = currentUser.displayName;
        $("current-email").textContent = currentUser.email;
        $("current-username").textContent = currentUser.displayName;
        $("member-since").textContent = new Date().toLocaleDateString();
      }
      // restore privacy toggles from localStorage in dev preview
      try {
        const pv = localStorage.getItem("venture-profile-visible") === "true";
        const sc = localStorage.getItem("venture-searchable") === "true";
        const rr = localStorage.getItem("venture-read-receipts") === "true";
        const pvEl = $("profile-visibility-toggle");
        const scEl = $("searchability-toggle");
        const rrEl = $("read-receipts-toggle");
        if (pvEl) pvEl.checked = pv;
        if (scEl) scEl.checked = sc;
        if (rrEl) rrEl.checked = rr;
      } catch (e) {}
      updateBioCount();
      refreshLinkedButtons();
      return;
    }
    go('/');
    return;
  }
  currentUser = user;
  await loadProfile(user);
  populateAccountInfo(user);
  try {
    refreshLinkedButtons();
  } catch (e) {}
});

// ── Profile: load from Firestore ──────────────────────────────────────────────
async function loadProfile(user) {
  // In DEV_PREVIEW, avoid Firestore; load from localStorage if present
  if (DEV_PREVIEW) {
    const saved = localStorage.getItem("dev-profile");
    let data = {};
    if (saved) {
      try {
        data = JSON.parse(saved);
      } catch (_) {
        data = {};
      }
    }

    $("display-name-input").value = data.username || user.displayName || "";
    $("bio-input").value = data.bio || "";
    updateBioCount();

    const titleEl = $("profile-display-name");
    const bioPreview = $("profile-bio-preview");
    if (titleEl)
      titleEl.textContent = data.username || user.displayName || "Your Name";
    if (bioPreview)
      bioPreview.textContent = data.bio || "Short bio preview appears here.";

    const pfp = data.pfp || user.photoURL || null;
    if (pfp) $("profile-pic").src = pfp;
    return;
  }

  const snap = await getDoc(doc(fs, "users", user.uid));
  const data = snap.exists() ? snap.data() : {};

  $("display-name-input").value = data.username || user.displayName || "";
  $("bio-input").value = data.bio || "";
  updateBioCount();

  // update hero preview/title
  const titleEl = $("profile-display-name");
  const bioPreview = $("profile-bio-preview");
  if (titleEl)
    titleEl.textContent = data.username || user.displayName || "Your Name";
  if (bioPreview)
    bioPreview.textContent = data.bio || "Short bio preview appears here.";

  const pfp = data.pfp || user.photoURL || null;
  if (pfp) $("profile-pic").src = pfp;
  // Initialize privacy toggles from Firestore data when available
  try {
    const profileVisibleEl = $("profile-visibility-toggle");
    const searchabilityEl = $("searchability-toggle");
    const readReceiptsEl = $("read-receipts-toggle");
    const privacy = data.privacy || {};
    if (profileVisibleEl) {
      profileVisibleEl.checked = !!privacy.profileVisible;
      localStorage.setItem("venture-profile-visible", profileVisibleEl.checked);
    }
    if (searchabilityEl) {
      searchabilityEl.checked = !!privacy.searchable;
      localStorage.setItem("venture-searchable", searchabilityEl.checked);
    }
    if (readReceiptsEl) {
      readReceiptsEl.checked = !!privacy.readReceipts;
      localStorage.setItem("venture-read-receipts", readReceiptsEl.checked);
    }
    // Initialize widget settings UI
    try {
      const widgets = data.widgets || {};
      const showStars = widgets.showStars === undefined ? true : !!widgets.showStars;
      const showLangs = widgets.showLanguages === undefined ? true : !!widgets.showLanguages;
      const showRecent = widgets.showRecent === undefined ? true : !!widgets.showRecent;
      const useLinked = widgets.useLinkedGithub === undefined ? true : !!widgets.useLinkedGithub;
      const owner = widgets.githubOwner || "";

      const elShowStars = $("show-stars-toggle");
      const elShowLangs = $("show-langs-toggle");
      const elShowRecent = $("show-recent-toggle");
      const elUseLinked = $("use-linked-github-toggle");
      const elOwner = $("github-owner-input");

      if (elShowStars) elShowStars.checked = showStars;
      if (elShowLangs) elShowLangs.checked = showLangs;
      if (elShowRecent) elShowRecent.checked = showRecent;
      if (elUseLinked) elUseLinked.checked = useLinked;
      if (elOwner) elOwner.value = owner;
    } catch (e) { console.warn('Failed to initialize widget controls', e); }
  } catch (e) {
    console.warn("Unable to initialize privacy toggles", e);
  }
}

// ── Profile: edit / save / cancel ────────────────────────────────────────────
let editingProfile = false;

$("edit-profile-btn").addEventListener("click", () => {
  editingProfile = true;
  $("display-name-input").disabled = false;
  $("bio-input").disabled = false;
  $("edit-profile-btn").style.display = "none";
  $("save-changes-btn").style.display = "block";
  $("cancel-edit-btn").style.display = "block";
  $("display-name-input").focus();
  const card = document.querySelector(".profile-card");
  if (card) card.classList.add("editing");
});

$("cancel-edit-btn").addEventListener("click", () => {
  editingProfile = false;
  $("display-name-input").disabled = true;
  $("bio-input").disabled = true;
  $("edit-profile-btn").style.display = "block";
  $("save-changes-btn").style.display = "none";
  $("cancel-edit-btn").style.display = "none";
  // reload original values
  loadProfile(currentUser);
  const card = document.querySelector(".profile-card");
  if (card) card.classList.remove("editing");
});

$("save-changes-btn").addEventListener("click", async () => {
  if (!currentUser) return;
  const newName = $("display-name-input").value.trim();
  const newBio = $("bio-input").value.trim();
  if (!newName) {
    toast("Display name can't be empty.", true);
    return;
  }

  try {
    if (DEV_PREVIEW) {
      // Persist dev profile locally
      const dev = { username: newName, bio: newBio, pfp: $("profile-pic").src };
      localStorage.setItem("dev-profile", JSON.stringify(dev));
      toast("Profile saved (local preview)");
    } else {
      await updateDoc(doc(fs, "users", currentUser.uid), {
        username: newName,
        bio: newBio,
      });
      toast("Profile saved!");
    }
    $("display-name-input").disabled = true;
    $("bio-input").disabled = true;
    $("edit-profile-btn").style.display = "block";
    $("save-changes-btn").style.display = "none";
    $("cancel-edit-btn").style.display = "none";
    editingProfile = false;
    // remove editing state so hero edits hide again
    const card = document.querySelector(".profile-card");
    if (card) card.classList.remove("editing");
    // update hero preview/title after save
    const titleEl = $("profile-display-name");
    const bioPreview = $("profile-bio-preview");
    if (titleEl) titleEl.textContent = newName;
    if (bioPreview)
      bioPreview.textContent = newBio || "Short bio preview appears here.";
  } catch (e) {
    console.error(e);
    toast("Failed to save profile.", true);
  }
});

// bio char counter
$("bio-input").addEventListener("input", updateBioCount);
function updateBioCount() {
  const max = 150;
  const el = $("bio-input");
  const len = (el.value || "").length;
  const rem = max - len;
  const counter = $("bio-char-count");
  counter.textContent = `${len} / ${max}`;
  counter.setAttribute("aria-live", "polite");
  // visual hint when approaching limit
  if (rem < 0) counter.style.color = "var(--danger)";
  else if (rem <= 10) counter.style.color = "var(--accent)";
  else counter.style.color = "var(--text-muted)";
  // update small preview in hero (if present)
  const preview = document.getElementById("profile-bio-preview");
  if (preview)
    preview.textContent = el.value.trim() || "Short bio preview appears here.";
}

// ── Profile picture upload ────────────────────────────────────────────────────
$("change-pfp-btn").addEventListener("click", () =>
  $("pfp-file-input").click(),
);

$("pfp-file-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file || !currentUser) return;
  if (file.size > 5 * 1024 * 1024) {
    toast("Image must be under 5MB.", true);
    return;
  }

  const reader = new FileReader();
  reader.onload = async (ev) => {
    const dataUrl = ev.target.result;
    const base64 = dataUrl.split(",")[1];
    const mimeType = file.type;

    try {
      if (DEV_PREVIEW) {
        // In dev preview, just use the data URL and persist locally
        $("profile-pic").src = dataUrl;
        const saved = JSON.parse(localStorage.getItem("dev-profile") || "{}");
        saved.pfp = dataUrl;
        localStorage.setItem("dev-profile", JSON.stringify(saved));
        toast("Profile picture updated (local preview)");
      } else {
        const storageRef = sRef(storage, `pfps/${currentUser.uid}`);
        await uploadString(storageRef, base64, "base64", {
          contentType: mimeType,
        });
        const url = await getDownloadURL(storageRef);

        $("profile-pic").src = url;
        await updateDoc(doc(fs, "users", currentUser.uid), { pfp: url });
        toast("Profile picture updated!");
      }
    } catch (err) {
      console.error(err);
      toast("Failed to upload photo.", true);
    }
  };
  reader.readAsDataURL(file);
});

// ── Account: populate info ────────────────────────────────────────────────────
function populateAccountInfo(user) {
  $("current-email").textContent = user.email || "—";
  $("current-username").textContent = user.displayName || "—";
  const created = user.metadata?.creationTime;
  $("member-since").textContent = created
    ? new Date(created).toLocaleDateString([], {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "—";
}

// ── Account: change email ─────────────────────────────────────────────────────
$("change-email-btn").addEventListener("click", async () => {
  const newEmail = $("new-email-input").value.trim();
  const pass = $("email-pass-input").value;

  if (!newEmail) {
    toast("Enter a new email.", true);
    return;
  }
  if (!pass) {
    toast("Enter your current password.", true);
    return;
  }

  try {
    const cred = EmailAuthProvider.credential(currentUser.email, pass);
    await reauthenticateWithCredential(currentUser, cred);
    await updateEmail(currentUser, newEmail);
    await updateDoc(doc(fs, "users", currentUser.uid), { email: newEmail });
    $("current-email").textContent = newEmail;
    $("new-email-input").value = "";
    $("email-pass-input").value = "";
    toast("Email updated!");
  } catch (e) {
    console.error(e);
    toast(friendlyError(e.code), true);
  }
});

// ── Account: change password ──────────────────────────────────────────────────
$("change-pass-btn").addEventListener("click", async () => {
  const current = $("current-pass-input").value;
  const newPass = $("new-pass-input").value;
  const confirm = $("confirm-pass-input").value;

  if (!current) {
    toast("Enter your current password.", true);
    return;
  }
  if (newPass.length < 6) {
    toast("New password must be at least 6 characters.", true);
    return;
  }
  if (newPass !== confirm) {
    toast("Passwords don't match.", true);
    return;
  }

  try {
    const cred = EmailAuthProvider.credential(currentUser.email, current);
    await reauthenticateWithCredential(currentUser, cred);
    await updatePassword(currentUser, newPass);
    $("current-pass-input").value = "";
    $("new-pass-input").value = "";
    $("confirm-pass-input").value = "";
    toast("Password updated!");
  } catch (e) {
    console.error(e);
    toast(friendlyError(e.code), true);
  }
});

// ── Account: delete account ───────────────────────────────────────────────────
$("delete-account-btn").addEventListener("click", async () => {
  const confirmed = confirm(
    "Are you sure you want to delete your account? This cannot be undone.",
  );
  if (!confirmed) return;
  const pass = prompt("Enter your password to confirm:");
  if (!pass) return;

  try {
    const cred = EmailAuthProvider.credential(currentUser.email, pass);
    await reauthenticateWithCredential(currentUser, cred);
    await deleteUser(currentUser);
    go('/');
  } catch (e) {
    console.error(e);
    toast(friendlyError(e.code), true);
  }
});

// ── Logout ────────────────────────────────────────────────────────────────────
$("logout-button").addEventListener("click", async () => {
  await signOut(auth);
  go('/');
});

// ── Appearance: dark mode ─────────────────────────────────────────────────────
const darkToggle = $("dark-mode-toggle");

// Load saved preference
if (localStorage.getItem("venture-dark") === "true") {
  document.body.classList.add("dark");
  darkToggle.checked = true;
}

darkToggle.addEventListener("change", () => {
  document.body.classList.toggle("dark", darkToggle.checked);
  localStorage.setItem("venture-dark", darkToggle.checked);
});

// ── Appearance: accent color ──────────────────────────────────────────────────
const savedAccent = localStorage.getItem("venture-accent") || "#4285f4";
applyAccent(savedAccent);
markActiveSwatch(savedAccent);

document.querySelectorAll(".swatch").forEach((sw) => {
  sw.addEventListener("click", () => {
    const color = sw.dataset.color;
    applyAccent(color);
    localStorage.setItem("venture-accent", color);
    markActiveSwatch(color);
  });
});

$("custom-color-picker").addEventListener("input", (e) => {
  const color = e.target.value;
  applyAccent(color);
  localStorage.setItem("venture-accent", color);
  markActiveSwatch(null);
});

function applyAccent(color) {
  document.documentElement.style.setProperty("--accent", color);
  // Darken slightly for hover
  document.documentElement.style.setProperty("--accent-hover", color);
  $("custom-color-picker").value = color;
}

function markActiveSwatch(color) {
  document.querySelectorAll(".swatch").forEach((sw) => {
    sw.classList.toggle("active-swatch", sw.dataset.color === color);
  });
}

// ── Appearance: font size ─────────────────────────────────────────────────────
const fontSlider = $("font-size-slider");
const fontPreview = $("font-size-preview");
const savedFont = localStorage.getItem("venture-font-size") || "15";

fontSlider.value = savedFont;
fontPreview.style.fontSize = savedFont + "px";
document.body.style.fontSize = savedFont + "px";

fontSlider.addEventListener("input", () => {
  const size = fontSlider.value;
  fontPreview.style.fontSize = size + "px";
  document.body.style.fontSize = size + "px";
  localStorage.setItem("venture-font-size", size);
});

// Update visible numeric label for slider if present
const fontSizeValue = $("font-size-value");
if (fontSizeValue) fontSizeValue.textContent = savedFont;
fontSlider.addEventListener("input", () => {
  const size = fontSlider.value;
  if (fontSizeValue) fontSizeValue.textContent = size;
});

// ── Appearance: bubble style ──────────────────────────────────────────────────
const savedBubble = localStorage.getItem("venture-bubble-style") || "rounded";
applyBubbleStyle(savedBubble);

document.querySelectorAll(".bubble-option").forEach((opt) => {
  opt.addEventListener("click", () => {
    document
      .querySelectorAll(".bubble-option")
      .forEach((o) => o.classList.remove("active-bubble"));
    opt.classList.add("active-bubble");
    const style = opt.dataset.style;
    applyBubbleStyle(style);
    localStorage.setItem("venture-bubble-style", style);
  });
});

function applyBubbleStyle(style) {
  const map = { rounded: "16px", square: "4px", pill: "999px" };
  document.documentElement.style.setProperty(
    "--bubble-radius",
    map[style] || "16px",
  );
  const btn = document.querySelector(`[data-style="${style}"]`);
  if (btn) {
    document
      .querySelectorAll(".bubble-option")
      .forEach((o) => o.classList.remove("active-bubble"));
    btn.classList.add("active-bubble");
  }
}

// ── Error messages ────────────────────────────────────────────────────────────
function friendlyError(code) {
  const map = {
    "auth/wrong-password": "Incorrect password.",
    "auth/invalid-email": "Invalid email address.",
    "auth/email-already-in-use": "That email is already in use.",
    "auth/requires-recent-login": "Please log out and log back in first.",
    "auth/weak-password": "Password is too weak.",
    "auth/too-many-requests": "Too many attempts. Try again later.",
  };
  return map[code] || "Something went wrong. Check the console.";
}

// Fetch top repos via GitHub GraphQL (using the user's OAuth token) and
// persist a copy to the Realtime Database (for widgets) and Firestore (fallback).
async function fetchAndPersistGitHubRepos(token, owner, uid) {
  if (!token || !owner || !uid) return;
  try {
    const query = `query($login:String!,$first:Int!){ repositoryOwner(login:$login){ ... on User { repositories(first:$first, ownerAffiliations: OWNER, orderBy:{field:STARGAZERS,direction:DESC}){ nodes{ name url stargazerCount pushedAt primaryLanguage { name } defaultBranchRef { target { ... on Commit { history { totalCount } } } } watchers { totalCount } } } } ... on Organization { repositories(first:$first, orderBy:{field:STARGAZERS,direction:DESC}){ nodes{ name url stargazerCount pushedAt primaryLanguage { name } defaultBranchRef { target { ... on Commit { history { totalCount } } } } watchers { totalCount } } } } }`;
    console.debug('fetchAndPersistGitHubRepos: starting fetch for owner', owner)
    const resp = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { login: owner, first: 50 } }),
    });
    if (!resp.ok) {
      console.warn('GitHub GraphQL fetch failed', resp.status);
      return;
    }
    const json = await resp.json();
    const nodes = json.data?.user?.repositories?.nodes || [];
    const snapshotForFs = {};
    for (const n of nodes) {
      const name = n.name;
      const stat = {
        owner,
        name,
        url: n.url || `https://github.com/${owner}/${name}`,
        stargazerCount: n.stargazerCount || 0,
        watchersCount: n.watchers?.totalCount || 0,
        commits: n.defaultBranchRef?.target?.history?.totalCount || null,
        pushedAt: n.pushedAt || null,
        primaryLanguage: n.primaryLanguage ? { name: n.primaryLanguage.name } : null,
      };
      // Write to RTDB for widgets (best-effort)
      try {
        await rtdbSet(rtdbRef(db, `github/repos/${owner}/${name}`), stat);
        console.debug('fetchAndPersistGitHubRepos: wrote RTDB', owner, name)
      } catch (e) {
        console.warn('RTDB write failed for', owner, name, e);
      }
      snapshotForFs[name] = stat;
    }

    // Persist a snapshot to Firestore as a fallback for widgets
    try {
      await updateDoc(doc(fs, 'users', uid), { githubRepos: snapshotForFs });
    } catch (e) {
      try {
        await setDoc(doc(fs, 'users', uid), { githubRepos: snapshotForFs }, { merge: true });
      } catch (ee) {
        console.warn('Failed to persist githubRepos to Firestore', ee);
      }
    }
  } catch (e) {
    console.warn('fetchAndPersistGitHubRepos failed', e);
  }
}

// ── Linked accounts (placeholder actions) ───────────────────────────────────
const linkGoogleBtn = $("link-google-btn");
if (linkGoogleBtn) {
  linkGoogleBtn.addEventListener("click", async () => {
    if (!currentUser) {
      toast("Not signed in.", true);
      return;
    }
    if (DEV_PREVIEW) {
      toast("Linking not available in local preview.", true);
      return;
    }
    try {
      const res = await linkWithPopup(currentUser, googleProvider);
      // update Firestore record: add provider tag and update pfp/email if present
      try {
        await updateDoc(doc(fs, "users", currentUser.uid), {
          providers: arrayUnion("google"),
          pfp: res.user.photoURL || currentUser.photoURL || null,
          email: res.user.email || currentUser.email || null,
        });
      } catch (ee) {
        console.warn("Failed to update user providers in Firestore", ee);
      }
      // refresh local currentUser from result
      currentUser = res.user || currentUser;
      toast("Google account linked!");
      refreshLinkedButtons();
    } catch (e) {
      console.error(e);
      if (
        e.code === "auth/account-exists-with-different-credential" ||
        e.code === "auth/credential-already-in-use"
      ) {
        toast("That Google account is already linked elsewhere.", true);
      } else {
        toast(friendlyError(e.code), true);
      }
    }
  });
}
const linkGithubBtn = $("link-github-btn");
if (linkGithubBtn) {
  linkGithubBtn.addEventListener("click", async () => {
    if (!currentUser) {
      toast("Not signed in.", true);
      return;
    }
    if (DEV_PREVIEW) {
      toast("Linking not available in local preview.", true);
      return;
    }
    try {
      const res = await linkWithPopup(currentUser, githubProvider);
      currentUser = res.user || currentUser;

      // Try to obtain the OAuth access token and fetch the GitHub login
      let githubLogin = null;
      let githubToken = null;
      try {
        console.debug('link-github: oauth result', res)
        const cred = GithubAuthProvider.credentialFromResult(res);
        console.debug('link-github: credentialFromResult', cred)
        const token = cred?.accessToken || res?.credential?.accessToken || res?.additionalUserInfo?.profile?.access_token;
        githubToken = token || null;
        console.debug('link-github: resolved token present?', !!githubToken)
        if (token) {
          const r = await fetch("https://api.github.com/user", {
            headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
          });
          if (r.ok) {
            const profile = await r.json();
            githubLogin = profile.login || null;
          }
        }
      } catch (err) {
        console.warn("Could not fetch GitHub profile", err);
      }

      try {
        const updates = {
          providers: arrayUnion("github"),
          pfp: res.user.photoURL || currentUser.photoURL || null,
          email: res.user.email || currentUser.email || null,
        };
        if (githubLogin) {
          updates.githubOwner = githubLogin;
          updates['widgets.githubOwner'] = githubLogin;
          // prefer linked account for widgets by default
          updates['widgets.useLinkedGithub'] = true;
        }

        try {
          await updateDoc(doc(fs, "users", currentUser.uid), updates);
        } catch (err) {
          // if the user doc doesn't exist yet, create/merge
          await setDoc(doc(fs, "users", currentUser.uid), updates, { merge: true });
        }
      } catch (ee) {
        console.warn("Failed to update user providers in Firestore", ee);
      }

      toast("GitHub account linked!");
      refreshLinkedButtons();

      // Kick off an initial fetch of the user's top repos and persist them
      // so the profile widgets can show up immediately.
      try {
        if (githubToken && githubLogin) {
          // fire-and-forget; best-effort
          fetchAndPersistGitHubRepos(githubToken, githubLogin, currentUser.uid);
        }
      } catch (e) {
        console.warn('Failed to trigger repo fetch', e);
      }
    } catch (e) {
      console.error(e);
      if (
        e.code === "auth/account-exists-with-different-credential" ||
        e.code === "auth/credential-already-in-use"
      ) {
        toast("That GitHub account is already linked elsewhere.", true);
      } else {
        toast(friendlyError(e.code), true);
      }
    }
  });
}

// Refresh linked button states based on currentUser.providerData
function refreshLinkedButtons() {
  try {
    const pd = currentUser?.providerData || [];
    const hasGoogle = pd.some((p) => p.providerId === "google.com");
    const hasGithub = pd.some((p) => p.providerId === "github.com");
    if (linkGoogleBtn) {
      linkGoogleBtn.textContent = hasGoogle ? "Linked" : "Connect";
      linkGoogleBtn.disabled = !!hasGoogle;
    }
    if (linkGithubBtn) {
      linkGithubBtn.textContent = hasGithub ? "Linked" : "Connect";
      linkGithubBtn.disabled = !!hasGithub;
    }
  } catch (e) {
    /* ignore */
  }
}

// call once on load (if user already has provider data)
refreshLinkedButtons();

// ── Privacy toggles (persist to localStorage) ───────────────────────────────
function initPrivacyToggle(id, storageKey, firestoreField, onText, offText) {
  const el = $(id);
  if (!el) return;
  const saved = localStorage.getItem(storageKey);
  if (saved !== null) el.checked = saved === "true";
  el.addEventListener("change", async (e) => {
    localStorage.setItem(storageKey, e.target.checked);
    // persist to Firestore when not in dev preview
    if (!DEV_PREVIEW && currentUser) {
      try {
        const updates = {};
        updates[`privacy.${firestoreField}`] = e.target.checked;
        await updateDoc(doc(fs, "users", currentUser.uid), updates);
      } catch (err) {
        console.error("Failed to persist privacy setting", err);
        toast("Failed to save preference", true);
      }
    }
    toast(e.target.checked ? onText : offText);
  });
}

initPrivacyToggle(
  "profile-visibility-toggle",
  "venture-profile-visible",
  "profileVisible",
  "Profile is visible",
  "Profile is hidden",
);
initPrivacyToggle(
  "searchability-toggle",
  "venture-searchable",
  "searchable",
  "Account is searchable",
  "Account is not searchable",
);
initPrivacyToggle(
  "read-receipts-toggle",
  "venture-read-receipts",
  "readReceipts",
  "Read receipts enabled",
  "Read receipts disabled",
);

const requestDataBtn = $("request-data-btn");
if (requestDataBtn)
  requestDataBtn.addEventListener("click", () =>
    toast("Data export requested — we will email you when ready."),
  );

// ── Widgets: save / reset ───────────────────────────────────────────────────
const saveWidgetsBtn = $("save-widgets-btn");
const resetWidgetsBtn = $("reset-widgets-btn");

if (saveWidgetsBtn) {
  saveWidgetsBtn.addEventListener("click", async () => {
    if (!currentUser && !DEV_PREVIEW) return toast("Please sign in.", true);
    const widgets = {
      showStars: !!$("show-stars-toggle")?.checked,
      showLanguages: !!$("show-langs-toggle")?.checked,
      showRecent: !!$("show-recent-toggle")?.checked,
      useLinkedGithub: !!$("use-linked-github-toggle")?.checked,
      githubOwner: ($("github-owner-input")?.value || "").trim(),
    };

    try {
      if (DEV_PREVIEW) {
        const saved = JSON.parse(localStorage.getItem("dev-profile") || "{}");
        saved.widgets = widgets;
        localStorage.setItem("dev-profile", JSON.stringify(saved));
        toast("Widget settings saved (local preview)");
        return;
      }
      try {
        await updateDoc(doc(fs, "users", currentUser.uid), { widgets });
      } catch (err) {
        // If the document doesn't exist, create it with merge
        try {
          await setDoc(doc(fs, "users", currentUser.uid), { widgets }, { merge: true });
        } catch (err2) {
          throw err2;
        }
      }
      // persist token & owner into RTDB under /github/tokens/{uid} (server-only consumption)
      try {
        const token = $("github-token-input")?.value?.trim() || null;
        const ownerVal = widgets.githubOwner || null;
        if (token || ownerVal) {
          const payload = { token: token || null, owner: ownerVal || null, publicFetch: false };
          try { await rtdbSet(rtdbRef(db, `github/tokens/${currentUser.uid}`), payload) } catch (e) { console.warn('Failed to write token to RTDB', e) }
        }
      } catch (e) { console.warn('persist token error', e) }
      toast("Widget settings saved");
    } catch (e) {
      console.error("Save widgets failed", e);
      toast("Failed to save widgets", true);
    }
  });
}

if (resetWidgetsBtn) {
  resetWidgetsBtn.addEventListener("click", async () => {
    if (!currentUser && !DEV_PREVIEW) return toast("Please sign in.", true);
    // reset UI to defaults
    if ($("show-stars-toggle")) $("show-stars-toggle").checked = true;
    if ($("show-langs-toggle")) $("show-langs-toggle").checked = true;
    if ($("show-recent-toggle")) $("show-recent-toggle").checked = true;
    if ($("use-linked-github-toggle")) $("use-linked-github-toggle").checked = true;
    if ($("github-owner-input")) $("github-owner-input").value = "";

    try {
      if (DEV_PREVIEW) {
        const saved = JSON.parse(localStorage.getItem("dev-profile") || "{}");
        saved.widgets = { showStars: true, showLanguages: true, showRecent: true, useLinkedGithub: true, githubOwner: "" };
        localStorage.setItem("dev-profile", JSON.stringify(saved));
        toast("Widget settings reset (local preview)");
        return;
      }
      try {
        await updateDoc(doc(fs, "users", currentUser.uid), { widgets: { showStars: true, showLanguages: true, showRecent: true, useLinkedGithub: true, githubOwner: "" } });
      } catch (err) {
        try {
          await setDoc(doc(fs, "users", currentUser.uid), { widgets: { showStars: true, showLanguages: true, showRecent: true, useLinkedGithub: true, githubOwner: "" } }, { merge: true });
        } catch (err2) {
          throw err2;
        }
      }
      toast("Widget settings reset");
    } catch (e) {
      console.error("Reset widgets failed", e);
      toast("Failed to reset widgets", true);
    }
  });
}
