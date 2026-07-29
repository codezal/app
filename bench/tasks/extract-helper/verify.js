const assert = require("node:assert")
const fs = require("node:fs")
const { execFileSync } = require("node:child_process")

assert.ok(fs.existsSync("shop/format.js"), "shop/format.js was not created")
const format = require("./shop/format.js")
assert.strictEqual(typeof format.formatPrice, "function", "format.js must export formatPrice")
assert.strictEqual(format.formatPrice(150), "$1.50")
assert.strictEqual(format.formatPrice(0), "$0.00")

for (const f of ["shop/a.js", "shop/b.js"]) {
  const src = fs.readFileSync(f, "utf8")
  assert.ok(!src.includes("function formatPrice"), `${f} still defines its own formatPrice`)
  assert.ok(src.includes("format"), `${f} does not reference the shared module`)
}

const out = execFileSync(process.execPath, ["shop/index.js"], { encoding: "utf8" })
assert.ok(out.includes("apple: $1.50"), `unexpected output: ${out}`)
assert.ok(out.includes("total $1.50"), `unexpected output: ${out}`)
console.log("verify ok")
