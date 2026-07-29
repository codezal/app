const db = require("./db")

const cache = new Map()

function getUser(id) {
  if (!cache.has(id)) cache.set(id, db.get(id))
  return cache.get(id)
}

function createUser(id, name) {
  db.put(id, { id, name })
  cache.delete(id)
}

function updateUser(id, name) {
  db.put(id, { id, name })
}

module.exports = { getUser, createUser, updateUser }
