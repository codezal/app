function normalizeCustomer(raw) {
  return {
    id: String(raw.id),
    email: String(raw.email).trim().toLowerCase(),
    name: String(raw.name || "").trim(),
    tier: raw.tier === "enterprise" ? "enterprise" : "standard",
  }
}
module.exports = { normalizeCustomer }
