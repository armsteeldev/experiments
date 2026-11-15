export type GardenAgent = { id: number; x: number; y: number; vx: number; vy: number; energy: number; speed: number; efficiency: number; metabolism: number; generation: number; age: number; hue: number }
export type GardenFood = { x: number; y: number; energy: number }
export type GardenState = { width: number; height: number; agents: GardenAgent[]; food: GardenFood[]; rng: number; nextId: number; tick: number; generation: number; temperature: number; resourceRate: number; resourceAccumulator: number; maxPopulation: number; births: number; deaths: number; totalBirths: number; totalDeaths: number; history: { population: number; meanEfficiency: number; resources: number }[] }

export function randomStep(state: Pick<GardenState, 'rng'>): number {
  state.rng = (Math.imul(state.rng, 1664525) + 1013904223) >>> 0
  return state.rng / 4294967296
}

export function createGardenState(seed = 41721, width = 1000, height = 700): GardenState {
  const state: GardenState = { width, height, agents: [], food: [], rng: seed >>> 0, nextId: 0, tick: 0, generation: 0, temperature: 0.42, resourceRate: 1, resourceAccumulator: 0, maxPopulation: 320, births: 0, deaths: 0, totalBirths: 0, totalDeaths: 0, history: [] }
  for (let i = 0; i < 34; i++) {
    const angle = i * 2.399963229728653
    const radius = Math.sqrt(i / 34) * Math.min(width, height) * 0.23
    addGardenAgent(state, width * 0.5 + Math.cos(angle) * radius, height * 0.5 + Math.sin(angle) * radius, { speed: 36 + randomStep(state) * 12, efficiency: 0.46 + randomStep(state) * 0.2, metabolism: 0.018 + randomStep(state) * 0.012, energy: 0.57 + randomStep(state) * 0.15 })
  }
  for (let i = 0; i < 46; i++) addGardenFood(state, randomStep(state) * width, randomStep(state) * height, 0.55 + randomStep(state) * 0.45)
  return state
}

export function addGardenAgent(state: GardenState, x: number, y: number, traits?: Partial<Pick<GardenAgent, 'speed' | 'efficiency' | 'metabolism' | 'energy' | 'hue'>>): GardenAgent {
  const angle = randomStep(state) * Math.PI * 2
  const agent: GardenAgent = {
    id: state.nextId++, x: Math.max(0, Math.min(state.width, x)), y: Math.max(0, Math.min(state.height, y)), vx: Math.cos(angle), vy: Math.sin(angle),
    energy: traits?.energy ?? 0.62, speed: traits?.speed ?? 38, efficiency: traits?.efficiency ?? 0.58, metabolism: traits?.metabolism ?? 0.024,
    generation: 0, age: 0, hue: traits?.hue ?? 128 + randomStep(state) * 36,
  }
  state.agents.push(agent)
  return agent
}

export function addGardenFood(state: GardenState, x: number, y: number, energy = 0.72): void {
  if (state.food.length < 180) state.food.push({ x: Math.max(0, Math.min(state.width, x)), y: Math.max(0, Math.min(state.height, y)), energy })
}

export function meanGardenTrait(state: GardenState, trait: 'speed' | 'efficiency' | 'metabolism'): number {
  if (!state.agents.length) return 0
  return state.agents.reduce((sum, agent) => sum + agent[trait], 0) / state.agents.length
}

function foodSpatialHash(state: GardenState, cellSize: number): Map<number, number[]> {
  const map = new Map<number, number[]>()
  const cols = Math.ceil(state.width / cellSize)
  for (let i = 0; i < state.food.length; i++) {
    const food = state.food[i], x = Math.floor(food.x / cellSize), y = Math.floor(food.y / cellSize), key = y * cols + x
    const bucket = map.get(key)
    if (bucket) bucket.push(i); else map.set(key, [i])
  }
  return map
}

