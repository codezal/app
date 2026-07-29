const assert = require("node:assert")
const { renderSummary } = require("../src/report")

assert.strictEqual(renderSummary([10, 20, 25]), "count=3 total=55 avg=18.33")
assert.strictEqual(renderSummary([]), "count=0 total=0 avg=0")
console.log("all tests passed")
