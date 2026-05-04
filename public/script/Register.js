import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js"
import {
    getAuth,
    GoogleAuthProvider,
    GithubAuthProvider,
    signInWithPopup,
    createUserWithEmailAndPassword,
    updateProfile,
    onAuthStateChanged,
    sendEmailVerification,
    signOut
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js"
import { getFirestore, doc, setDoc } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js"
import { firebaseConfig, WORKER_URL } from "./secrets.js"
import { sanitizeString, isValidEmail } from './sanitizer.js'

const app = initializeApp(firebaseConfig)
const auth = getAuth(app)
const fs = getFirestore(app)

function getContinueUrl() {
    const defaultLocal = 'http://localhost:5000'
    const origin = (window.location && (window.location.protocol === 'file:' || !window.location.origin || window.location.origin === 'null'))
        ? defaultLocal
        : window.location.origin
    const base = (origin + (window.siteBase || '')).replace(/\/$/, '')
    return base + '/verify/'
}

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
    if (!user) return
    if (user.emailVerified) go('/home/')
    // otherwise stay on the verify/register flow
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

async function checkAuthAttempt(action, identifier) {
    if (!WORKER_URL) return { allowed: true }
    const id = sanitizeString(identifier || '', 256)
    if (id === null) return { allowed: false, error: 'identifier_too_long' }
    try {
        const res = await fetch(`${WORKER_URL.replace(/\/$/, '')}/auth/attempt`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, identifier: id })
        })
        if (!res.ok) {
            if (res.status === 429) return { allowed: false, retryAfter: res.headers.get('Retry-After') }
            return { allowed: true }
        }
        const j = await res.json()
        return { allowed: !!j.allowed, remaining: j.remaining }
    } catch (err) {
        console.warn('Auth attempt check failed', err)
        return { allowed: true }
    }
}

GoogleBtn.onclick = async () => {
    try {
        const ok = await checkAuthAttempt('oauth', '')
        if (!ok.allowed) { handleError({ message: 'Too many auth attempts. Try again later.' }); return }
        const res = await signInWithPopup(auth, googleProvider)
        await saveUserData(res.user)
        go('/home/')
    } catch (e) { handleError(e) }
}

GithubBtn.onclick = async () => {
    try {
        const ok = await checkAuthAttempt('oauth', '')
        if (!ok.allowed) { handleError({ message: 'Too many auth attempts. Try again later.' }); return }
        const res = await signInWithPopup(auth, githubProvider)
        await saveUserData(res.user)
        go('/home/')
    } catch (e) { handleError(e) }
}

submitform.onclick = async () => {
    const emailVal = sanitizeString(emailinput.value, 256)
    const usernameVal = sanitizeString(usernameinput.value, 64)
    const passVal  = sanitizeString(passinput.value, 256)

    formError.style.display = 'none'
    formError.textContent = ''

    if (!emailVal || !usernameVal || !passVal) {
        formError.textContent = 'Please fill in all fields'
        formError.style.display = 'block'
        return
    }

    if (!isValidEmail(emailVal)) {
        formError.textContent = 'Please enter a valid email address'
        formError.style.display = 'block'
        return
    }

    if (passVal.length < 6) {
        formError.textContent = 'Password must be at least 6 characters'
        formError.style.display = 'block'
        return
    }

    try {
        const ok = await checkAuthAttempt('register', emailVal)
        if (!ok.allowed) { handleError({ message: 'Too many registration attempts. Try again later.' }); return }
        const userCred = await createUserWithEmailAndPassword(auth, emailVal, passVal)
        await updateProfile(userCred.user, { displayName: usernameVal })
        await saveUserData(userCred.user)

        // Send email verification and redirect to verification info page
        const continueUrl = getContinueUrl()
        try {
            await sendEmailVerification(userCred.user, { url: continueUrl })
        } catch (err) {
            console.error('Failed to send verification email', err)
        }
        await signOut(auth)
        go('/verify/?sent=1')
    } catch (e) {
        if (e.code === 'auth/email-already-in-use') {
            formError.textContent = 'This email is already registered.'
            const a = document.createElement('a')
            a.textContent = ' Login instead'
            a.href = '/login/'
            a.style.color = 'var(--accent)'
            a.style.textDecoration = 'underline'
            a.addEventListener('click', (ev) => { ev.preventDefault(); go('/login/') })
            formError.appendChild(a)
            formError.style.display = 'block'
            return
        }
        handleError(e)
    }
}
