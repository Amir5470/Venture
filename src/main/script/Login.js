import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js"
import { getAuth, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js"

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
