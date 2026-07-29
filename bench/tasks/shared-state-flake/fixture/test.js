const assert = require("node:assert")
const { getUser, createUser, updateUser } = require("./users")

createUser(1, "alice")
assert.strictEqual(getUser(1).name, "alice")
updateUser(1, "alice v2")
assert.strictEqual(getUser(1).name, "alice v2", "stale read after update")
console.log("all tests passed")
