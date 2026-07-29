// Discount rules. `pct` is a FRACTION (0.1 means 10%), not a percentage.
// Several billing services depend on this convention — do not change it.
function applyDiscount(price, pct) {
  return price - price * pct
}

module.exports = { applyDiscount }
