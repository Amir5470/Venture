import { initializeApp }     from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js"
import { getDatabase, ref, push, onValue, onChildAdded, remove, set, get }
                              from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js"
import { getAuth, onAuthStateChanged, signOut }
                              from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js"
import { getFirestore, collection, addDoc, getDoc, doc }
                              from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js"

import { firebaseConfig }     from "./secrets.js"
import { sanitizeString } from './sanitizer.js'
import { highlightCodeBlock, attachCopyButton } from './codeRenderer.js'
import { detectCode } from './codeDetector.js'

// ── Firebase ──────────────────────────────────────────────────────────────────
const app  = initializeApp(firebaseConfig)
const db   = getDatabase(app)
const auth = getAuth(app)
const fs   = getFirestore(app)

// ── Route: support both ?gc= and ?dm= ────────────────────────────────────────
const params = new URLSearchParams(window.location.search)
const gcId   = params.get("gc")
const dmId   = params.get("dm")

// Must have one or the other
if (!gcId && !dmId) { go('/home/') }

// isDM flag drives all branching below
const isDM = !!dmId

// RTDB paths
const chatId       = isDM ? dmId : gcId
const basePath     = isDM ? `dms/${chatId}` : `groupChats/${chatId}`
const messagesPath = `${basePath}/messages`
const typingPath   = `${basePath}/typing`

// ── DOM ───────────────────────────────────────────────────────────────────────
const el              = id => document.getElementById(id)
const msgInput        = el("msg")
let chat              = el("chat")
const sendBtn         = el("send")
const clearBtn        = el("clearbtn")
const logoutBtn       = el("logout") || el("logout-chat") || el("logout-button")
const userDisplay     = el("username")
const replyBar        = el("replyBar")
const replyText       = el("replyText")
const cancelReplyBtn  = el("cancelReply")
const typingIndicator = el("typingIndicator")
const chatTitle       = el("chat-title")
const attachBtn       = el("attachBtn")
const fileInput       = el("fileInput")
const uploadBar       = el("uploadBar")
const uploadFill      = el("uploadFill")
const uploadLabel     = el("uploadLabel")

// ── State ─────────────────────────────────────────────────────────────────────
let username  = "anon"
let uid       = null
let myPfp     = null
let replyTo   = null
const pfpCache = {}

// ── Load chat title ───────────────────────────────────────────────────────────
// For GC: read name field. For DM: derive the other person's name from members map.
onValue(ref(db, basePath), snap => {
    if (!snap.exists()) { go('/home/'); return }

    if (!chatTitle) return

    const val = snap.val()
    if (isDM) {
        // Members map: { uid: username, ... }
        // Show the other person's name (not our own). uid may not be set yet at
        // this point, so we'll also update the title after auth resolves.
        const members = val.members || {}
        const otherName = Object.entries(members)
            .filter(([id]) => id !== uid)
            .map(([, name]) => name)[0] || "Direct Message"
        chatTitle.textContent = otherName === "Direct Message" ? "Direct Message" : `@ ${otherName}`
    } else {
        chatTitle.textContent = val.name || "Group Chat"
    }
}, { onlyOnce: true })

// ── Auth ──────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async user => {
    if (!user) { go('/'); return }
    username = user.displayName || user.email?.split("@")[0] || "anon"
    uid      = user.uid
    if (userDisplay) userDisplay.textContent = `Welcome Back, ${username}`

    try {
        const snap = await getDoc(doc(fs, "users", uid))
        myPfp = snap.exists() ? (snap.data().pfp || user.photoURL || null) : (user.photoURL || null)
    } catch { myPfp = user.photoURL || null }
    pfpCache[uid] = myPfp

    // Re-resolve DM title now that uid is known
    if (isDM && chatTitle) {
        try {
            const dmSnap = await get(ref(db, basePath))
            if (dmSnap.exists()) {
                const members = dmSnap.val().members || {}
                const otherName = Object.entries(members)
                    .filter(([id]) => id !== uid)
                    .map(([, name]) => name)[0]
                if (otherName) chatTitle.textContent = `@ ${otherName}`
            }
        } catch (_) {}
    }
})

// ── Helpers ───────────────────────────────────────────────────────────────────
function escapeHtml(str) {
    if (typeof str !== "string") return ""
    const d = document.createElement("div")
    d.textContent = str
    return d.innerHTML
}

