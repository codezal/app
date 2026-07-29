const assert = require("node:assert")
const { average } = require("./stats")

assert.strictEqual(average([2, 4, 6]), 4)
assert.throws(() => average([]), /empty/, "must throw on empty input")
const input = [3, 1, 2]
average(input)
assert.deepStrictEqual(input, [3, 1, 2], "input array must not be mutated")
console.log("all tests passed")
