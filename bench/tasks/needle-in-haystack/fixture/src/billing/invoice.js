const { prorate } = require("./proration")

function buildInvoice(opts) {
  const prorated = prorate(opts.monthlyPrice, opts.daysUsed, opts.daysInMonth)
  return { customer: opts.customer, prorated, total: prorated }
}

module.exports = { buildInvoice }
