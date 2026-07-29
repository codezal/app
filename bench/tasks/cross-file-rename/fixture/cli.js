const { cartSummary } = require("./src/cart")

const items = [{ price: 10, qty: 2 }, { price: 5, qty: 1 }]
console.log(JSON.stringify(cartSummary(items)))
