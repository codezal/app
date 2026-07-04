export const DOOM_WINDOW = 6
export const DOOM_REPEAT = 3

export function isDoomRepeat(
  history: string[],
  key: string,
  threshold = DOOM_REPEAT,
): boolean {
  let consecutive = 1
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i] === key) consecutive++
    else break
  }
  return consecutive >= threshold
}
