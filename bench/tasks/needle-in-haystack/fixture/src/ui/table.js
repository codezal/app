const { pad } = require("./format")
function renderTable(rows, columns) {
  const widths = columns.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c]).length)))
  const line = (vals) => vals.map((v, i) => pad(String(v), widths[i])).join(" | ")
  return [line(columns), ...rows.map((r) => line(columns.map((c) => r[c])))].join("\n")
}
module.exports = { renderTable }
