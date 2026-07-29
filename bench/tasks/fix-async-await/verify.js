const assert = require("node:assert")
const { execFileSync } = require("node:child_process")

const out = execFileSync(process.execPath, ["main.js"], { encoding: "utf8" })
assert.ok(out.includes("CONTENT: hello world"), `unexpected output: ${out}`)
assert.ok(!out.includes("[object Promise]"), `still printing the promise: ${out}`)
console.log("verify ok")
