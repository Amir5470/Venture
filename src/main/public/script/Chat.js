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

const msgInput = document.getElementById("msg")
const chat = document.getElementById("chat")
const sendBtn = document.getElementById("send")
const clearBtn = document.getElementById("clearbtn")
const logoutBtn = document.getElementById("logout")
const chatContainer = document.getElementById('chat')
const userDisplay = document.getElementById('username')
const typingIndicator = document.getElementById('typingIndicator')
const cancelReplyBtn = document.getElementById('cancelReply')
const replyBar = document.getElementById('replyBar')
const replyText = document.getElementById('replyText')

let username = "anon"
let uid = null
let replyTo = null
let typingTimeout = null

onAuthStateChanged(auth, user => {
    if (user) {
        username = user.displayName || user.email?.split("@")[0] || "anon"
        uid = user.uid
        userDisplay.textContent = `Welcome Back, ${username}`

        Notification.requestPermission().then(async perm => {
            if (perm === "granted") {
                const token = await getToken(messaging, {
                    vapidKey: "BAeBCiGsPIPQa3FE6-MndYWTmWbdgWVGmGMxChSTfG84FdzJlZKjRhfHdGlehetHvm5Cr7c5VYVBx9ypFulMVCU"
                })
                const userRef = doc(fs, "users", uid)
                await updateDoc(userRef, { tokens: arrayUnion(token) })
            }
        })
    } else {
        window.location.href = "./index.html"
    }
})

document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        remove(ref(db, "messages")).catch(console.error)
    }
})

function updateReplyUI() {
    if (replyTo) {
        replyBar.style.display = 'flex'
        replyText.textContent = `Replying to ${replyTo.name}: "${replyTo.text}"`
    } else {
        replyBar.style.display = 'none'
        replyText.textContent = ''
    }
}

function sendMessage() {
    const text = msgInput.value.trim()
    if (!text || !uid) return

    const msgData = { name: username, text, uid }
    if (replyTo) {
        msgData.replyTo = { name: replyTo.name, text: replyTo.text }
        replyTo = null
        updateReplyUI()
    }

    push(ref(db, "messages"), msgData)
    msgInput.value = ""
}

sendBtn.onclick = sendMessage
msgInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage() })

function createBubble(data) {
    const bubble = document.createElement("div")
    bubble.className = `bubble ${data.uid === uid ? "sent" : "received"}`
    if (data.replyTo) {
        const replyDiv = document.createElement("div")
        replyDiv.className = "reply-preview"
        replyDiv.textContent = `↳ ${data.replyTo.name}: ${data.replyTo.text}`
        bubble.appendChild(replyDiv)
    }
    const textNode = document.createElement("div")
    textNode.textContent = `${data.name}: ${data.text}`
    bubble.appendChild(textNode)
    bubble.addEventListener('click', () => {
        if (replyTo && replyTo.id === data.id) replyTo = null
        else replyTo = { name: data.name, text: data.text, id: data.id }
        updateReplyUI()
    })
    return bubble
}

onValue(ref(db, "messages"), snap => {
    chat.innerHTML = ""
    const msgs = snap.val() || {}
    Object.entries(msgs).forEach(([id, data]) => {
        data.id = id
        chat.appendChild(createBubble(data))
    })
    chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'instant' })
})

clearBtn.onclick = () => remove(ref(db, "messages"))
logoutBtn.onclick = () => signOut(auth)

msgInput.addEventListener('input', () => {
    if (!uid) return
    const typingRef = ref(db, "typing/" + uid)
    push(typingRef, true)
    clearTimeout(typingTimeout)
    typingTimeout = setTimeout(() => remove(typingRef), 1000)
})

onValue(ref(db, "typing"), snap => {
    const typingUsers = snap.val() || {}
    const otherTyping = Object.keys(typingUsers).filter(id => id !== uid)
    typingIndicator.style.display = otherTyping.length > 0 ? "flex" : "none"
})

cancelReplyBtn.onclick = () => {
    replyTo = null
    updateReplyUI()
}