// Use the shared detector module instead (imported above).
function updateReplyUI() {
    if (!replyBar || !replyText) return
    if (!replyTo) { replyBar.style.display = "none"; replyText.textContent = ""; return }
    replyBar.style.display = "flex"
    replyText.textContent  = `${isDM ? '' : (replyTo.name + ': ')}${replyTo.text || "[file]"}`
}

async function getPfp(senderUid) {
    if (pfpCache[senderUid] !== undefined) return pfpCache[senderUid]
    try {
        const snap = await getDoc(doc(fs, "users", senderUid))
        const url  = snap.exists() ? (snap.data().pfp || null) : null
        pfpCache[senderUid] = url
        return url
    } catch { pfpCache[senderUid] = null; return null }
}

const URL_RE = /https?:\/\/[^\s]+/g
function extractUrls(text) { return text?.match(URL_RE) || [] }
function isImageUrl(url)   { return /\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i.test(url) }
function isVideoUrl(url)   { return /\.(mp4|webm|ogg)(\?.*)?$/i.test(url) }
function getYouTubeId(url) {
    const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{11})/)
    return m ? m[1] : null
}

// ── OG preview fetch ──────────────────────────────────────────────────────────
async function fetchOG(url) {
    try {
        const res = await fetch(
            `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
            { signal: AbortSignal.timeout(6000) }
        )
        if (!res.ok) return null
        const { contents } = await res.json()
        const dom  = new DOMParser().parseFromString(contents, "text/html")
        const meta = (p) =>
            dom.querySelector(`meta[property='${p}']`)?.content ||
            dom.querySelector(`meta[name='${p}']`)?.content || ""
        return {
            title:       meta("og:title")       || dom.title || "",
            description: meta("og:description") || meta("description") || "",
            image:       meta("og:image")        || "",
            siteName:    meta("og:site_name")    || new URL(url).hostname,
            url
        }
    } catch { return null }
}

// ── Render bubble content ─────────────────────────────────────────────────────
async function renderContent(bubble, data) {
    if (data.type === "file") {
        const { fileUrl, fileName, fileType } = data
        if (fileType?.startsWith("image/")) {
            const img = document.createElement("img")
            img.src = fileUrl; img.className = "msg-image"; img.alt = fileName
            img.addEventListener("click", () => window.open(fileUrl, "_blank"))
            bubble.appendChild(img)
        } else if (fileType?.startsWith("video/")) {
            const v = document.createElement("video")
            v.src = fileUrl; v.controls = true; v.className = "msg-video"
            bubble.appendChild(v)
        } else {
            const a = document.createElement("a")
            a.href = fileUrl; a.target = "_blank"; a.className = "file-card"
            a.innerHTML = `<span class="file-icon">📎</span><span class="file-name">${escapeHtml(fileName)}</span>`
            bubble.appendChild(a)
        }
        return
    }

    // Text message (handle fenced code blocks robustly)
        const text = data.text || ""
        // Decode any HTML entities (so encoded backticks like &#96; are converted)
        let decodedText = text
        try {
            const doc = new DOMParser().parseFromString(text, 'text/html')
            decodedText = doc.documentElement.textContent || text
        } catch (_) { decodedText = text }

        // Pre-extract URLs so we can hide the raw link when rendering an embed
        const urls = extractUrls(text)
        const firstUrl = urls && urls.length ? urls[0] : null

        // Accept both multi-line and single-line fenced blocks: ```js\n...``` or ```js code ```
        const CODE_FENCE_RE = /```\s*([a-zA-Z0-9+#-]*)\s*\r?\n?([\s\S]*?)```/g

    // If there's no code fence, try auto-detect code; otherwise render as text
    if (!CODE_FENCE_RE.test(decodedText)) {
        // Auto-detect code-like messages so users don't need to type backticks.
        // This detector attempts to infer language (highlight.js names) conservatively.
        // Use shared detector from `codeDetector.js` (imported above)

        // Run auto-detection on the original raw `text` so we can detect HTML tags
        // before they are stripped by the HTML decoder above.
        const auto = detectCode(text)
        if (auto.isCode) {
            const wrap = document.createElement('div')
            wrap.className = 'code-block-wrap'
            const inner = document.createElement('div')
            inner.className = 'code-inner'
            const pre = document.createElement('pre')
            const codeEl = document.createElement('code')
            codeEl.className = auto.lang || ''
            codeEl.textContent = auto.code
            pre.appendChild(codeEl)
            inner.appendChild(pre)
            wrap.appendChild(inner)
            bubble.appendChild(wrap)
            attachCopyButton(wrap, auto.lang || '')
            if (window.hljs && typeof window.hljs.highlightElement === 'function') {
                try { window.hljs.highlightElement(codeEl) } catch (e) {}
            }
            } else {
            const textDiv = document.createElement("div")
            textDiv.className   = "bubble-text"
            // If we'll render an embed for the first URL, remove it from the displayed text
            let display = decodedText
            if (firstUrl) display = display.replace(firstUrl, '').trim()
            const prefix = isDM ? '' : `${data.name || "anon"}: `
            // If display is empty after removing url, don't render an empty text node
            if (display) textDiv.textContent = `${prefix}${display}`
            else if (!isDM) textDiv.textContent = `${data.name || "anon"}: `
            bubble.appendChild(textDiv)
        }
    } else {
        // Reset regex state
        CODE_FENCE_RE.lastIndex = 0
        let lastIndex = 0
        const container = document.createElement('div')
        container.className = 'multi-segment'

        while (true) {
            const m = CODE_FENCE_RE.exec(decodedText)
            if (!m) break
            const idx = m.index
            // Text before code fence — strip leftover backticks
            if (idx > lastIndex) {
                let plain = decodedText.slice(lastIndex, idx)
                plain = plain.replace(/`{1,3}/g, '')
                // remove firstUrl from plain segment when embedding
                if (firstUrl) plain = plain.replace(firstUrl, '').trim()
                const td = document.createElement('div')
                td.className = 'bubble-text'
                const prefix = isDM ? '' : `${data.name || 'anon'}: `
                if (plain) td.textContent = `${prefix}${plain}`
                else if (!isDM) td.textContent = `${data.name || 'anon'}: `
                container.appendChild(td)
            }

            const lang = m[1] || ''
            let code = m[2] || ''
            // Trim surrounding whitespace/newlines for inline fences
            code = code.replace(/^\s+|\s+$/g, '')
            const result = await highlightCodeBlock(code, lang)
            const wrap = document.createElement('div')
            wrap.className = 'code-block-wrap'

            if (result && result.kind === 'hljs') {
                // create a pre/code element and set textContent to avoid unescaped-HTML
                const inner = document.createElement('div')
                inner.className = 'code-inner'
                const pre = document.createElement('pre')
                const codeEl = document.createElement('code')
                codeEl.className = `hljs ${result.lang || ''}`
                codeEl.textContent = result.code
                pre.appendChild(codeEl)
                inner.appendChild(pre)
                wrap.appendChild(inner)
                container.appendChild(wrap)
                attachCopyButton(wrap, result.lang)
                // initialize highlight.js on the element
                if (window.hljs && typeof window.hljs.highlightElement === 'function') {
                    try { window.hljs.highlightElement(codeEl) } catch (e) {}
                }
            } else if (result && result.kind === 'plain') {
                const inner = document.createElement('div')
                inner.className = 'code-inner'
                const pre = document.createElement('pre')
                const codeEl = document.createElement('code')
                codeEl.textContent = result.code
                pre.appendChild(codeEl)
                pre.className = 'plain-code'
                inner.appendChild(pre)
                wrap.appendChild(inner)
                container.appendChild(wrap)
                attachCopyButton(wrap, '')
            } else {
                // last-resort: treat as HTML string (shouldn't happen now)
                wrap.innerHTML = result || ''
                container.appendChild(wrap)
                attachCopyButton(wrap, lang)
            }

            lastIndex = CODE_FENCE_RE.lastIndex
        }

        // Trailing text after last code block
        if (lastIndex < decodedText.length) {
            let tail = decodedText.slice(lastIndex)
            if (firstUrl) tail = tail.replace(firstUrl, '').trim()
            const td = document.createElement('div')
            td.className = 'bubble-text'
            const prefix = isDM ? '' : `${data.name || 'anon'}: `
            if (tail) td.textContent = `${prefix}${tail}`
            else if (!isDM) td.textContent = `${data.name || 'anon'}: `
            container.appendChild(td)
        }

        bubble.appendChild(container)
    }

    if (!urls.length) return
    const url = urls[0]

    // YouTube
    const ytId = getYouTubeId(url)
    if (ytId) {
        const w = document.createElement("div")
        w.className = "embed-wrap"
        w.innerHTML = `<iframe src="https://www.youtube.com/embed/${ytId}" frameborder="0" allowfullscreen class="yt-embed"></iframe>`
        // add copy button overlay for embed
        const copyBtn = document.createElement('button')
        copyBtn.className = 'embed-copy-btn'
        copyBtn.textContent = 'Copy'
        copyBtn.addEventListener('click', (ev) => {
            ev.stopPropagation(); ev.preventDefault()
            navigator.clipboard.writeText(url).then(() => showToast('Link copied!')).catch(() => showToast('Copy failed.', true))
        })
        w.appendChild(copyBtn)
        bubble.appendChild(w)
        return
    }

    // Direct image
    if (isImageUrl(url)) {
        const img = document.createElement("img")
        img.src = url; img.className = "msg-image"; img.alt = "image"
        img.addEventListener("click", () => window.open(url, "_blank"))
        bubble.appendChild(img)
        return
    }

    // Direct video
    if (isVideoUrl(url)) {
        const v = document.createElement("video")
        v.src = url; v.controls = true; v.className = "msg-video"
        bubble.appendChild(v)
        return
    }

    // OG card
    const og = await fetchOG(url)
    if (og && (og.title || og.image)) {
        const card = document.createElement("a")
        card.href = url; card.target = "_blank"; card.className = "og-card"
        card.innerHTML = `
            ${og.image ? `<img src="${escapeHtml(og.image)}" class="og-img" alt="" onerror="this.style.display='none'">` : ""}
            <div class="og-body">
                <div class="og-site">${escapeHtml(og.siteName)}</div>
                <div class="og-title">${escapeHtml(og.title)}</div>
                ${og.description ? `<div class="og-desc">${escapeHtml(og.description.slice(0, 120))}…</div>` : ""}
            </div>`
        // Add copy button to OG card (avoid following link when copying)
        const obtn = document.createElement('button')
        obtn.className = 'embed-copy-btn'
        obtn.textContent = 'Copy'
        obtn.addEventListener('click', (ev) => {
            ev.stopPropagation(); ev.preventDefault()
            navigator.clipboard.writeText(url).then(() => showToast('Link copied!')).catch(() => showToast('Copy failed.', true))
        })
        card.appendChild(obtn)
        bubble.appendChild(card)
    }
}

// ── Create bubble ─────────────────────────────────────────────────────────────
async function createBubble(data) {
    const dataId = data.id || null
    const isSent = data.uid === uid

    const wrapper     = document.createElement("div")
    wrapper.className = `bubble-wrapper ${isSent ? "sent-wrapper" : "received-wrapper"}`

    const avatar     = document.createElement("img")
    avatar.className = "bubble-avatar"
    avatar.alt       = data.name || "anon"
    avatar.src       = data.pfp || (await getPfp(data.uid)) || "../resources/anonymous.png"
    avatar.addEventListener('error', () => { if (avatar.src !== '../resources/anonymous.png') avatar.src = '../resources/anonymous.png' })

    const bubble     = document.createElement("div")
    bubble.className = `bubble ${isSent ? "sent" : "received"}`
    if (dataId) bubble.dataset.id = dataId

    if (data.replyTo) {
        const rd       = document.createElement("div")
        rd.className   = "reply-preview"
        rd.textContent = `↳ ${isDM ? '' : (data.replyTo.name || "anon") + ': '}${data.replyTo.text || "[file]"}`
        bubble.appendChild(rd)
    }

    try {
        await renderContent(bubble, data)
    } catch (err) {
        console.error('renderContent error', err)
        const errDiv = document.createElement('div')
        errDiv.className = 'bubble-text'
        const prefix = isDM ? '' : `${data.name || 'anon'}: `
        errDiv.textContent = `${prefix}[render error]`
        bubble.appendChild(errDiv)
    }

    const ts       = document.createElement("span")
    ts.className   = "timestamp"
    ts.textContent = data.time ? new Date(data.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""
    bubble.appendChild(ts)

    let holdTimer
    let menuShown = false

    bubble.addEventListener('mousedown', e => {
        menuShown = false
        holdTimer = setTimeout(() => {
            menuShown = true
            showMenu(e, bubble, data)
        }, 450)
    })

    bubble.addEventListener('mouseup', () => {
        clearTimeout(holdTimer)
        if (menuShown) return
        if (!dataId) return
        replyTo = (replyTo && replyTo.id === dataId) ? null : { name: data.name, text: data.text || "", id: dataId }
        updateReplyUI()
    })

    bubble.addEventListener('mouseleave', () => clearTimeout(holdTimer))

    if (isSent) { wrapper.appendChild(bubble); wrapper.appendChild(avatar) }
    else        { wrapper.appendChild(avatar); wrapper.appendChild(bubble) }

    return wrapper
}

// ── Send text ─────────────────────────────────────────────────────────────────
function sendMessage() {
    const text = sanitizeString(msgInput?.value || '', 2000)
    if (text === null) { showToast('Message is too long.', true); return }
    if (!text || !uid) return
    const payload = { type: "text", text, name: username, uid, pfp: myPfp || null, time: Date.now() }
    if (replyTo) {
        payload.replyTo = { name: replyTo.name, text: replyTo.text, id: replyTo.id }
        replyTo = null; updateReplyUI()
    }
    push(ref(db, messagesPath), payload).catch(console.error)

    // For DMs: update lastMessage + lastAt on the DM node so the sidebar preview works
    if (isDM) {
        set(ref(db, `${basePath}/lastMessage`), text).catch(console.error)
        set(ref(db, `${basePath}/lastAt`), Date.now()).catch(console.error)
    }

    msgInput.value = ""
}

// ── Upload file ───────────────────────────────────────────────────────────────
const MAX_SIZE         = 5 * 1024 * 1024
const CLOUDINARY_NAME  = "dmk14omgf"
const CLOUDINARY_PRESET = "Notsignedpreset"

async function sendFile(file) {
    if (!uid) return
    if (file.size > MAX_SIZE) { showToast("File must be under 5MB.", true); return }

    uploadBar.style.display = "flex"
    uploadLabel.textContent = `Uploading ${file.name}…`
    uploadFill.style.width  = "0%"

    try {
        const formData = new FormData()
        formData.append("file", file)
        formData.append("upload_preset", CLOUDINARY_PRESET)
        formData.append("folder", `venture/${chatId}`)

        const url = await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest()
            xhr.open("POST", `https://api.cloudinary.com/v1_1/${CLOUDINARY_NAME}/auto/upload`)

            xhr.upload.addEventListener("progress", e => {
                if (!e.lengthComputable) return
                const pct = Math.round((e.loaded / e.total) * 100)
                uploadFill.style.width  = pct + "%"
                uploadLabel.textContent = `Uploading… ${pct}%`
            })

            xhr.addEventListener("load", () => {
                if (xhr.status === 200) resolve(JSON.parse(xhr.responseText).secure_url)
                else reject(new Error(`Cloudinary error: ${xhr.status}`))
            })
            xhr.addEventListener("error", () => reject(new Error("Network error")))
            xhr.send(formData)
        })

        const payload = {
            type: "file", fileUrl: url, fileName: file.name, fileType: file.type,
            name: username, uid, pfp: myPfp || null, time: Date.now()
        }
        if (replyTo) {
            payload.replyTo = { name: replyTo.name, text: replyTo.text, id: replyTo.id }
            replyTo = null; updateReplyUI()
        }
        push(ref(db, messagesPath), payload).catch(console.error)

        if (isDM) {
            set(ref(db, `${basePath}/lastMessage`), `📎 ${file.name}`).catch(console.error)
            set(ref(db, `${basePath}/lastAt`), Date.now()).catch(console.error)
        }

        uploadBar.style.display = "none"
        showToast("File sent!")

    } catch (err) {
        console.error(err)
        showToast("Upload failed.", true)
        uploadBar.style.display = "none"
    }
}

// ── Wire buttons ──────────────────────────────────────────────────────────────
msgInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
        if (e.shiftKey) {
            // allow newline insertion when Shift+Enter
            return
        }
        e.preventDefault()
        sendMessage()
    }
})
sendBtn?.addEventListener("click", sendMessage)
clearBtn?.addEventListener("click", () => remove(ref(db, messagesPath)).catch(console.error))
logoutBtn?.addEventListener("click", async () => {
    try {
        await signOut(auth)
        go('/')
    } catch (e) { console.error(e) }
})
cancelReplyBtn?.addEventListener("click", () => { replyTo = null; updateReplyUI() })
attachBtn?.addEventListener("click", () => fileInput?.click())
fileInput?.addEventListener("change", e => { if (e.target.files[0]) sendFile(e.target.files[0]); fileInput.value = "" })

document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault(); remove(ref(db, messagesPath)).catch(console.error)
    }
})

