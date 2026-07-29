const { calcTotal } = require("./util")

function cartTotal(cart) {
  return calcTotal(cart.items)
}

module.exports = { cartTotal }
