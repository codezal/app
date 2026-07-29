const assert = require("node:assert")
const { execFileSync } = require("node:child_process")

const env = { ...process.env }
delete env.PORT
const out = execFileSync(process.execPath, ["server.js"], { encoding: "utf8", env })
assert.ok(out.includes("listening on 8080"), `unexpected output: ${out}`)

const withEnv = execFileSync(process.execPath, ["server.js"], {
  encoding: "utf8",
  env: { ...process.env, PORT: "9999" },
})
assert.ok(withEnv.includes("listening on 9999"), `PORT env must still win: ${withEnv}`)
console.log("verify ok")