export function stepGarden(state: GardenState, dt = 0.08): void {
  const step = Math.max(0, Math.min(0.2, dt)), cellSize = 96, cols = Math.ceil(state.width / cellSize), buckets = foodSpatialHash(state, cellSize)
  const rows = Math.ceil(state.height / cellSize)
  const consumed = new Set<number>(), offspring: GardenAgent[] = []
  state.births = 0; state.deaths = 0
  const survivors: GardenAgent[] = []
  for (const agent of state.agents) {
    agent.age += step
    let target: GardenFood | null = null, targetIndex = -1, nearest = Infinity
    const cx = Math.floor(agent.x / cellSize), cy = Math.floor(agent.y / cellSize)
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const nx = cx + ox, ny = cy + oy
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue
      const cell = ny * cols + nx
      for (const index of buckets.get(cell) ?? []) {
        if (consumed.has(index)) continue
        const food = state.food[index], distance = Math.hypot(food.x - agent.x, food.y - agent.y)
        if (distance < nearest) { nearest = distance; target = food; targetIndex = index }
      }
    }
    if (target && nearest < 170) {
      const inv = 1 / Math.max(1e-5, nearest), desiredX = (target.x - agent.x) * inv, desiredY = (target.y - agent.y) * inv
      agent.vx += (desiredX - agent.vx) * Math.min(1, step * 1.65)
      agent.vy += (desiredY - agent.vy) * Math.min(1, step * 1.65)
    } else {
      const turn = (randomStep(state) - 0.5) * step * 4
      const oldX = agent.vx
      agent.vx = agent.vx * Math.cos(turn) - agent.vy * Math.sin(turn)
      agent.vy = oldX * Math.sin(turn) + agent.vy * Math.cos(turn)
    }
    const velocityLength = Math.hypot(agent.vx, agent.vy) || 1
    agent.vx /= velocityLength; agent.vy /= velocityLength
    const speedFactor = 0.76 + agent.speed / 120
    agent.x += agent.vx * agent.speed * speedFactor * step
    agent.y += agent.vy * agent.speed * speedFactor * step
    if (agent.x < 14 || agent.x > state.width - 14) { agent.vx *= -1; agent.x = Math.max(14, Math.min(state.width - 14, agent.x)) }
    if (agent.y < 14 || agent.y > state.height - 14) { agent.vy *= -1; agent.y = Math.max(14, Math.min(state.height - 14, agent.y)) }
    agent.energy -= (agent.metabolism * (0.7 + state.temperature * 0.9) + agent.speed * 0.000075) * step
    if (target && nearest < 23 && !consumed.has(targetIndex)) {
      consumed.add(targetIndex)
      const absorbed = target.energy * agent.efficiency
      agent.energy += absorbed
      target.energy = 0
    }
    if (agent.energy >= 1.2 && state.agents.length + offspring.length < state.maxPopulation) {
      agent.energy -= 0.54
      const mutation = (base: number, spread: number, low: number, high: number) => Math.max(low, Math.min(high, base + (randomStep(state) - 0.5) * spread))
      offspring.push({
        ...agent, id: state.nextId++, x: agent.x + (randomStep(state) - 0.5) * 18, y: agent.y + (randomStep(state) - 0.5) * 18,
        vx: -agent.vy, vy: agent.vx, energy: 0.46, speed: mutation(agent.speed, 7, 20, 72), efficiency: mutation(agent.efficiency, 0.12, 0.25, 0.92),
        metabolism: mutation(agent.metabolism, 0.006, 0.008, 0.06), generation: agent.generation + 1, age: 0, hue: mutation(agent.hue, 15, 94, 190),
      })
      state.births++
      state.totalBirths++
    }
    const lifespan = 16 + agent.efficiency * 28
    if (agent.energy > 0 && agent.age < lifespan) survivors.push(agent)
    else { state.deaths++; state.totalDeaths++ }
  }
  state.agents = [...survivors, ...offspring]
  state.food = state.food.filter((food) => food.energy > 0.015)
  state.resourceAccumulator += state.resourceRate * step * 5
  if (state.food.length >= 150) state.resourceAccumulator = Math.min(state.resourceAccumulator, 1)
  while (state.resourceAccumulator >= 1 && state.food.length < 150) {
    state.resourceAccumulator--
    addGardenFood(state, randomStep(state) * state.width, randomStep(state) * state.height, 0.45 + randomStep(state) * 0.45)
  }
  state.tick++
  if (state.births) state.generation = Math.max(state.generation, ...state.agents.map((agent) => agent.generation))
  if (state.tick % 8 === 0) {
    state.history.push({ population: state.agents.length, meanEfficiency: meanGardenTrait(state, 'efficiency'), resources: state.food.reduce((sum, food) => sum + food.energy, 0) })
    if (state.history.length > 120) state.history.shift()
  }
}
