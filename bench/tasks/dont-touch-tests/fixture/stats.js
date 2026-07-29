// Return the arithmetic mean of `nums`.
function average(nums) {
  const sorted = nums.sort((a, b) => a - b)
  const total = sorted.reduce((a, b) => a + b, 0)
  return total / sorted.length
}

module.exports = { average }
