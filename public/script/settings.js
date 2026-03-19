import { initializeApp }         from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js"
import { getAuth, onAuthStateChanged, signOut,
         updateEmail, updatePassword, reauthenticateWithCredential,
         EmailAuthProvider, deleteUser }
                                  from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js"
import { getFirestore, doc, getDoc, updateDoc }
                                  from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js"
import { getStorage, ref as sRef, uploadString, getDownloadURL }
                                  from "https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js"
import { firebaseConfig }         from "./secrets.js"

// ── Firebase init ─────────────────────────────────────────────────────────────
const app     = initializeApp(firebaseConfig)
const auth    = getAuth(app)
const fs      = getFirestore(app)
const storage = getStorage(app)

// ── DOM helpers ───────────────────────────────────────────────────────────────
const $  = id => document.getElementById(id)
const el = (tag, cls, text) => {
    const e = document.createElement(tag)
    if (cls)  e.className   = cls
    if (text) e.textContent = text
    return e
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg, isError = false) {
    const t = $("toast")
    t.textContent = msg
    t.className   = "toast-show" + (isError ? " toast-error" : "")
    clearTimeout(t._timer)
    t._timer = setTimeout(() => { t.className = "" }, 3200)
}

// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll(".settings-tab").forEach(tab => {
    tab.addEventListener("click", () => {
        document.querySelectorAll(".settings-tab").forEach(t => t.classList.remove("active-tab"))
        document.querySelectorAll(".tab-panel").forEach(p => p.style.display = "none")
        tab.classList.add("active-tab")
        const panel = $(tab.dataset.target)
        if (panel) panel.style.display = "flex"
    })
})

// ── Auth state ────────────────────────────────────────────────────────────────
let currentUser = null

onAuthStateChanged(auth, async user => {
    if (!user) { window.location.href = "./index.html"; return }
    currentUser = user
    await loadProfile(user)
    populateAccountInfo(user)
})

// ── Profile: load from Firestore ──────────────────────────────────────────────
async function loadProfile(user) {
    const snap = await getDoc(doc(fs, "users", user.uid))
    const data = snap.exists() ? snap.data() : {}

    $("display-name-input").value = data.username || user.displayName || ""
    $("bio-input").value          = data.bio || ""
    updateBioCount()

    const pfp = data.pfp || user.photoURL || null
    if (pfp) $("profile-pic").src = pfp
}

// ── Profile: edit / save / cancel ────────────────────────────────────────────
let editingProfile = false

$("edit-profile-btn").addEventListener("click", () => {
    editingProfile = true
    $("display-name-input").disabled = false
    $("bio-input").disabled          = false
    $("edit-profile-btn").style.display   = "none"
    $("save-changes-btn").style.display   = "block"
    $("cancel-edit-btn").style.display    = "block"
    $("display-name-input").focus()
})

$("cancel-edit-btn").addEventListener("click", () => {
    editingProfile = false
    $("display-name-input").disabled = true
    $("bio-input").disabled          = true
    $("edit-profile-btn").style.display   = "block"
    $("save-changes-btn").style.display   = "none"
    $("cancel-edit-btn").style.display    = "none"
    // reload original values
    loadProfile(currentUser)
})

$("save-changes-btn").addEventListener("click", async () => {
    if (!currentUser) return
    const newName = $("display-name-input").value.trim()
    const newBio  = $("bio-input").value.trim()
    if (!newName) { toast("Display name can't be empty.", true); return }

    try {
        await updateDoc(doc(fs, "users", currentUser.uid), {
            username: newName,
            bio:      newBio
        })
        toast("Profile saved!")
        $("display-name-input").disabled = true
        $("bio-input").disabled          = true
        $("edit-profile-btn").style.display   = "block"
        $("save-changes-btn").style.display   = "none"
        $("cancel-edit-btn").style.display    = "none"
        editingProfile = false
    } catch (e) {
        console.error(e)
        toast("Failed to save profile.", true)
    }
})

