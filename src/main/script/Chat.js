import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js"
import { getDatabase, ref, push, onValue, remove } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js"
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js"
import { firebaseConfig } from "./secrets.js"

const app = initializeApp(firebaseConfig)
const db = getDatabase(app)
const auth = getAuth(app)

const msgInput = document.getElementById("msg")
const chat = document.getElementById("chat")
const sendBtn = document.getElementById("send")
const clearBtn = document.getElementById("clearbtn")
const logoutBtn = document.getElementById("logout")

let username = "anon"
let uid = null

onAuthStateChanged(auth, user => {
    if (user) {
        username = user.displayName || user.email?.split("@")[0] || "anon"
        uid = user.uid
    } else {
        window.location.href = "./Login.html"
    }
})

msgInput.addEventListener('keydown', function(event) {
    if (event.key === 'Enter') {
            const text = msgInput.value.trim()
        if (text && uid) {
            push(ref(db, "messages"), { name: username, text, uid })
            msgInput.value = ""
        }
    }
    });

sendBtn.onclick = () => {
    const text = msgInput.value.trim()
    if (text && uid) {
        push(ref(db, "messages"), { name: username, text, uid })
        msgInput.value = ""
    }
}

onValue(ref(db, "messages"), snap => {
    chat.innerHTML = ""
    const msgs = snap.val() || {}
    Object.entries(msgs).forEach(([id, data]) => {
        const bubble = document.createElement("div")
        bubble.className = `bubble ${data.uid === uid ? "sent" : "received"}`
        bubble.textContent = `${data.name}: ${data.text}`
        chat.appendChild(bubble)
    })
})

clearBtn.onclick = () => remove(ref(db, "messages"))
logoutBtn.onclick = () => signOut(auth)
