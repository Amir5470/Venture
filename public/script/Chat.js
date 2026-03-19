import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js"
import { getDatabase, ref, push, onValue, remove, set } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js"
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js"
import { firebaseConfig } from "./secrets.js"
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js"

const app = initializeApp(firebaseConfig)
const db  = getDatabase(app)
const auth = getAuth(app)
const fs  = getFirestore(app)

// ── Resolve group chat ID from URL (?gc=<id>) ─────────────────────────────────
const params = new URLSearchParams(window.location.search)
const gcId   = params.get("gc")

if (!gcId) {
    // No group chat selected — send user back to home
    window.location.href = "./home.html"
}

// All data lives under groupChats/<gcId>/messages  and  groupChats/<gcId>/typing
const messagesPath = `groupChats/${gcId}/messages`
const typingPath   = `groupChats/${gcId}/typing`

// ── DOM ───────────────────────────────────────────────────────────────────────
const el = id => document.getElementById(id) || null
const msgInput       = el("msg")
const chat           = el("chat")
const sendBtn        = el("send")
const clearBtn       = el("clearbtn")
const logoutBtn      = el("logout")
const userDisplay    = el("username")
const replyBar       = el("replyBar")
const replyText      = el("replyText")
const cancelReplyBtn = el("cancelReply")
const typingIndicator = el("typingIndicator")
const chatTitle      = el("chat-title")

if (!msgInput || !chat || !sendBtn || !logoutBtn || !userDisplay) {
    console.error("Missing required DOM elements.")
}

// ── State ─────────────────────────────────────────────────────────────────────
let username = "anon"
let uid      = null
let replyTo  = null

// ── Load group chat name into header ──────────────────────────────────────────
onValue(ref(db, `groupChats/${gcId}`), snap => {
    if (!snap.exists()) { window.location.href = "./home.html"; return; }
    const gc = snap.val()
    if (chatTitle) chatTitle.textContent = gc.name || "Group Chat"
}, { onlyOnce: true })

// ── Auth ──────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, user => {
    if (!user) { window.location.href = "./index.html"; return; }
    username = user.displayName || user.email?.split("@")[0] || "anon"
    uid = user.uid
    if (userDisplay) userDisplay.textContent = `Welcome Back, ${username}`
})

// ── Helpers ───────────────────────────────────────────────────────────────────
function escapeHtml(str) {
    if (typeof str !== "string") return ""
    const d = document.createElement("div")
    d.textContent = str
    return d.innerHTML
}

function updateReplyUI() {
    if (!replyBar || !replyText) return
    if (!replyTo) {
        replyBar.style.display = "none"
        replyText.textContent = ""
        return
    }
    replyBar.style.display = "flex"
    replyText.textContent = `${replyTo.name}: ${replyTo.text}`
}

// ── Bubble ────────────────────────────────────────────────────────────────────
function createBubble(data) {
    const dataId = data.id || data.key || null
    const bubble = document.createElement("div")
    bubble.className = `bubble ${data.uid === uid ? "sent" : "received"}`

    if (data.replyTo) {
        const replyDiv = document.createElement("div")
        replyDiv.className = "reply-preview"
        replyDiv.textContent = `↳ ${escapeHtml(data.replyTo.name || "anon")}: ${escapeHtml(data.replyTo.text || "")}`
        bubble.appendChild(replyDiv)
    }

    const textNode = document.createElement("div")
    textNode.textContent = `${escapeHtml(data.name || "anon")}: ${escapeHtml(data.text || "")}`
    bubble.appendChild(textNode)

    if (dataId) bubble.dataset.id = dataId

    // hold-to-menu / click-to-reply
    let holdTimer, isHolding = false

    bubble.addEventListener('mousedown', e => {
        isHolding = false
        holdTimer = setTimeout(() => { isHolding = true; showMenu(e, bubble, data) }, 450)
    })

    bubble.addEventListener('mouseup', () => {
        clearTimeout(holdTimer)
        if (isHolding) { isHolding = false; return }
        const id = bubble.dataset.id
        if (!id) return
        replyTo = (replyTo && replyTo.id === id) ? null : { name: data.name, text: data.text, id }
        updateReplyUI()
    })

    bubble.addEventListener('mouseleave', () => clearTimeout(holdTimer))
    return bubble
}

// ── Send ──────────────────────────────────────────────────────────────────────
function sendMessage() {
    if (!msgInput) return
    const text = msgInput.value?.trim()
    if (!text || !uid) return

    const payload = { text, name: username, uid, time: Date.now() }

    if (replyTo) {
        payload.replyTo = { name: replyTo.name, text: replyTo.text, id: replyTo.id }
        replyTo = null
        updateReplyUI()
    }

    push(ref(db, messagesPath), payload).catch(err => console.error("push failed", err))
    msgInput.value = ""
}

if (msgInput) msgInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage() })
if (sendBtn)  sendBtn.addEventListener("click", sendMessage)
if (clearBtn) clearBtn.addEventListener("click", () => remove(ref(db, messagesPath)).catch(console.error))
if (logoutBtn) logoutBtn.addEventListener("click", () => signOut(auth).catch(console.error))
if (cancelReplyBtn) cancelReplyBtn.addEventListener("click", () => { replyTo = null; updateReplyUI() })

// Ctrl+Shift+O to clear
document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        remove(ref(db, messagesPath)).catch(console.error)
    }
})

// ── Read messages ─────────────────────────────────────────────────────────────
onValue(ref(db, messagesPath), snap => {
    if (!chat) return
    chat.innerHTML = ""
    if (!snap.exists()) return

    snap.forEach(child => {
        const m   = child.val() || {}
        m.id      = m.id || child.key
        const bubble = createBubble({
            name:    m.name || m.user || "anon",
            text:    m.text || "",
            uid:     m.uid,
            id:      m.id,
            replyTo: m.replyTo || null
        })

        const time = m.time ? new Date(m.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""
        const timeSpan = document.createElement("span")
        timeSpan.className = "timestamp"
        timeSpan.textContent = time
        bubble.appendChild(timeSpan)

        chat.appendChild(bubble)
    })

    chat.scrollTop = chat.scrollHeight
}, err => console.error("messages onValue error", err))

// ── Typing indicator ──────────────────────────────────────────────────────────
onValue(ref(db, typingPath), snap => {
    if (!typingIndicator) return
    const data = snap.val() || {}
    typingIndicator.style.display = Object.keys(data).some(id => id !== uid) ? "flex" : "none"
}, err => console.error("typing onValue error", err))

let typingTimeout
if (msgInput) {
    msgInput.addEventListener('input', () => {
        if (!uid) return
        const typingRef = ref(db, `${typingPath}/${uid}`)
        set(typingRef, true)
        clearTimeout(typingTimeout)
        typingTimeout = setTimeout(() => remove(typingRef), 1000)
    })
}

// ── Context menu ──────────────────────────────────────────────────────────────
function showMenu(e, bubble, data) {
    const menu = document.getElementById('msgMenu')
    if (!menu) return
    menu.style.display = 'flex'
    menu.style.left = e.pageX + 'px'
    menu.style.top  = e.pageY + 'px'
    menu.dataset.name = data.name
    menu.dataset.text = data.text
    menu.dataset.id   = bubble.dataset.id
}

document.addEventListener('click', e => {
    const menu = document.getElementById('msgMenu')
    if (menu && !e.target.closest('#msgMenu')) menu.style.display = 'none'
})