// bio char counter
$("bio-input").addEventListener("input", updateBioCount)
function updateBioCount() {
    const len = $("bio-input").value.length
    $("bio-char-count").textContent = `${len} / 150`
}

// ── Profile picture upload ────────────────────────────────────────────────────
$("change-pfp-btn").addEventListener("click", () => $("pfp-file-input").click())

$("pfp-file-input").addEventListener("change", async e => {
    const file = e.target.files[0]
    if (!file || !currentUser) return
    if (file.size > 5 * 1024 * 1024) { toast("Image must be under 5MB.", true); return }

    const reader = new FileReader()
    reader.onload = async ev => {
        const dataUrl  = ev.target.result
        const base64   = dataUrl.split(",")[1]
        const mimeType = file.type

        try {
            const storageRef = sRef(storage, `pfps/${currentUser.uid}`)
            await uploadString(storageRef, base64, "base64", { contentType: mimeType })
            const url = await getDownloadURL(storageRef)

            $("profile-pic").src = url
            await updateDoc(doc(fs, "users", currentUser.uid), { pfp: url })
            toast("Profile picture updated!")
        } catch (err) {
            console.error(err)
            toast("Failed to upload photo.", true)
        }
    }
    reader.readAsDataURL(file)
})

// ── Account: populate info ────────────────────────────────────────────────────
function populateAccountInfo(user) {
    $("current-email").textContent    = user.email || "—"
    $("current-username").textContent = user.displayName || "—"
    const created = user.metadata?.creationTime
    $("member-since").textContent = created
        ? new Date(created).toLocaleDateString([], { year: "numeric", month: "long", day: "numeric" })
        : "—"
}

// ── Account: change email ─────────────────────────────────────────────────────
$("change-email-btn").addEventListener("click", async () => {
    const newEmail = $("new-email-input").value.trim()
    const pass     = $("email-pass-input").value

    if (!newEmail) { toast("Enter a new email.", true); return }
    if (!pass)     { toast("Enter your current password.", true); return }

    try {
        const cred = EmailAuthProvider.credential(currentUser.email, pass)
        await reauthenticateWithCredential(currentUser, cred)
        await updateEmail(currentUser, newEmail)
        await updateDoc(doc(fs, "users", currentUser.uid), { email: newEmail })
        $("current-email").textContent = newEmail
        $("new-email-input").value     = ""
        $("email-pass-input").value    = ""
        toast("Email updated!")
    } catch (e) {
        console.error(e)
        toast(friendlyError(e.code), true)
    }
})

// ── Account: change password ──────────────────────────────────────────────────
$("change-pass-btn").addEventListener("click", async () => {
    const current  = $("current-pass-input").value
    const newPass  = $("new-pass-input").value
    const confirm  = $("confirm-pass-input").value

    if (!current)            { toast("Enter your current password.", true); return }
    if (newPass.length < 6)  { toast("New password must be at least 6 characters.", true); return }
    if (newPass !== confirm) { toast("Passwords don't match.", true); return }

    try {
        const cred = EmailAuthProvider.credential(currentUser.email, current)
        await reauthenticateWithCredential(currentUser, cred)
        await updatePassword(currentUser, newPass)
        $("current-pass-input").value = ""
        $("new-pass-input").value     = ""
        $("confirm-pass-input").value = ""
        toast("Password updated!")
    } catch (e) {
        console.error(e)
        toast(friendlyError(e.code), true)
    }
})

// ── Account: delete account ───────────────────────────────────────────────────
$("delete-account-btn").addEventListener("click", async () => {
    const confirmed = confirm("Are you sure you want to delete your account? This cannot be undone.")
    if (!confirmed) return
    const pass = prompt("Enter your password to confirm:")
    if (!pass) return

    try {
        const cred = EmailAuthProvider.credential(currentUser.email, pass)
        await reauthenticateWithCredential(currentUser, cred)
        await deleteUser(currentUser)
        window.location.href = "./index.html"
    } catch (e) {
        console.error(e)
        toast(friendlyError(e.code), true)
    }
})

