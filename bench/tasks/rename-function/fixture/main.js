const { cartTotal } = require("./cart")
const { dailyReport } = require("./report")

const cart = { items: [{ price: 20, qty: 2 }, { price: 2, qty: 1 }] }
const orders = [{ id: 1, items: [{ price: 10, qty: 1 }] }]

console.log("CART:" + cartTotal(cart))
console.log("REPORT:" + JSON.stringify(dailyReport(orders)))
