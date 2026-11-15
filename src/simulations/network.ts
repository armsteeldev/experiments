export type NetworkNode = { id: string; x: number; y: number; label: string }
export type NetworkLink = { id: string; a: string; b: string; latency: number; bandwidth: number; capacity: number; active: boolean; queue: string[]; transit: { packetId: string; remaining: number }[]; dropped: number }
export type NetworkPacket = { id: string; source: string; destination: string; payload: string; current: string; route: string[]; status: 'routing' | 'queued' | 'transit' | 'delivered' | 'dropped' | 'waiting'; created: number; deliveredAt?: number; hops: number }
export type NetworkState = { nodes: NetworkNode[]; links: NetworkLink[]; packets: NetworkPacket[]; tick: number; nextPacket: number; selectedPacket: string | null; maxPackets: number }

export function createNetworkState(): NetworkState {
  const nodes: NetworkNode[] = [
    { id: 'origin', x: 0.13, y: 0.5, label: 'Origin' }, { id: 'north', x: 0.35, y: 0.2, label: 'North' }, { id: 'west', x: 0.35, y: 0.79, label: 'West' },
    { id: 'relay', x: 0.56, y: 0.48, label: 'Relay' }, { id: 'east', x: 0.76, y: 0.2, label: 'East' }, { id: 'south', x: 0.75, y: 0.78, label: 'South' }, { id: 'arrival', x: 0.9, y: 0.5, label: 'Arrival' },
  ]
  const edge = (id: string, a: string, b: string, latency: number, bandwidth = 2, capacity = 5): NetworkLink => ({ id, a, b, latency, bandwidth, capacity, active: true, queue: [], transit: [], dropped: 0 })
  return { nodes, links: [edge('on', 'origin', 'north', 3), edge('ow', 'origin', 'west', 4), edge('nr', 'north', 'relay', 3), edge('wr', 'west', 'relay', 4), edge('re', 'relay', 'east', 7), edge('rs', 'relay', 'south', 3), edge('ea', 'east', 'arrival', 4), edge('sa', 'south', 'arrival', 4), edge('ns', 'north', 'south', 9, 1, 4)], packets: [], tick: 0, nextPacket: 1, selectedPacket: null, maxPackets: 120 }
}

function linkFrom(state: NetworkState, node: string, next: string): NetworkLink | undefined {
  return state.links.find((link) => link.active && ((link.a === node && link.b === next) || (link.b === node && link.a === next)))
}

export function shortestRoute(state: NetworkState, source: string, destination: string): string[] | null {
  if (!state.nodes.some((node) => node.id === source) || !state.nodes.some((node) => node.id === destination)) return null
  const distance = new Map(state.nodes.map((node) => [node.id, Infinity])), previous = new Map<string, string>(), visited = new Set<string>()
  distance.set(source, 0)
  while (visited.size < state.nodes.length) {
    let current: string | null = null, best = Infinity
    for (const node of state.nodes) if (!visited.has(node.id) && distance.get(node.id)! < best) { current = node.id; best = distance.get(node.id)! }
    if (!current || best === Infinity || current === destination) break
    visited.add(current)
    for (const link of state.links) {
      if (!link.active || (link.a !== current && link.b !== current)) continue
      const next = link.a === current ? link.b : link.a
      const cost = link.latency + link.queue.length * (1.2 + 2 / Math.max(1, link.bandwidth))
      const candidate = best + cost
      if (candidate < distance.get(next)!) { distance.set(next, candidate); previous.set(next, current) }
    }
  }
  if (distance.get(destination) === Infinity) return null
  const route = [destination]
  while (route[0] !== source) {
    const parent = previous.get(route[0])
    if (!parent) return null
    route.unshift(parent)
  }
  return route
}

export function sendPacket(state: NetworkState, source: string, destination: string, count = 1, payload = 'signal'): NetworkPacket[] {
  const packets: NetworkPacket[] = []
  for (let i = 0; i < Math.min(12, Math.max(1, count)); i++) {
    if (state.packets.filter((packet) => !['delivered', 'dropped'].includes(packet.status)).length >= state.maxPackets) break
    const packet: NetworkPacket = { id: `p${state.nextPacket++}`, source, destination, payload: payload.slice(0, 48), current: source, route: [source], status: 'routing', created: state.tick, hops: 0 }
    state.packets.push(packet); packets.push(packet); state.selectedPacket = packet.id
  }
  return packets
}

export function setLinkActive(state: NetworkState, id: string, active: boolean): void {
  const link = state.links.find((candidate) => candidate.id === id)
  if (link) link.active = active
}

export function stepNetwork(state: NetworkState): void {
  state.tick++
  for (const link of state.links) {
    if (!link.active && link.queue.length) {
      const queued = new Set(link.queue)
      for (const packet of state.packets) if (queued.has(packet.id)) packet.status = 'routing'
      link.queue.length = 0
    }
    for (let i = link.transit.length - 1; i >= 0; i--) {
      link.transit[i].remaining--
      if (link.transit[i].remaining > 0) continue
      const [{ packetId }] = link.transit.splice(i, 1)
      const packet = state.packets.find((candidate) => candidate.id === packetId)
      if (!packet || packet.status === 'dropped' || packet.status === 'delivered') continue
      packet.current = packet.current === link.a ? link.b : link.a
      packet.route.push(packet.current); packet.hops++; packet.status = packet.current === packet.destination ? 'delivered' : 'routing'
      if (packet.status === 'delivered') packet.deliveredAt = state.tick
    }
  }
  for (const packet of state.packets) {
    if (packet.status !== 'routing' && packet.status !== 'waiting') continue
    if (packet.current === packet.destination) { packet.status = 'delivered'; packet.deliveredAt ??= state.tick; continue }
    const route = shortestRoute(state, packet.current, packet.destination)
    if (!route || route.length < 2) { packet.status = 'waiting'; continue }
    const link = linkFrom(state, route[0], route[1])
    if (!link) { packet.status = 'waiting'; continue }
    if (link.queue.length >= link.capacity) {
      packet.status = 'dropped'; link.dropped++
      continue
    }
    link.queue.push(packet.id); packet.status = 'queued'
  }
  for (const link of state.links) {
    if (!link.active) continue
    const budget = Math.max(1, Math.floor(link.bandwidth))
    for (let sent = 0; sent < budget && link.queue.length; sent++) {
      const packetId = link.queue.shift()!
      const packet = state.packets.find((candidate) => candidate.id === packetId)
      if (!packet || packet.status !== 'queued') continue
      packet.status = 'transit'
      link.transit.push({ packetId, remaining: Math.max(1, Math.ceil(link.latency)) })
    }
  }
  if (state.packets.length > state.maxPackets * 2) state.packets = state.packets.filter((packet) => !['delivered', 'dropped'].includes(packet.status) || state.tick - (packet.deliveredAt ?? packet.created) < 500).slice(-state.maxPackets * 2)
}

export function averageDeliveredLatency(state: NetworkState): number {
  const delivered = state.packets.filter((packet) => packet.status === 'delivered' && packet.deliveredAt !== undefined)
  return delivered.length ? delivered.reduce((sum, packet) => sum + packet.deliveredAt! - packet.created, 0) / delivered.length : 0
}
