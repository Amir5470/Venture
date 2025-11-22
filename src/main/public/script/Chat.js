import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js"
import { getDatabase, ref, push, onValue, remove } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js"
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js"
import { firebaseConfig } from "./secrets.js"
import { getMessaging, getToken } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-messaging.js"
import { getFirestore, doc, updateDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js"

const app = initializeApp(firebaseConfig)
const db = getDatabase(app)
const auth = getAuth(app)
const fs = getFirestore(app)
const messaging = getMessaging(app)

// DOM (graceful guards)
const el = id => document.getElementById(id) || null
const msgInput = el("msg")
const chat = el("chat")
const sendBtn = el("send")
const clearBtn = el("clearbtn")
const logoutBtn = el("logout")
const userDisplay = el("username")

const replyBar = el("replyBar")
const replyText = el("replyText")
const cancelReplyBtn = el("cancelReply")
const typingIndicator = el("typingIndicator")
let blockReply = false


if (!msgInput || !chat || !sendBtn || !clearBtn || !logoutBtn || !userDisplay) {
    console.error("Missing one or more required DOM elements. Check IDs: msg, chat, send, clearbtn, logout, username")
}

function createBubble(data) {
    // ensure we have an id to compare against replyTo
    const dataId = data.id || data.key || null

    const bubble = document.createElement("div")
    // escape values before inserting into DOM nodes
    const safeName = escapeHtml(data.name || "anon")
    const safeText = escapeHtml(data.text || "")

    bubble.className = `bubble ${data.uid === uid ? "sent" : "received"}`
    if (data.replyTo) {
        const replyDiv = document.createElement("div")
        replyDiv.className = "reply-preview"
        const safeReplyName = escapeHtml(data.replyTo.name || "anon")
        const safeReplyText = escapeHtml(data.replyTo.text || "")
        replyDiv.textContent = `↳ ${safeReplyName}: ${safeReplyText}`
        bubble.appendChild(replyDiv)
    }
    const textNode = document.createElement("div")
    textNode.textContent = `${safeName}: ${safeText}`
    bubble.appendChild(textNode)

    // store id on dataset to make comparisons reliable
    if (dataId) bubble.dataset.id = dataId

    bubble.addEventListener('click', e => {
    if (blockReply) return 

    e.stopPropagation()
    e.preventDefault()

    const id = bubble.dataset.id
    if (!id) return

    if (replyTo && replyTo.id === id) replyTo = null
    else replyTo = { name: data.name, text: data.text, id }

    updateReplyUI()
})

let holdTimer
let isHolding = false

bubble.addEventListener('mousedown', e => {
    isHolding = false
    holdTimer = setTimeout(() => {
        isHolding = true
        showMenu(e, bubble, data)
    }, 450)
})

bubble.addEventListener('mouseup', e => {
    clearTimeout(holdTimer)
    if (!isHolding) {
        // normal click, trigger reply
        const id = bubble.dataset.id
        if (!id) return
        if (replyTo && replyTo.id === id) replyTo = null
        else replyTo = { name: data.name, text: data.text, id }
        updateReplyUI()
    }
})

bubble.addEventListener('mouseleave', () => clearTimeout(holdTimer))

    return bubble
}

function registerPushTokenIfGranted() { }


// state
let username = "anon"
let uid = null
let replyTo = null

// helpers
const safeSetDisplay = (el, value) => { if (!el) return; el.style.display = value }
function updateReplyUI() {
    const replyBox = document.getElementById("replyBar")
    const replyText = document.getElementById("replyText")

    if (!replyTo) {
        replyBox.style.display = "none"
        replyText.textContent = ""
        return
    }

    replyBox.style.display = "flex"
    replyText.textContent = `${replyTo.name}: ${replyTo.text}`
}

function sendMessage() {
    if (!msgInput) return
    const text = msgInput.value?.trim()
    if (!text) return
    if (!uid) {
        console.warn("Not authenticated yet")
        return
    }

    const payload = {
        text,
        name: username,
        uid,
        time: Date.now()
    }

    if (replyTo) {
        payload.replyTo = {
            name: replyTo.name,
            text: replyTo.text,
            id: replyTo.id
        }
        replyTo = null
        updateReplyUI()
    }

    push(ref(db, "messages"), payload).catch(err => console.error("push failed", err))
    msgInput.value = ""
}

// keyboard shortcut to clear (keep but guarded)
document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        remove(ref(db, "messages")).catch(console.error)
    }
})

