const assert = require("node:assert")
const { cartTotal } = require("./cart")

function near(actual, expected, msg) {
  assert.ok(Math.abs(actual - expected) < 1e-9, msg + " (got " + actual + ", want " + expected + ")")
}

near(cartTotal(100, 0.1), 108, "discount must apply before tax")
near(cartTotal(50, 0), 60, "no discount: subtotal plus 20% tax")
console.log("all tests passed")
