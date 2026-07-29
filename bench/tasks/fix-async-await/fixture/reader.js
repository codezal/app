const fs = require("node:fs/promises")

async function readData() {
  return (await fs.readFile("data.txt", "utf8")).trim()
}

module.exports = { readData }
