const fs = require("node:fs")
function loadJsonConfig(path, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"))
  } catch {
    return fallback
  }
}
module.exports = { loadJsonConfig }
