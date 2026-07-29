const sessions = new Map()
function createSession(userId, ttlMs) {
  const id = "sess_" + Math.random().toString(36).slice(2, 10)
  sessions.set(id, { userId, expiresAt: Date.now() + ttlMs })
  return id
}
function getSession(id) {
  const s = sessions.get(id)
  if (!s || s.expiresAt < Date.now()) return null
  return s
}
module.exports = { createSession, getSession }
