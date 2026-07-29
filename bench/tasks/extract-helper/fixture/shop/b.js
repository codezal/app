function formatPrice(cents) {
  return "$" + (cents / 100).toFixed(2)
}

function receiptLine(cents) {
  return "total " + formatPrice(cents)
}

module.exports = { receiptLine }
