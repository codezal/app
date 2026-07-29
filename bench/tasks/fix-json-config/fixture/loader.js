const fs = require("node:fs")

function loadConfig() {
  return JSON.parse(fs.readFileSync("config.json", "utf8"))
}

module.exports = { loadConfig }
