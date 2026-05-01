// ── Global Settings Application ───────────────────────────────────────────────
// This script applies user settings from localStorage to all pages

// ── Dark Mode ─────────────────────────────────────────────────────────────────
if (localStorage.getItem("venture-dark") === "true") {
    document.body.classList.add("dark")
}

// ── Accent Color ──────────────────────────────────────────────────────────────
const savedAccent = localStorage.getItem("venture-accent") || "#4285f4"
document.documentElement.style.setProperty("--accent", savedAccent)
// For hover, slightly darken (simple approximation)
const hoverColor = savedAccent // TODO: implement darkening if needed
document.documentElement.style.setProperty("--accent-hover", hoverColor)

// ── Font Size ─────────────────────────────────────────────────────────────────
const savedFont = localStorage.getItem("venture-font-size") || "15"
document.body.style.fontSize = savedFont + "px"

// ── Bubble Style ──────────────────────────────────────────────────────────────
const savedBubble = localStorage.getItem("venture-bubble-style") || "rounded"
const bubbleMap = { rounded: "16px", square: "4px", pill: "999px" }
document.documentElement.style.setProperty("--bubble-radius", bubbleMap[savedBubble] || "16px")

// ── Navigation helper: support serving from `/public/` during local preview
;(function(){
    const p = window.location.pathname || ''
    const base = p.split('/').includes('public') ? '/public' : ''
    window.siteBase = base

    // Use `go(path)` to navigate. `path` may be:
    // - absolute (starts with `/`) -> prefixed with `siteBase`
    // - relative (starts with `./` or `..`) -> used as-is
    // - external (http:, //, mailto:, data:) -> used as-is
    window.go = function(path) {
        if (!path) return
        if (/^(https?:|\/\/|data:|mailto:)/.test(path)) { window.location.href = path; return }
        if (path.startsWith('/')) {
            window.location.href = (base + path).replace(/\/+/g, '/')
            return
        }
        // keep relative paths untouched so they resolve from the current document
        window.location.href = path
    }
})()