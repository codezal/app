const assert = require("node:assert")
const { sumTo } = require("./sum")

assert.strictEqual(sumTo(10), 55)
assert.strictEqual(sumTo(1), 1)
assert.strictEqual(sumTo(100), 5050)
assert.strictEqual(sumTo(0), 0)
console.log("verify ok")
