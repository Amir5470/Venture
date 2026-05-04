import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js"
import { getAuth, applyActionCode } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js"
import { firebaseConfig } from "../script/secrets.js"
import { sanitizeString } from '../script/sanitizer.js'

const app = initializeApp(firebaseConfig)
const auth = getAuth(app)

document.addEventListener('DOMContentLoaded', async () => {
    const statusEl = document.getElementById('verify-status')
    const actionsEl = document.getElementById('verify-actions')
    const params = new URLSearchParams(window.location.search)
    const oobCode = params.get('oobCode')
    const sent = params.get('sent')

    function showLoginLink(text = 'Back to login') {
        actionsEl.innerHTML = ''
        const btn = document.createElement('button')
        btn.className = 'btn btn-primary'
        btn.textContent = text
        btn.addEventListener('click', (e) => { e.preventDefault(); go('/login/') })
        actionsEl.appendChild(btn)
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
            const safeMsg = sanitizeString(err?.message || String(err), 512) || 'Verification failed.'
            statusEl.textContent = `Verification failed: ${safeMsg}`
            const br = document.createElement('div')
            br.style.marginTop = '8px'
            br.textContent = 'Please try logging in to resend a verification email.'
            statusEl.appendChild(br)
            showLoginLink('Go to login')
            return
        }
    }

    if (sent) {
        statusEl.textContent = 'A verification email has been sent. Check your inbox and follow the link (check spam).'
        showLoginLink('Return to login')
        return
    }

    statusEl.textContent = 'No verification action detected. If you recently requested verification, check your inbox.'
    const a = document.createElement('a')
    a.href = '/login/'
    a.textContent = 'Go to login'
    a.addEventListener('click', (e) => { e.preventDefault(); go('/login/') })
    statusEl.appendChild(document.createTextNode(' '))
    statusEl.appendChild(a)
    showLoginLink('Go to login')
})
