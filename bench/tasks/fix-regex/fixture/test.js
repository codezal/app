const assert = require("node:assert")
const { isEmail } = require("./validate")

assert.strictEqual(isEmail("user@example.com"), true)
assert.strictEqual(isEmail("a@b.co"), true)
assert.strictEqual(isEmail("a@b"), false, "must require a dot in the domain")
console.log("all tests passed")
