function formatDate(d) {
  const p = (n) => String(n).padStart(2, "0")
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate())
}
function addDays(d, n) {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}
module.exports = { formatDate, addDays }
