const assert = require("node:assert")
const fs = require("node:fs")
const { execFileSync } = require("node:child_process")

for (const f of ["util.js", "cart.js", "report.js", "main.js"]) {
  const src = fs.readFileSync(f, "utf8")
  assert.ok(!src.includes("calcTotal"), `${f} still references calcTotal`)
}

const util = fs.readFileSync("util.js", "utf8")
assert.ok(util.includes("computeTotal"), "util.js does not define computeTotal")
assert.ok(fs.readFileSync("cart.js", "utf8").includes("computeTotal"), "cart.js not updated")
assert.ok(fs.readFileSync("report.js", "utf8").includes("computeTotal"), "report.js not updated")

const out = execFileSync(process.execPath, ["main.js"], { encoding: "utf8" })
assert.ok(out.includes("CART:42"), `unexpected cart output: ${out}`)
assert.ok(out.includes('REPORT:[{"id":1,"total":10}]'), `unexpected report output: ${out}`)
console.log("verify ok")
