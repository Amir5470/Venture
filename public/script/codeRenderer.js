// Lightweight code renderer using Shiki with graceful fallback
export async function highlightCodeBlock(code, lang = '') {
  // Escape helper for fallback
  const escapeHtml = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

  // Use Highlight.js for highlighting (reliable CDN); always return raw code and let
  // the caller insert textContent and call `hljs.highlightElement` to avoid
  // unescaped-HTML warnings and security risks.
  async function loadScript(url) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${url}"]`)) return resolve()
      const s = document.createElement('script')
      s.src = url
      s.async = true
      s.onload = () => resolve()
      s.onerror = (e) => reject(e)
      document.head.appendChild(s)
    })
  }
  async function loadCSS(url) {
    if (document.querySelector(`link[href="${url}"]`)) return
    const l = document.createElement('link')
    l.rel = 'stylesheet'
    l.href = url
    document.head.appendChild(l)
  }

  try {
    await loadCSS('https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/styles/github-dark.min.css')
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/highlight.min.js')
    // Return an object indicating fallback
    return { kind: 'hljs', code, lang }
  } catch (e) {
    // ignore and fallback to plain
  }
  return { kind: 'plain', code }
}

export function attachCopyButton(container, lang = '') {
  if (!container) return
  // avoid duplicating button
  if (container.querySelector('.code-copy-btn')) return

  const wrapperPos = window.getComputedStyle(container).position
  if (!wrapperPos || wrapperPos === 'static') container.style.position = 'relative'

  const langLabel = document.createElement('span')
  langLabel.className = 'code-lang'
  langLabel.innerText = (lang || '').toUpperCase()
  if (langLabel.innerText) {
    container.appendChild(langLabel)
  }

  const btn = document.createElement('button')
  btn.className = 'code-copy-btn'
  btn.type = 'button'
  btn.title = 'Copy code'
  btn.innerText = 'Copy'

  btn.addEventListener('click', async () => {
    const codeEl = container.querySelector('code')
    if (!codeEl) return
    const text = codeEl.innerText || codeEl.textContent || ''
    try {
      await navigator.clipboard.writeText(text)
      btn.innerText = 'Copied'
      setTimeout(() => (btn.innerText = 'Copy'), 1500)
    } catch (e) {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy'); btn.innerText = 'Copied' } catch {}
      ta.remove()
      setTimeout(() => (btn.innerText = 'Copy'), 1500)
    }
  })

  // Prevent clicks on the button from bubbling up to the bubble (which triggers reply selection)
  btn.addEventListener('mousedown', (e) => e.stopPropagation())
  btn.addEventListener('click', (e) => e.stopPropagation())
  btn.addEventListener('touchstart', (e) => e.stopPropagation())

  btn.classList.add('code-copy-btn')
  // add visually-hidden label for accessibility
  btn.setAttribute('aria-label', 'Copy code')

  container.appendChild(btn)
}
