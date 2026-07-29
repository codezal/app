function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}
function capitalize(str) {
  return str.length === 0 ? str : str[0].toUpperCase() + str.slice(1)
}
module.exports = { slugify, capitalize }
