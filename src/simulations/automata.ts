export type AutomatonRule = 'life' | 'highlife' | 'seeds' | 'brian'
export type Pattern = { name: string; cells: [number, number][] }
export const patterns: Record<string, Pattern> = {
  glider: { name: 'Glider', cells: [[1,0],[2,1],[0,2],[1,2],[2,2]] },
  lightweight: { name: 'Lightweight spaceship', cells: [[1,0],[4,0],[0,1],[0,2],[4,2],[0,3],[1,3],[2,3],[3,3]] },
  pulsar: { name: 'Pulsar', cells: [[2,0],[3,0],[4,0],[8,0],[9,0],[10,0],[0,2],[5,2],[7,2],[12,2],[0,3],[5,3],[7,3],[12,3],[0,4],[5,4],[7,4],[12,4],[2,5],[3,5],[4,5],[8,5],[9,5],[10,5],[2,7],[3,7],[4,7],[8,7],[9,7],[10,7],[0,8],[5,8],[7,8],[12,8],[0,9],[5,9],[7,9],[12,9],[0,10],[5,10],[7,10],[12,10],[2,12],[3,12],[4,12],[8,12],[9,12],[10,12]] },
  rpentomino: { name: 'R-pentomino', cells: [[1,0],[2,0],[0,1],[1,1],[1,2]] },
  acorn: { name: 'Acorn', cells: [[1,0],[3,1],[0,2],[1,2],[4,2],[5,2],[6,2]] },
}
patterns.pulsarGarden = {
  name: 'Pulsar garden',
  cells: [0, 20, 40].flatMap((y) => [0, 20, 40].flatMap((x) => patterns.pulsar.cells.map(([px, py]) => [x + px, y + py] as [number, number]))),
}
export function stepAutomaton(cells: Uint8Array, width: number, height: number, rule: AutomatonRule = 'life') {
  if (cells.length !== width * height) throw new Error('Grid dimensions do not match cell count')
  const next = new Uint8Array(cells.length)
  const at = (x: number, y: number) => cells[((y + height) % height) * width + ((x + width) % width)]
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x, current = cells[index]
    let neighbors = 0
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) neighbors += at(x + dx, y + dy) === 1 ? 1 : 0
    if (rule === 'brian') next[index] = current === 1 ? 2 : current === 2 ? 0 : neighbors === 2 ? 1 : 0
    else if (rule === 'seeds') next[index] = current === 1 ? 0 : neighbors === 2 ? 1 : 0
    else next[index] = current === 1 ? (neighbors === 2 || neighbors === 3 ? 1 : 0) : (neighbors === 3 || (rule === 'highlife' && neighbors === 6) ? 1 : 0)
  }
  return next
}
export function placePattern(cells: Uint8Array, width: number, height: number, pattern: Pattern, originX: number, originY: number, clear = true) {
  if (clear) cells.fill(0)
  for (const [dx, dy] of pattern.cells) {
    const x = (originX + dx + width) % width, y = (originY + dy + height) % height
    cells[y * width + x] = 1
  }
  return cells
}
