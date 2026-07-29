const assert = require("node:assert")
const { isPalindrome } = require("./palindrome")

assert.strictEqual(isPalindrome("Racecar"), true)
assert.strictEqual(isPalindrome("hello"), false)
console.log("all tests passed")
