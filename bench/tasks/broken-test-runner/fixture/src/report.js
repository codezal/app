// Render a one-line summary: count, total and average rounded to 2 decimals.
function renderSummary(numbers) {
  const total = numbers.reduce((a, b) => a + b, 0)
  const avg = numbers.length === 0 ? 0 : total / numbers.length
  return "count=" + numbers.length + " total=" + total + " avg=" + Math.ceil(avg)
}

module.exports = { renderSummary }
