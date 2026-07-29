function parseUrl(url) {
  const m = /^(https?):\/\/([^/:]+)(?::(\d+))?(\/.*)?$/.exec(url)
  if (!m) throw new Error("invalid url: " + url)
  return { protocol: m[1], host: m[2], port: m[3] ? Number(m[3]) : m[1] === "https" ? 443 : 80, path: m[4] || "/" }
}
module.exports = { parseUrl }
