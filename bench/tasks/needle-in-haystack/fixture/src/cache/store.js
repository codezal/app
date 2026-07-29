function createStore(maxSize) {
  const map = new Map()
  return {
    get: (k) => map.get(k),
    set(k, v) {
      if (map.size >= maxSize && !map.has(k)) map.delete(map.keys().next().value)
      map.set(k, v)
    },
    size: () => map.size,
  }
}
module.exports = { createStore }
