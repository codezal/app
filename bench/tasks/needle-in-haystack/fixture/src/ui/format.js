function pad(str, len, ch) {
  const c = ch || " "
  return str.length >= len ? str : str + c.repeat(len - str.length)
}
function truncate(str, len) {
  return str.length <= len ? str : str.slice(0, len - 1) + "…"
}
module.exports = { pad, truncate }
