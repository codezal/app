const assert = require("node:assert")
const { add, subtract } = require("./math")

assert.strictEqual(add(2, 2), 4, "add regressed")
assert.strictEqual(subtract(5, 3), 2, "subtract still broken")
assert.strictEqual(subtract(3, 5), -2, "subtract sign wrong")
assert.strictEqual(subtract(0, 0), 0)
console.log("verify ok")
