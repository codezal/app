const assert = require("node:assert")
const { add, subtract } = require("./math")

assert.strictEqual(add(2, 2), 4)
assert.strictEqual(subtract(5, 3), 2)
console.log("all tests passed")
