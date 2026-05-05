// Code detection helper: prefer highlight.js auto-detection when available,
// fall back to conservative heuristics.
export function detectCode(input) {
  const text = String(input || '')
  const raw = text.trim()
  if (!raw) return { isCode: false }

  // Prefer highlight.js auto-detection if available
  try {
    if (typeof window !== 'undefined' && window.hljs && typeof window.hljs.highlightAuto === 'function') {
      const res = window.hljs.highlightAuto(raw)
      if (res && res.language && res.relevance && res.relevance > 0) {
        return { isCode: true, lang: res.language, code: text }
      }
    }
  } catch (e) {
    // ignore and fall back
  }

  const lines = raw.split(/\r?\n/).map(l => l.replace(/\t/g, '    '))

  // HTML / XML
  if (/^<\s*\/?[a-zA-Z!]/.test(raw)) return { isCode: true, lang: 'html', code: text }

  // JSON
  try { JSON.parse(raw); return { isCode: true, lang: 'json', code: text } } catch (_) {}

  // YAML-like
  const yamlLike = lines.length >= 2 && lines.filter(l => /:\s+/.test(l)).length >= Math.min(2, lines.length)
  if (yamlLike && !/[{}\[\]]/.test(raw)) return { isCode: true, lang: 'yaml', code: text }

  // Shebangs (shell/python)
  if (/^#!\//.test(raw)) {
    if (/\bpython\b/.test(raw)) return { isCode: true, lang: 'python', code: text }
    if (/\b(node|bash|sh)\b/.test(raw)) return { isCode: true, lang: 'bash', code: text }
    return { isCode: true, lang: 'bash', code: text }
  }

  // Go
  if (/\b(package\s+\w+;|\bfunc\s+\w+\()/.test(raw)) return { isCode: true, lang: 'go', code: text }

  // PHP
  if (/^<\?php|\becho\s+\$|\$\w+\s*=/.test(raw)) return { isCode: true, lang: 'php', code: text }

  // C / C++ / Java heuristics
  if (/\b(public|private|protected)\s+class\b|\bSystem\.out\.println\b|\bnew\s+\w+\(|#include\s+</.test(raw)) {
    if (/#include\s+</.test(raw) || /\bint\s+main\s*\(/.test(raw)) return { isCode: true, lang: 'c', code: text }
    if (/\bclass\b/.test(raw) && /\bpublic\b/.test(raw)) return { isCode: true, lang: 'java', code: text }
    return { isCode: true, lang: 'cpp', code: text }
  }

  // JavaScript / TypeScript heuristics
  const looksLikeJsKeyword = /console\.log\(|=>|\bconst\b|\blet\b|\bvar\b|\bfunction\b|\bimport\b|\bexport\b/.test(raw)
  const jsClassDecl = /(^|\s)class\s+[A-Za-z_$][A-Za-z0-9_$]*/.test(raw)
  if (looksLikeJsKeyword || jsClassDecl) {
    if (/:\s*\w+\s*(=|;|,)/.test(raw) || /interface\s+\w+/.test(raw)) return { isCode: true, lang: 'typescript', code: text }
    return { isCode: true, lang: 'javascript', code: text }
  }

  // CSS
  if (/^[.#]?[a-zA-Z0-9_\-\s,>:+\[\]=()]+\s*\{[\s\S]*\}/.test(raw) || /[a-z-]+\s*:\s*[#0-9a-zA-Z%]+;/.test(raw)) {
    return { isCode: true, lang: 'css', code: text }
  }

  // SQL
  if (/\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(raw)) return { isCode: true, lang: 'sql', code: text }

  // Python def/class
  if (/^\s*(def|class)\s+\w+\s*\(|^\s*import\s+|:\s*$/.test(raw) || /^\s*def\s+\w+:/.test(lines[0])) return { isCode: true, lang: 'python', code: text }

  // JSON-like
  if (/^[{\[]\s*"?\w+/.test(raw) && raw.length < 2000) return { isCode: true, lang: 'json', code: text }

  // Heuristic scoring for multi-line generic code
  if (lines.length >= 2) {
    let score = 0
    for (const l of lines) {
      if (/[;{}()=<>+\-*/\\]/.test(l)) score++
      if (/\b(return|if|else|for|while|switch|case|try|catch|import|from|class|def)\b/.test(l)) score++
    }
    if (score >= Math.max(2, Math.floor(lines.length / 2))) return { isCode: true, lang: 'javascript', code: text }
  }

  return { isCode: false }
}

// Expose for console debugging
if (typeof window !== 'undefined') window.detectCode = detectCode
