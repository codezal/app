const assert = require("node:assert")
const fs = require("node:fs")
const { execFileSync } = require("node:child_process")

const config = JSON.parse(fs.readFileSync("config.json", "utf8"))
assert.strictEqual(config.port, 3000, "config port changed")
assert.strictEqual(config.name, "demo-app", "config name changed")

const out = execFileSync(process.execPath, ["start.js"], { encoding: "utf8" })
assert.ok(out.includes("port=3000"), `unexpected output: ${out}`)
console.log("verify ok")
