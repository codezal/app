const { calcTotal } = require("./util")

function dailyReport(orders) {
  return orders.map((o) => ({ id: o.id, total: calcTotal(o.items) }))
}

module.exports = { dailyReport }
