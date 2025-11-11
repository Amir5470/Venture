import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js"
import {
    getAuth,
    GoogleAuthProvider,
    GithubAuthProvider,
    EmailAuthProvider,
    signInWithPopup,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    updateProfile,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js"
import { getFirestore, doc, setDoc } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js"
import { firebaseConfig } from "./secrets.js"

const app = initializeApp(firebaseConfig)
const auth = getAuth(app)
const fs = getFirestore(app)

// providers
const googleProvider = new GoogleAuthProvider()
const githubProvider = new GithubAuthProvider()

const modeSwitch = document.getElementById('modeSwitch')
const loginPage = document.getElementById('userpassfield')
const signupPage = document.getElementById('signuppage')
const headername = document.getElementById('venture-login')
const GoogleBtn = document.getElementById('GoogleBtn')
const GithubBtn = document.getElementById('GithubBtn')
const submitform = document.getElementById('submitform')
const emailinput = document.getElementById('email')
const passinput = document.getElementById('password')
const registerBtn = document.getElementById('registerBtn')

signupPage.style.display = 'none'

modeSwitch.addEventListener('change', () => {
    if (modeSwitch.checked) {
        loginPage.style.display = 'none'
        signupPage.style.display = 'flex'
        headername.textContent = "Register for Venture"
    } else {
        loginPage.style.display = 'flex'
        signupPage.style.display = 'none'
        headername.textContent = "Login to Venture"
    }
})

// save user to firestore
async function saveUserData(user) {
    await setDoc(doc(fs, "users", user.uid), {
        uid: user.uid,
        username: user.displayName || user.email.split('@')[0],
        email: user.email,
        pfp: user.photoURL || null,
        friends: []
    }, { merge: true })
}

// google login
GoogleBtn.onclick = async () => {
    try {
        const res = await signInWithPopup(auth, googleProvider)
        await saveUserData(res.user)
        window.location.href = "/home.html"
    } catch (e) {
        if (e.code === 'auth/account-exists-with-different-credential') {
            console.log('This Email is already used with another account!')
            alert('This Email is already used with another account!')
        } else {
            console.log(e)
        }
    }
}

// github login
GithubBtn.onclick = async () => {
    try {
        const res = await signInWithPopup(auth, githubProvider)
        await saveUserData(res.user)
        window.location.href = "/home.html"
    } catch (e) {
        if (e.code === 'auth/account-exists-with-different-credential') {
            console.log('This Email is already used with another account!')
            alert('This Email is already used with another account!')
        } else {
            console.log(e)
        }
    }
}

// email login
submitform.onclick = async () => {
    const emailVal = emailinput.value.trim()
    const passVal = passinput.value.trim()
    try {
        const res = await signInWithEmailAndPassword(auth, emailVal, passVal)
        await saveUserData(res.user)
        window.location.href = "/home.html"
    } catch (e) {
        if (e.code === 'auth/account-exists-with-different-credential') {
            console.log('This Email is already used with another account!')
            alert('This Email is already used with another account!')
        } else {
            console.log(e)
        }
    }
}

// register
registerBtn.onclick = async () => {
    const username = document.getElementById('Usernameinput').value.trim()
    const emailVal = document.getElementById('Emailinput').value.trim()
    const passVal = document.getElementById('Passinput').value.trim()
    try {
        const userCred = await createUserWithEmailAndPassword(auth, emailVal, passVal)
        await updateProfile(userCred.user, { displayName: username })
        await saveUserData(userCred.user)
        window.location.href = "/home.html"
    } catch (e) {
        if (e.code === 'auth/account-exists-with-different-credential') {
            console.log('This Email is already used with another account!')
            alert('This Email is already used with another account!')
        } else {
            console.log(e)
        }
    }
}