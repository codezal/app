const { calculateTotal } = require("./api")

function cartSummary(items) {
  return { total: calculateTotal(items), count: items.length }
}

module.exports = { cartSummary }
