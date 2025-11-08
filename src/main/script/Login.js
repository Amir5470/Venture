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


//Oauth login 

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

//EMAIL & PASS LOGIN


//LOGGIN JS 
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

// REGISTER JS


const modeSwitch = document.getElementById('modeSwitch')
const loginFields = document.getElementById('userpassfield')
const signupFields = document.getElementById('signuppage')
const venturelogin = document.getElementById('venture-login')

signupFields.style.display = 'none'

modeSwitch.addEventListener('change', () => {
    if (modeSwitch.checked) {
        loginFields.style.display = 'none'
        signupFields.style.display = 'flex'
        venturelogin.textContent = 'Register for Venture'
    } else {
        loginFields.style.display = 'flex'
        signupFields.style.display = 'none'
        venturelogin.textContent = 'Login to Venture'
    }
})

import { createUserWithEmailAndPassword, updateProfile } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js"

document.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {

const registerBtn = document.getElementById('registerBtn')
registerBtn.addEventListener('click', async () => {
    const username = document.getElementById('Usernameinput').value.trim()
    const emailVal = document.getElementById('Emailinput').value.trim()
    const passVal = document.getElementById('Passinput').value.trim()

    function hideerror() {
        err.style.display = 'none'
    }

    if (!username || !emailVal || !passVal) {
        err.textContent = 'All fields are required for registration'
        err.style.display = 'block'

        return
    }

    try {
        const userCred = await createUserWithEmailAndPassword(auth, email, password)
        await updateProfile(userCred.user, { displayName: username })
        console.log('registered:', userCred.user.displayName)
        window.location.href = './Chat.html'
    } catch (e) {
        console.error(e)
        err.textContent = 'Register failed'
        err.style.display = 'block'
    }
})

}
});