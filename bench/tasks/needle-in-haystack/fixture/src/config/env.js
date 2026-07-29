function requireEnv(name) {
  const v = process.env[name]
  if (v === undefined) throw new Error("missing env var: " + name)
  return v
}
function envInt(name, fallback) {
  const v = process.env[name]
  const n = v === undefined ? NaN : Number(v)
  return Number.isFinite(n) ? n : fallback
}
module.exports = { requireEnv, envInt }