// ── Logout ────────────────────────────────────────────────────────────────────
$("logout-button").addEventListener("click", async () => {
    await signOut(auth)
    window.location.href = "./index.html"
})

// ── Appearance: dark mode ─────────────────────────────────────────────────────
const darkToggle = $("dark-mode-toggle")

// Load saved preference
if (localStorage.getItem("venture-dark") === "true") {
    document.body.classList.add("dark")
    darkToggle.checked = true
}

darkToggle.addEventListener("change", () => {
    document.body.classList.toggle("dark", darkToggle.checked)
    localStorage.setItem("venture-dark", darkToggle.checked)
})

// ── Appearance: accent color ──────────────────────────────────────────────────
const savedAccent = localStorage.getItem("venture-accent") || "#4285f4"
applyAccent(savedAccent)
markActiveSwatch(savedAccent)

document.querySelectorAll(".swatch").forEach(sw => {
    sw.addEventListener("click", () => {
        const color = sw.dataset.color
        applyAccent(color)
        localStorage.setItem("venture-accent", color)
        markActiveSwatch(color)
    })
})

$("custom-color-picker").addEventListener("input", e => {
    const color = e.target.value
    applyAccent(color)
    localStorage.setItem("venture-accent", color)
    markActiveSwatch(null)
})

function applyAccent(color) {
    document.documentElement.style.setProperty("--accent", color)
    // Darken slightly for hover
    document.documentElement.style.setProperty("--accent-hover", color)
    $("custom-color-picker").value = color
}

function markActiveSwatch(color) {
    document.querySelectorAll(".swatch").forEach(sw => {
        sw.classList.toggle("active-swatch", sw.dataset.color === color)
    })
}

// ── Appearance: font size ─────────────────────────────────────────────────────
const fontSlider  = $("font-size-slider")
const fontPreview = $("font-size-preview")
const savedFont   = localStorage.getItem("venture-font-size") || "15"

fontSlider.value       = savedFont
fontPreview.style.fontSize = savedFont + "px"
document.body.style.fontSize = savedFont + "px"

fontSlider.addEventListener("input", () => {
    const size = fontSlider.value
    fontPreview.style.fontSize   = size + "px"
    document.body.style.fontSize = size + "px"
    localStorage.setItem("venture-font-size", size)
})

// ── Appearance: bubble style ──────────────────────────────────────────────────
const savedBubble = localStorage.getItem("venture-bubble-style") || "rounded"
applyBubbleStyle(savedBubble)

document.querySelectorAll(".bubble-option").forEach(opt => {
    opt.addEventListener("click", () => {
        document.querySelectorAll(".bubble-option").forEach(o => o.classList.remove("active-bubble"))
        opt.classList.add("active-bubble")
        const style = opt.dataset.style
        applyBubbleStyle(style)
        localStorage.setItem("venture-bubble-style", style)
    })
})

function applyBubbleStyle(style) {
    const map = { rounded: "16px", square: "4px", pill: "999px" }
    document.documentElement.style.setProperty("--bubble-radius", map[style] || "16px")
    const btn = document.querySelector(`[data-style="${style}"]`)
    if (btn) {
        document.querySelectorAll(".bubble-option").forEach(o => o.classList.remove("active-bubble"))
        btn.classList.add("active-bubble")
    }
}

// ── Error messages ────────────────────────────────────────────────────────────
function friendlyError(code) {
    const map = {
        "auth/wrong-password":       "Incorrect password.",
        "auth/invalid-email":        "Invalid email address.",
        "auth/email-already-in-use": "That email is already in use.",
        "auth/requires-recent-login":"Please log out and log back in first.",
        "auth/weak-password":        "Password is too weak.",
        "auth/too-many-requests":    "Too many attempts. Try again later."
    }
    return map[code] || "Something went wrong. Check the console."
}