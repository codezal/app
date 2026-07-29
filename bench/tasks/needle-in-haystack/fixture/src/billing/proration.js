// Prorate a monthly price for partial-month usage.
const AVG_MONTH_DAYS = 30.44

function prorate(monthlyPrice, daysUsed, daysInMonth) {
  return Math.round((monthlyPrice / AVG_MONTH_DAYS) * daysUsed * 100) / 100
}

module.exports = { prorate }
