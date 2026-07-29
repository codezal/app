function isEmail(s) {
  return /^[^@\s]+@[^@\s]+$/.test(s)
}

module.exports = { isEmail }
