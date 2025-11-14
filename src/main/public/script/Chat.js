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
const userDisplay = document.getElementById("username")

let username = "anon"
let uid = null
let replyTo = null
let typingTimeout = null

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

// auth check
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

// send message
sendBtn.addEventListener("click", () => {
    if (msgInput.value.trim() === "") return

    push(ref(db, "messages"), {
        text: msgInput.value,
        user: username,
        time: Date.now()
    })

    msgInput.value = ""
})

// load messages
onValue(ref(db, "messages"), snap => {
    chat.innerHTML = ""

    snap.forEach(child => {
        const msg = child.val()

        const msgDiv = document.createElement("div")
        msgDiv.classList.add("msg")

        const time = new Date(msg.time).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
        })

        msgDiv.innerHTML = `
            <p>${msg.user}: ${msg.text}</p>
            <span class="timestamp">${time}</span>
        `

        chat.appendChild(msgDiv)
    })

    chat.scrollTop = chat.scrollHeight
})

// clear messages
clearBtn.addEventListener("click", () => {
    remove(ref(db, "messages"))
})

// logout
logoutBtn.addEventListener("click", () => {
    signOut(auth)
})

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

clearBtn.onclick = () => remove(ref(db, "messages"))
logoutBtn.onclick = () => signOut(auth)

onValue(ref(db, "typing"), snap => {
    const typingUsers = snap.val() || {}
    const otherTyping = Object.keys(typingUsers).filter(id => id !== uid)
    typingIndicator.style.display = otherTyping.length > 0 ? "flex" : "none"
})

cancelReplyBtn.onclick = () => {
    replyTo = null
    updateReplyUI()
}
