const assert = require("node:assert")
const db = require("./db")
const { getUser, createUser, updateUser } = require("./users")

createUser(1, "alice")
getUser(1)
getUser(1)
assert.strictEqual(db.readCount(), 1, "cache removed: repeated reads must not hit the db")

updateUser(1, "bob")
assert.strictEqual(getUser(1).name, "bob", "stale read after first update")
updateUser(1, "carol")
assert.strictEqual(getUser(1).name, "carol", "stale read after second update")

const before = db.readCount()
getUser(1)
getUser(1)
assert.strictEqual(db.readCount(), before, "cache must serve repeated reads of unchanged data")
console.log("verify ok")