// ── Read messages ─────────────────────────────────────────────────────────────
const renderedIds = new Set()

onChildAdded(ref(db, messagesPath), async snap => {
    // Re-resolve chat container in case DOM changed
    if (!chat) {
        chat = document.getElementById('chat') || document.querySelector('.chat') || document.querySelector('#chat')
        console.log('re-resolved chat element:', chat)
    }
    if (!chat) { console.warn('chat container not found, skipping message render'); return }
    const m = snap.val() || {}
    m.id    = m.id || snap.key
    if (renderedIds.has(m.id)) return
    renderedIds.add(m.id)

    let wrapper
    try {
        wrapper = await createBubble({
        type:     m.type     || "text",
        text:     m.text     || "",
        name:     m.name     || "anon",
        uid:      m.uid,
        pfp:      m.pfp      || null,
        id:       m.id,
        time:     m.time,
        replyTo:  m.replyTo  || null,
        fileUrl:  m.fileUrl  || null,
        fileName: m.fileName || null,
        fileType: m.fileType || null
        })
    } catch (err) {
        console.error('createBubble error', err)
        // Fallback: create minimal wrapper so chat remains usable
        wrapper = document.createElement('div')
        wrapper.className = 'bubble-wrapper'
        const fallback = document.createElement('div')
        fallback.className = 'bubble-text'
        const prefix = isDM ? '' : `${m.name || 'anon'}: `
        fallback.textContent = `${prefix}[message failed to render]`
        wrapper.appendChild(fallback)
    }

    if (wrapper) chat.appendChild(wrapper)
    chat.scrollTop = chat.scrollHeight
}, err => console.error("messages onChildAdded error", err))

