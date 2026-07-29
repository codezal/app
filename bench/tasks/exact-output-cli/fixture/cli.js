const report = {
  service: "billing",
  status: "ok",
  generatedAt: Date.now(),
  totals: { user_count: 3, revenue: 149.5 },
}

console.log("Report generated:")
console.log(JSON.stringify(report, null, 2))
