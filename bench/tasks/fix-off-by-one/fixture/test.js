const assert = require("node:assert")
const { sumTo } = require("./sum")

assert.strictEqual(sumTo(10), 55)
console.log("all tests passed")
