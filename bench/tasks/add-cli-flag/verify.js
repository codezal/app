const assert = require("node:assert")
const { execFileSync } = require("node:child_process")

const plain = execFileSync(process.execPath, ["main.js"], { encoding: "utf8" })
assert.ok(plain.includes("app v1.0"), `plain output changed: ${plain}`)
assert.ok(!plain.includes("verbose mode enabled"), "plain run must not print verbose line")

const verbose = execFileSync(process.execPath, ["main.js", "--verbose"], { encoding: "utf8" })
assert.ok(verbose.includes("app v1.0"), `verbose run lost base output: ${verbose}`)
assert.ok(verbose.includes("verbose mode enabled"), `verbose line missing: ${verbose}`)
assert.ok(
  verbose.indexOf("app v1.0") < verbose.indexOf("verbose mode enabled"),
  "verbose line must come after existing output",
)
console.log("verify ok")
