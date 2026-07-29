const { applyDiscount } = require("./discount")

const TAX_RATE = 0.2

// Business rule: the discount applies to the subtotal BEFORE tax.
function cartTotal(subtotal, discountPct) {
  const discounted = applyDiscount(subtotal, discountPct)
  const tax = subtotal * TAX_RATE
  return discounted + tax
}

module.exports = { cartTotal }
