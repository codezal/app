const { calculateTotal } = require("./api")

function renderInvoice(items) {
  return "INVOICE total=" + calculateTotal(items)
}

module.exports = { renderInvoice }
