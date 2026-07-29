const assert = require("node:assert")
const { renderSummary } = require("./src/report")

assert.strictEqual(renderSummary([10, 20, 25]), "count=3 total=55 avg=18.33")
assert.strictEqual(renderSummary([]), "count=0 total=0 avg=0")
assert.strictEqual(renderSummary([1, 2]), "count=2 total=3 avg=1.5")
assert.strictEqual(renderSummary([7]), "count=1 total=7 avg=7")
assert.strictEqual(renderSummary([0.5, 1.5]), "count=2 total=2 avg=1")
console.log("verify ok")
