import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js"
import {
    getAuth,
    GoogleAuthProvider,
    GithubAuthProvider,
    signInWithPopup,
    createUserWithEmailAndPassword,
    updateProfile,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js"
import { getFirestore, doc, setDoc } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js"
import { firebaseConfig } from "./secrets.js"

const app = initializeApp(firebaseConfig)
const auth = getAuth(app)
const fs = getFirestore(app)

const googleProvider = new GoogleAuthProvider()
const githubProvider = new GithubAuthProvider()

const GoogleBtn  = document.getElementById('GoogleBtn')
const GithubBtn  = document.getElementById('GithubBtn')
const submitform = document.getElementById('submitform')
const emailinput = document.getElementById('email')
const usernameinput = document.getElementById('username')
const passinput  = document.getElementById('password')
const formError = document.getElementById('form-error')

// If already logged in, skip the register page entirely
onAuthStateChanged(auth, user => {
    if (user) go('/home/')
})

// Save user to Firestore
async function saveUserData(user) {
    await setDoc(doc(fs, "users", user.uid), {
        uid:      user.uid,
        username: user.displayName || user.email.split('@')[0],
        email:    user.email,
        pfp:      user.photoURL || null,
        friends:  [],
        groupChats: []
    }, { merge: true })
}

const handleError = e => {
    formError.textContent = e.message
    formError.style.display = 'block'
    console.error(e)
}

GoogleBtn.onclick = async () => {
    try {
        const res = await signInWithPopup(auth, googleProvider)
        await saveUserData(res.user)
        go('/home/')
    } catch (e) { handleError(e) }
}

GithubBtn.onclick = async () => {
    try {
        const res = await signInWithPopup(auth, githubProvider)
        await saveUserData(res.user)
        go('/home/')
    } catch (e) { handleError(e) }
}

submitform.onclick = async () => {
    const emailVal = emailinput.value.trim()
    const usernameVal = usernameinput.value.trim()
    const passVal  = passinput.value.trim()
    
    formError.style.display = 'none'
    formError.textContent = ''
    
    if (!emailVal || !usernameVal || !passVal) {
        formError.textContent = 'Please fill in all fields'
        formError.style.display = 'block'
        return
    }
    
    if (passVal.length < 6) {
        formError.textContent = 'Password must be at least 6 characters'
        formError.style.display = 'block'
        return
    }
    
    try {
        const userCred = await createUserWithEmailAndPassword(auth, emailVal, passVal)
        await updateProfile(userCred.user, { displayName: usernameVal })
        await saveUserData(userCred.user)
        go('/home/')
    } catch (e) {
        if (e.code === 'auth/email-already-in-use') {
            formError.textContent = 'This email is already registered. <a href="/login/" style="color: var(--accent);">Login instead</a>'
            formError.innerHTML = 'This email is already registered. <a href="/login/" style="color: var(--accent); text-decoration: underline;">Login instead</a>'
        }
        handleError(e)
    }
}
