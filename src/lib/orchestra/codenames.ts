// Stable codenames for generic orchestra workers that have no user label.
// Gives each worker a memorable identity (like a person, not "worker-3") that
// stays the same for a given seed. Pool is intentionally scientists/mathematicians
// — distinct from any other product's naming — and deterministic per seed.
import { hashString } from "../identicon"

const CODENAMES = [
  "Kepler",
  "Curie",
  "Tesla",
  "Fermi",
  "Bohr",
  "Euler",
  "Gauss",
  "Noether",
  "Lovelace",
  "Hopper",
  "Turing",
  "Ramanujan",
  "Pascal",
  "Maxwell",
  "Faraday",
  "Planck",
  "Galois",
  "Hilbert",
  "Lorenz",
  "Hubble",
  "Pauli",
  "Mendel",
  "Dalton",
  "Riemann",
] as const

// Deterministic pick — same seed → same codename. Collisions across many
// workers are acceptable (identicon + worker label still disambiguate).
export function codenameFor(seed: string): string {
  return CODENAMES[hashString(seed) % CODENAMES.length]
}
