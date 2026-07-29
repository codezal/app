function formatPrice(cents) {
  return "$" + (cents / 100).toFixed(2)
}

function productLine(name, cents) {
  return name + ": " + formatPrice(cents)
}

module.exports = { productLine }
