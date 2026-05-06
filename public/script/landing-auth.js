import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { firebaseConfig } from "./secrets.js";

// Landing page behavior:
// - Do NOT auto-redirect away from the landing page on load.
// - If the user is signed-in and verified, keep them on the landing page,
//   but intercept navigation to the login/register flows: when they click
//   "Login" or "Register" the app should take them to `/home/` instead.
try {
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);

    // Track whether the current user is verified
    let isVerified = false;
    let initialAuthChecked = false;

    // We'll attach interceptors only after we receive the initial auth state
    const pendingAttach = () => {};

    onAuthStateChanged(auth, (user) => {
        isVerified = !!(user && user.emailVerified);
        if (!initialAuthChecked) {
            initialAuthChecked = true;

            // Monkey-patch `go()` so calls like `go('/login/')` route to `/home/`
            const originalGo = (typeof window.go === 'function') ? window.go.bind(window) : null;
            window.go = function(path) {
                if (!path) return;

                // Normalize path for matching (make it absolute-like)
                const normalized = path.startsWith('/') ? path : ('/' + path).replace(/\\/+/g, '/');

                // If user is verified and trying to go to login/register, redirect to home
                if (isVerified && (/^\/login(\/.*)?$/.test(normalized) || /^\/register(\/.*)?$/.test(normalized))) {
                    if (originalGo) { originalGo('/home/'); return }
                    const base = (window.location.origin + (window.siteBase || '')).replace(/\/$/, '');
                    window.location.href = base + '/home/';
                    return;
                }

                // Otherwise delegate to the original `go` if present
                if (originalGo) { originalGo(path); return }

                // Fallback navigation (mirrors behavior in global-settings.js)
                if (/^(https?:|\/\/|data:|mailto:)/.test(path)) { window.location.href = path; return }
                if (path.startsWith('/')) { window.location.href = ((window.siteBase || '') + path).replace(/\/+/g, '/'); return }
                window.location.href = path;
            };

            // Intercept anchor clicks that would otherwise navigate to `login` or `register`
            // so they go through our patched `go()` and get redirected to `/home/` when appropriate.
            function attachLinkInterceptors() {
                document.querySelectorAll('a[href]').forEach(a => {
                    const href = a.getAttribute('href') || '';
                    // Match simple relative or absolute login/register links
                    if (/^(\/?|.*\/)?(login|register)\/?$/.test(href)) {
                        a.addEventListener('click', (e) => {
                            e.preventDefault();
                            window.go(href);
                        });
                    }
                });
            }

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', attachLinkInterceptors);
            } else {
                attachLinkInterceptors();
            }
        }
    });

} catch (err) {
    console.warn('landing-auth init failed', err);
}
