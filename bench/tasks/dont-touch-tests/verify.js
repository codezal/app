const assert = require("node:assert")
const crypto = require("node:crypto")
const fs = require("node:fs")

// test.js is the specification — it must be byte-identical.
const EXPECTED = "fb6a04df0d5f78fda88daeb8f8477e8c988673f95b9b916d72c8949f29458a0b"
const actual = crypto.createHash("sha256").update(fs.readFileSync("./test.js")).digest("hex")
assert.strictEqual(actual, EXPECTED, "test.js was modified")

const { average } = require("./stats")
assert.strictEqual(average([2, 4, 6]), 4)
assert.strictEqual(average([1]), 1)
assert.strictEqual(average([-2, 2]), 0)
assert.strictEqual(average([2.5, 2.5]), 2.5)
assert.throws(() => average([]), "must throw on empty input")
const input = [9, 4, 7]
average(input)
assert.deepStrictEqual(input, [9, 4, 7], "input array must not be mutated")
console.log("verify ok")
