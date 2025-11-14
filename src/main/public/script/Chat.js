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
