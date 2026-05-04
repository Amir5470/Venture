// Client-side sanitization helpers
export const DEFAULT_MAX_INPUT = 1024

export function sanitizeString(val, maxLen = DEFAULT_MAX_INPUT) {
  if (val === undefined || val === null) return ''
  const s = String(val).trim()
  if (s.length === 0) return ''
  if (s.length > maxLen) return null
  return s
}

export function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}
