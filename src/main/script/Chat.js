import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js"
import { getDatabase, ref, push, onValue, remove } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js"
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js"
import fs from 'fs'

const firebaseConfig = fs.readFileSync('secrets.txt', 'utf-8')
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