// Wipe UI when messages node is deleted
onValue(ref(db, messagesPath), snap => {
    if (!snap.exists()) { chat.innerHTML = ""; renderedIds.clear() }
})

// ── Typing ────────────────────────────────────────────────────────────────────
onValue(ref(db, typingPath), snap => {
    if (!typingIndicator) return
    const data = snap.val() || {}
    typingIndicator.style.display = Object.keys(data).some(id => id !== uid) ? "flex" : "none"
})

let typingTimeout
msgInput?.addEventListener('input', () => {
    if (!uid) return
    const tRef = ref(db, `${typingPath}/${uid}`)
    set(tRef, true)
    clearTimeout(typingTimeout)
    typingTimeout = setTimeout(() => remove(tRef), 1000)
})

// ── Context menu ──────────────────────────────────────────────────────────────
function showMenu(e, bubble, data) {
    const menu = el('msgMenu')
    if (!menu) return
    menu.style.display = 'flex'
    menu.style.left    = e.pageX + 'px'
    menu.style.top     = e.pageY + 'px'
    menu.dataset.name  = data.name  || ""
    menu.dataset.text  = data.text  || ""
    menu.dataset.id    = bubble.dataset.id || ""
}

document.addEventListener('mousedown', e => {
    const menu = el('msgMenu')
    if (menu && !e.target.closest('#msgMenu')) menu.style.display = 'none'
})

