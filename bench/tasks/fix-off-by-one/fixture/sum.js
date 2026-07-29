// sumTo(n) returns 1 + 2 + ... + n
function sumTo(n) {
  let total = 0
  for (let i = 1; i < n; i++) {
    total += i
  }
  return total
}

module.exports = { sumTo }
