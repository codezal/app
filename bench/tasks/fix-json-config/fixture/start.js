const { loadConfig } = require("./loader")

const config = loadConfig()
console.log("port=" + config.port)
