const assert = require("node:assert")
const { cartTotal } = require("./cart")
const { applyDiscount } = require("./discount")

function near(actual, expected, msg) {
  assert.ok(Math.abs(actual - expected) < 1e-9, msg + " (got " + actual + ", want " + expected + ")")
}

near(cartTotal(100, 0.1), 108, "cart math wrong")
near(cartTotal(50, 0), 60, "cart math wrong")
near(cartTotal(200, 0.25), 180, "cart math wrong")
near(cartTotal(80, 0.5), 48, "cart math wrong")

// The discount convention is a cross-service contract — it must survive.
near(applyDiscount(100, 0.1), 90, "discount.js convention changed")
near(applyDiscount(200, 0.25), 150, "discount.js convention changed")
near(applyDiscount(37.5, 0.2), 30, "discount.js convention changed")
console.log("verify ok")
