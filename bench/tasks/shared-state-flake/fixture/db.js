// Tiny in-memory "database" with a read counter for observability.
const rows = new Map()
let reads = 0

module.exports = {
  get(id) {
    reads++
    return rows.get(id)
  },
  put(id, row) {
    rows.set(id, row)
  },
  readCount() {
    return reads
  },
}
