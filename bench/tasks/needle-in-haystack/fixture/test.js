const assert = require("node:assert")
const { buildInvoice } = require("./src/billing/invoice")

const inv = buildInvoice({ monthlyPrice: 60, daysUsed: 15, daysInMonth: 30, customer: "acme" })
assert.strictEqual(inv.prorated, 30, "15 of 30 days on a $60 plan should be $30")
assert.strictEqual(inv.total, 30)
console.log("all tests passed")