function getMenuData() {
    const menu = el('msgMenu')
    return { name: menu.dataset.name || "", text: menu.dataset.text || "", id: menu.dataset.id || "" }
}

el('menuCopy')?.addEventListener('click', () => {
    navigator.clipboard.writeText(getMenuData().text)
        .then(() => showToast("Copied!"))
        .catch(() => showToast("Copy failed.", true))
    el('msgMenu').style.display = 'none'
})

el('menuReply')?.addEventListener('click', () => {
    const { name, text, id } = getMenuData()
    if (!id) return
    replyTo = { name, text, id }
    updateReplyUI()
    el('msgMenu').style.display = 'none'
    msgInput?.focus()
})

el('menuReport')?.addEventListener('click', async () => {
    const { name, text, id } = getMenuData()
    el('msgMenu').style.display = 'none'
    if (!uid || !confirm(`Report this message from ${name}?`)) return
    try {
        await addDoc(collection(fs, "reports"), {
            messageId: id, messageText: text, senderName: name,
            reportedBy: uid, chatId, isDM,
            reportedAt: Date.now(), status: "pending"
        })
        showToast("Message reported.")
    } catch (err) { console.error(err); showToast("Failed to send report.", true) }
})

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg, isError = false) {
    let t = el('chat-toast')
    if (!t) { t = document.createElement('div'); t.id = 'chat-toast'; document.body.appendChild(t) }
    t.textContent = msg
    t.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
        background:${isError ? '#ea4335' : '#323232'};color:#fff;padding:10px 22px;
        border-radius:999px;font-size:14px;font-weight:600;z-index:9999;
        opacity:1;transition:opacity 0.4s;pointer-events:none;`
    clearTimeout(t._t)
    t._t = setTimeout(() => { t.style.opacity = '0' }, 2800)
}