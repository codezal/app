const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 }
function createLogger(level) {
  const min = LEVELS[level] || LEVELS.info
  const log = (l) => (...args) => {
    if (LEVELS[l] >= min) console.error("[" + l + "]", ...args)
  }
  return { debug: log("debug"), info: log("info"), warn: log("warn"), error: log("error") }
}
module.exports = { createLogger }
