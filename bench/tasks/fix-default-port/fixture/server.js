const fs = require("node:fs")

const settings = JSON.parse(fs.readFileSync("settings.json", "utf8"))
const port = process.env.PORT || settings.port
console.log("listening on " + port)
