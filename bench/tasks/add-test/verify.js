const assert = require("node:assert")
const fs = require("node:fs")
const { execFileSync } = require("node:child_process")

assert.ok(fs.existsSync("test.js"), "test.js was not created")
const testSrc = fs.readFileSync("test.js", "utf8")
assert.ok(testSrc.includes("assert"), "test.js does not use node:assert")

// The agent's own test must pass.
execFileSync(process.execPath, ["test.js"], { encoding: "utf8" })

// Independent behavior check (guards against vacuous tests).
const { slugify } = require("./slugify")
assert.strictEqual(slugify("Hello World"), "hello-world")
assert.strictEqual(slugify("A  B"), "a-b")
assert.strictEqual(slugify("foo_bar baz"), "foo-bar-baz")
assert.strictEqual(slugify("already-slugged"), "already-slugged")
console.log("verify ok")
