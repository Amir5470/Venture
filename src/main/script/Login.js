import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js"
import { getAuth, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js"
import fs from 'fs'

const firebaseConfig = fs.readFileSync('secrets.txt', 'utf-8')

const app = initializeApp(firebaseConfig)
const auth = getAuth(app)
const provider = new GoogleAuthProvider()

const loginBtn = document.getElementById('loginBtn')
const err = document.getElementById('error')

loginBtn.addEventListener('click', async () => {
    try {
        const result = await signInWithPopup(auth, provider)
        console.log('signed in:', result.user.displayName)
        window.location.href = './Chat.html'
    } catch (e) {
        console.error(e)
        err.textContent = 'Google Sign In Failed'
        err.style.display = 'block'
    }
})
