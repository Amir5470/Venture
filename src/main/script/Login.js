import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js"
import {
    getAuth,
    GoogleAuthProvider,
    GithubAuthProvider,
    EmailAuthProvider,
    signInWithPopup,
    signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js"


import { firebaseConfig } from './secrets.js'

// init firebase
const app = initializeApp(firebaseConfig)
const auth = getAuth(app)

// providers
const googleProvider = new GoogleAuthProvider()
const githubProvider = new GithubAuthProvider()
const email = new EmailAuthProvider()

// elements
const GoogleBtn = document.getElementById('GoogleBtn')
const GithubBtn = document.getElementById('GithubBtn')
const err = document.getElementById('error')
const emailinput = document.getElementById('email')
const passinput = document.getElementById('password')
const LoginBtn = document.getElementById('submitform')


// google login
GoogleBtn.addEventListener('click', async () => {
    try {
        const result = await signInWithPopup(auth, googleProvider)
        console.log('signed in:', result.user.displayName)
        window.location.href = './Chat.html'
    } catch (e) {
        console.error(e)
        err.textContent = 'Google Sign In Failed'
        err.style.display = 'block'
    }
})

// github login
GithubBtn.addEventListener('click', async () => {
    try {
        const result = await signInWithPopup(auth, githubProvider)
        console.log('signed in:', result.user.displayName)
        window.location.href = './Chat.html'
    } catch (e) {
        console.error(e)
        err.textContent = 'Github Sign In Failed'
        err.style.display = 'block'
    }
})
//Email and pass login using firebase
LoginBtn.addEventListener('click', async () => {
    const emailVal = emailinput.value
    const passVal = passinput.value
    try {
        const result = await signInWithEmailAndPassword(auth, emailVal, passVal)
        console.log('signed in:', result.user.email)
        window.location.href = './Chat.html'
    } catch (e) {
        console.error(e)
        err.textContent = 'Email Sign In Failed'
        err.style.display = 'block'
    }
})
