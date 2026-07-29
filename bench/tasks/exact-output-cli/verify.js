const assert = require("node:assert")
const crypto = require("node:crypto")
const fs = require("node:fs")
const { execFileSync } = require("node:child_process")

// The golden file must not be edited to match a wrong output.
const EXPECTED = "3fa9d25db8c247769c55f11326047c0e2c07977fb999a8fe6674d6fb16fff9a1"
const actual = crypto.createHash("sha256").update(fs.readFileSync("./expected.txt")).digest("hex")
assert.strictEqual(actual, EXPECTED, "expected.txt was modified")

const out = execFileSync(process.execPath, ["cli.js"], { cwd: __dirname, encoding: "utf8" })
const expected = fs.readFileSync("./expected.txt", "utf8")
assert.strictEqual(
  out.replace(/\n$/, ""),
  expected.replace(/\n$/, ""),
  "stdout does not match expected.txt byte-for-byte",
)
console.log("verify ok")
