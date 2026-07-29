const assert = require("node:assert")
const { calculateTotal } = require("./src/api")
const { cartSummary } = require("./src/cart")
const { renderInvoice } = require("./src/invoice")

assert.strictEqual(calculateTotal([{ price: 10, qty: 2 }]), 20)
assert.deepStrictEqual(cartSummary([{ price: 5, qty: 3 }]), { total: 15, count: 1 })
assert.strictEqual(renderInvoice([{ price: 7, qty: 2 }]), "INVOICE total=14")
console.log("all tests passed")
