function calculateTotal(items) {
  return items.reduce((sum, it) => sum + it.price * it.qty, 0)
}

module.exports = { calculateTotal }
