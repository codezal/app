#!/usr/bin/env bash
# Validates the hard bench tasks end-to-end WITHOUT a model:
#   1. the pristine fixture must FAIL verification (the task is real), and
#   2. the reference solution must PASS (the task is solvable and the grader
#      is correct).
# Run from the repo root:  bash bench/scripts/validate-tasks.sh
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TASKS="$ROOT/bench/tasks"
TMP="$ROOT/bench/.validate-tmp"
fail_count=0

ok()  { echo "    ok   — $1"; }
bad() { echo "    FAIL — $1"; fail_count=$((fail_count + 1)); }

stage() { # <task-id> -> prints staged dir
  local t="$1" d="$TMP/$1"
  rm -rf "$d"; mkdir -p "$d"
  cp -R "$TASKS/$t/fixture/." "$d/"
  cp "$TASKS/$t/verify.js" "$d/.bench-verify.js"
  printf '%s' "$d"
}

verify_ok() { (cd "$1" && node .bench-verify.js >/dev/null 2>&1); }

rm -rf "$TMP"; mkdir -p "$TMP"
# The staging dir lives inside the repo, whose root package.json sets
# "type": "module". Fixtures are CommonJS, so shield them (the real runner
# stages under os.tmpdir() and does not need this).
printf '{ "private": true, "type": "commonjs" }\n' > "$TMP/package.json"

echo "== hidden-edge-cases =="
d=$(stage hidden-edge-cases)
verify_ok "$d" && bad "pristine passes" || ok "pristine fails"
cat > "$d/palindrome.js" <<'JS'
function isPalindrome(str) {
  const clean = str.toLowerCase().replace(/[^a-z0-9]/g, "")
  return clean === clean.split("").reverse().join("")
}

module.exports = { isPalindrome }
JS
verify_ok "$d" && ok "solution passes" || bad "solution fails"

echo "== wrong-file-trap =="
d=$(stage wrong-file-trap)
verify_ok "$d" && bad "pristine passes" || ok "pristine fails"
cat > "$d/cart.js" <<'JS'
const { applyDiscount } = require("./discount")

const TAX_RATE = 0.2

// Business rule: the discount applies to the subtotal BEFORE tax.
function cartTotal(subtotal, discountPct) {
  const discounted = applyDiscount(subtotal, discountPct)
  return discounted * (1 + TAX_RATE)
}

module.exports = { cartTotal }
JS
if verify_ok "$d" && ! grep -Eq '/[[:space:]]*100' "$d/discount.js"; then
  ok "solution passes (discount.js untouched)"
else
  bad "solution fails"
fi

echo "== broken-test-runner =="
d=$(stage broken-test-runner)
(cd "$d" && npm test >/dev/null 2>&1) && bad "pristine npm test passes" || ok "pristine npm test fails"
perl -pi -e 's{\./tests/}{./test/}' "$d/package.json"
cat > "$d/src/report.js" <<'JS'
// Render a one-line summary: count, total and average rounded to 2 decimals.
function renderSummary(numbers) {
  const total = numbers.reduce((a, b) => a + b, 0)
  const avg = numbers.length === 0 ? 0 : total / numbers.length
  return "count=" + numbers.length + " total=" + total + " avg=" + Math.round(avg * 100) / 100
}

module.exports = { renderSummary }
JS
if (cd "$d" && npm test >/dev/null 2>&1) && verify_ok "$d"; then
  ok "solution passes (npm test + hidden asserts)"
else
  bad "solution fails"
fi

echo "== cross-file-rename =="
d=$(stage cross-file-rename)
verify_ok "$d" && bad "pristine passes" || ok "pristine fails"
for f in src/api.js src/cart.js src/invoice.js cli.js test.js; do
  perl -pi -e 's/calculateTotal/computeOrderTotal/g' "$d/$f"
done
if verify_ok "$d" && ! grep -Rq "calculateTotal" "$d"; then
  ok "solution passes (old name gone everywhere)"
else
  bad "solution fails"
fi

echo "== dont-touch-tests =="
d=$(stage dont-touch-tests)
verify_ok "$d" && bad "pristine passes" || ok "pristine fails"
cat > "$d/stats.js" <<'JS'
// Return the arithmetic mean of `nums`. Throws on empty input.
function average(nums) {
  if (nums.length === 0) throw new Error("empty input")
  const total = nums.reduce((a, b) => a + b, 0)
  return total / nums.length
}

module.exports = { average }
JS
verify_ok "$d" && ok "solution passes (test.js untouched, hash ok)" || bad "solution fails"

echo "== needle-in-haystack =="
d=$(stage needle-in-haystack)
verify_ok "$d" && bad "pristine passes" || ok "pristine fails"
cat > "$d/src/billing/proration.js" <<'JS'
// Prorate a monthly price for partial-month usage.
function prorate(monthlyPrice, daysUsed, daysInMonth) {
  return Math.round((monthlyPrice * daysUsed * 100) / daysInMonth) / 100
}

module.exports = { prorate }
JS
verify_ok "$d" && ok "solution passes" || bad "solution fails"

echo "== shared-state-flake =="
d=$(stage shared-state-flake)
verify_ok "$d" && bad "pristine passes" || ok "pristine fails"
cat > "$d/users.js" <<'JS'
const db = require("./db")

const cache = new Map()

function getUser(id) {
  if (!cache.has(id)) cache.set(id, db.get(id))
  return cache.get(id)
}

function createUser(id, name) {
  db.put(id, { id, name })
  cache.delete(id)
}

function updateUser(id, name) {
  db.put(id, { id, name })
  cache.delete(id)
}

module.exports = { getUser, createUser, updateUser }
JS
verify_ok "$d" && ok "solution passes (cache still caches)" || bad "solution fails"

echo "== exact-output-cli =="
d=$(stage exact-output-cli)
verify_ok "$d" && bad "pristine passes" || ok "pristine fails"
cat > "$d/cli.js" <<'JS'
const report = {
  service: "billing",
  status: "ok",
  totals: { users: 3, revenue: 149.5 },
}

console.log(JSON.stringify(report, null, 2))
JS
if verify_ok "$d" && ! grep -q "expected" "$d/cli.js"; then
  ok "solution passes (byte-for-byte, no golden-file read)"
else
  bad "solution fails"
fi

rm -rf "$TMP"
echo
if [ "$fail_count" -eq 0 ]; then
  echo "ALL HARD TASKS VALID (pristine fails, solution passes)"
else
  echo "$fail_count validation problem(s) — fix before running the optimizer"
  exit 1
fi
