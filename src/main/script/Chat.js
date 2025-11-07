import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js"
import { getDatabase, ref, push, onValue, remove } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js"
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js"

const firebaseConfig = {
    apiKey: "AIzaSyCcyZWnDpweRh7x-oEPtb7rcLy2Bh3Eo_E",
    authDomain: "venture-chat.firebaseapp.com",
    databaseURL: "https://venture-chat-default-rtdb.firebaseio.com",
    projectId: "venture-chat",
    storageBucket: "venture-chat.firebasestorage.app",
    messagingSenderId: "528529467639",
    appId: "1:528529467639:web:8b8cb7a6b4d404ed074bf2",
    measurementId: "G-JXMEC88ELT"
}

const app = initializeApp(firebaseConfig)
const db = getDatabase(app)
const auth = getAuth(app)
signInAnonymously(auth)

const nameInput = document.getElementById("name")
const msgInput = document.getElementById("msg")
const chat = document.getElementById("chat")
const sendBtn = document.getElementById("send")

sendBtn.onclick = () => {
    const name = nameInput.value.trim()
    const text = msgInput.value.trim()
    if (name && text) push(ref(db, "messages"), { name, text })
    msgInput.value = ""
}

onValue(ref(db, "messages"), snap => {
    chat.innerHTML = ""
    const msgs = snap.val() || {}
    Object.entries(msgs).forEach(([id, { name, text }]) => {
        const container = document.createElement("div")
        const p = document.createElement("p")
        p.textContent = `${name}: ${text}`
        const clearButton = document.getElementById("clearbtn")
        clearButton.onclick = () => remove(ref(db, "messages/" + id))
    })
})
