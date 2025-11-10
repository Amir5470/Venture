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
import { getFirestore, doc, setDoc, updateDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js"
import { getMessaging, getToken } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-messaging.js"
import { firebaseConfig } from "./secrets.js"

const app = initializeApp(firebaseConfig)
const auth = getAuth(app)
const fs = getFirestore(app)
const messaging = getMessaging(app)

// providers
const googleProvider = new GoogleAuthProvider()
const githubProvider = new GithubAuthProvider()

const modeSwitch = document.getElementById('modeSwitch')
const loginPage = document.getElementById('userpassfield')
const signupPage = document.getElementById('signuppage')
const headername = document.getElementById('venture-login')

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

// notif token saver
async function saveToken(uid) {
    Notification.requestPermission().then(async perm => {
        if (perm === "granted") {
            const token = await getToken(messaging, { vapidKey: "BAeBCiGsPIPQa3FE6-MndYWTmWbdgWVGmGMxChSTfG84FdzJlZKjRhfHdGlehetHvm5Cr7c5VYVBx9ypFulMVCU" })
            const userRef = doc(fs, "users", uid)
            await updateDoc(userRef, { tokens: arrayUnion(token) })
        }
    })
}

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
        await saveToken(res.user.uid)
        window.location.href = "./home.html"
    } catch (e) {
        console.log(e)
    }
}

// github login
GithubBtn.onclick = async () => {
    try {
        const res = await signInWithPopup(auth, githubProvider)
        await saveUserData(res.user)
        await saveToken(res.user.uid)
        window.location.href = "./home.html"
    } catch (e) {
        console.log(e)
    }
}

// email login
submitform.onclick = async () => {
    const emailVal = emailinput.value.trim()
    const passVal = passinput.value.trim()
    try {
        const res = await signInWithEmailAndPassword(auth, emailVal, passVal)
        await saveUserData(res.user)
        await saveToken(res.user.uid)
        window.location.href = "./home.html"
    } catch (e) {
        console.log(e)
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
        await saveToken(userCred.user.uid)
        window.location.href = "./home.html"
    } catch (e) {
        console.log(e)
    }
}

// migrate old users on login
onAuthStateChanged(auth, user => {
    if (user) {
        saveUserData(user)
        saveToken(user.uid) // auto add token for old users if perm granted
        window.location.href = "./home.html"
    }
})
