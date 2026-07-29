const RATES = { standard: 0.2, reduced: 0.1, zero: 0 }
function applyTax(amount, kind) {
  const rate = RATES[kind]
  if (rate === undefined) throw new Error("unknown tax kind: " + kind)
  return Math.round(amount * (1 + rate) * 100) / 100
}
module.exports = { applyTax }
