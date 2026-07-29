const assert = require("node:assert")
const { isPalindrome } = require("./palindrome")

// Visible cases must keep passing.
assert.strictEqual(isPalindrome("Racecar"), true, "visible case regressed")
assert.strictEqual(isPalindrome("hello"), false, "visible case regressed")

// Hidden edge cases — the real contract.
assert.strictEqual(isPalindrome("A man, a plan, a canal: Panama"), true, "must ignore spaces/punctuation")
assert.strictEqual(isPalindrome(""), true, "empty string is a palindrome")
assert.strictEqual(isPalindrome("a"), true)
assert.strictEqual(isPalindrome("ab"), false)
assert.strictEqual(isPalindrome("No 'x' in Nixon"), true)
assert.strictEqual(isPalindrome("12321"), true, "digits are alphanumeric")
assert.strictEqual(isPalindrome("12.21"), true)
assert.strictEqual(isPalindrome("1234"), false)
console.log("verify ok")
