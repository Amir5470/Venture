import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js"
import { getAuth, applyActionCode } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js"
import { firebaseConfig } from "../script/secrets.js"

const app = initializeApp(firebaseConfig)
const auth = getAuth(app)

document.addEventListener('DOMContentLoaded', async () => {
    const statusEl = document.getElementById('verify-status')
    const actionsEl = document.getElementById('verify-actions')
    const params = new URLSearchParams(window.location.search)
    const oobCode = params.get('oobCode')
    const sent = params.get('sent')

    function showLoginLink(text = 'Back to login') {
        actionsEl.innerHTML = `<button class="btn btn-primary" onclick="event.preventDefault(); go('/login/');">${text}</button>`
    }

    if (oobCode) {
        statusEl.textContent = 'Verifying your email…'
        try {
            await applyActionCode(auth, oobCode)
            statusEl.textContent = 'Your email has been verified. Redirecting to login…'
            showLoginLink('Go to login')
            setTimeout(() => { go('/login/') }, 2500)
            return
        } catch (err) {
            console.error('applyActionCode error', err)
            statusEl.innerHTML = `Verification failed: ${err?.message || err}.` +
                ` <br>Please try logging in to resend a verification email.`
            showLoginLink('Go to login')
            return
        }
    }

    if (sent) {
        statusEl.textContent = 'A verification email has been sent. Check your inbox and follow the link (check spam).'
        showLoginLink('Return to login')
        return
    }

    statusEl.innerHTML = 'No verification action detected. If you recently requested verification, check your inbox. <a href="/login/" onclick="event.preventDefault(); go(\'/login/\');">Go to login</a>'
    showLoginLink('Go to login')
})
