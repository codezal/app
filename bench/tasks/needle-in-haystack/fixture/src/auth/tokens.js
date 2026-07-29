const crypto = require("node:crypto")
function signToken(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url")
  return body + "." + sig
}
function verifyToken(token, secret) {
  const [body, sig] = token.split(".")
  const want = crypto.createHmac("sha256", secret).update(body).digest("base64url")
  return sig === want ? JSON.parse(Buffer.from(body, "base64url").toString()) : null
}
module.exports = { signToken, verifyToken }