if (msgInput) {
    msgInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') sendMessage()
    })
}

// button wiring (guarded)
if (sendBtn) sendBtn.addEventListener("click", sendMessage)
if (clearBtn) clearBtn.addEventListener("click", () => remove(ref(db, "messages")).catch(console.error))
if (logoutBtn) logoutBtn.addEventListener("click", () => signOut(auth).catch(console.error))
if (cancelReplyBtn) cancelReplyBtn.addEventListener("click", () => { replyTo = null; updateReplyUI() })

// auth
onAuthStateChanged(auth, user => {
    if (!user) {
        try { window.location.href = "./index.html" } catch (e) { console.error(e) }
        return
    }
    username = user.displayName || user.email?.split("@")[0] || "anon"
    uid = user.uid
    if (userDisplay) userDisplay.textContent = `Welcome Back, ${username}`
    registerPushTokenIfGranted(uid)
})

// read messages
onValue(ref(db, "messages"), snap => {
    if (!chat) return
    chat.innerHTML = ""

    if (!snap.exists()) {
        chat.textContent = "" // nothing
        return
    }

    snap.forEach(child => {
        const m = child.val() || {}
        const key = child.key

        // ensure stable id on message object
        m.id = m.id || key

        const name = m.name || m.user || "anon"
        const text = m.text || ""

        const bubble = createBubble({
            name,
            text,
            uid: m.uid,
            id: m.id,
            replyTo: m.replyTo ? m.replyTo : null
        })

        // timestamp node
        const time = m.time ? new Date(m.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""
        const timeSpan = document.createElement("span")
        timeSpan.className = "timestamp"
        timeSpan.textContent = time
        bubble.appendChild(timeSpan)

        chat.appendChild(bubble)
    })

    // keep scroll at bottom
    chat.scrollTop = chat.scrollHeight
}, err => console.error("messages onValue error", err))


// typing indicator
onValue(ref(db, "typing"), snap => {
    if (!typingIndicator) return
    const data = snap.val() || {}
    const someoneTyping = Object.keys(data).some(id => id !== uid)
    typingIndicator.style.display = someoneTyping ? "flex" : "none"
}, err => console.error("typing onValue error", err))

// small helper to avoid XSS in inserted HTML
function escapeHtml(str) {
    if (typeof str !== "string") return ""
    return str
        .replaceAll("&amp;", "&")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&quot;", '"')
        .replaceAll("&#039;", "'")
}
// typing
let typingTimeout
msgInput.addEventListener('input', () => {
    if (!uid) return
    const typingRef = ref(db, "typing/" + uid)
    push(typingRef, true)
    clearTimeout(typingTimeout)
    typingTimeout = setTimeout(() => remove(typingRef), 1000)
})

// clear & logout
if (clearBtn) clearBtn.onclick = () => remove(ref(db, "messages")).catch(console.error)
if (logoutBtn) logoutBtn.onclick = () => signOut(auth).catch(console.error)

// cancel reply
if (cancelReplyBtn) cancelReplyBtn.onclick = () => {
    replyTo = null
    updateReplyUI()
}

function showMenu(e, bubble, data){
    const menu = document.getElementById('msgMenu')
    if(!menu) return

    menu.style.display = 'flex'
    menu.style.left = e.pageX + 'px'
    menu.style.top = e.pageY + 'px'

    menu.dataset.name = data.name
    menu.dataset.text = data.text
    menu.dataset.id = bubble.dataset.id
}

document.addEventListener('click', e => {
    if(e.target.closest('#msgMenu')) return
    document.getElementById('msgMenu').style.display = 'none'
})
