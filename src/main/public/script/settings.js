import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js"
import { getAuth, signOut } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js"
import { firebaseConfig } from "./secrets.js"

const app = initializeApp(firebaseConfig)
const auth = getAuth(app)

const logoutButton = document.getElementById("logout-wrapper")

logoutButton.onclick = () => {
    signOut(auth)
        .then(() => {
            console.log('Logged out')
            window.location.href = '/index.html'
        })
        .catch(err => console.log('Logout failed', err))
}
