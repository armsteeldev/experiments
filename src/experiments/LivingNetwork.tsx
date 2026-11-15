import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { ActionRow, ControlPanel, RangeControl, SelectControl } from '../components/Controls'
import type { ExperimentControls } from '../types'
import { averageDeliveredLatency, createNetworkState, sendPacket, setLinkActive, shortestRoute, stepNetwork } from '../simulations/network'
import type { NetworkLink, NetworkNode, NetworkState } from '../simulations/network'
import { clamp, normalizedPointer, resizeCanvas, safeState } from './invisibleWorld'
import './invisible-world.css'

type Tool = 'move' | 'cut' | 'connect'
type NetworkStats = { delivered: number; dropped: number; inFlight: number; latency: number; tick: number }

function seedNetwork(): NetworkState {
  const state = createNetworkState()
  sendPacket(state, 'origin', 'arrival', 2, 'hello')
  stepNetwork(state)
  return state
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, length2 = dx * dx + dy * dy
  const t = length2 ? clamp(((px - ax) * dx + (py - ay) * dy) / length2, 0, 1) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function linkNodePair(link: NetworkLink, nodes: NetworkNode[]) {
  return [nodes.find((node) => node.id === link.a), nodes.find((node) => node.id === link.b)] as [NetworkNode | undefined, NetworkNode | undefined]
}

export default function LivingNetwork({ paused, controlsVisible, stateFromUrl, onShareState, onCloseControls }: ExperimentControls) {
  const canvasRef = useRef<HTMLCanvasElement>(null), networkRef = useRef<NetworkState | null>(null), sizeRef = useRef({ width: 1, height: 1, dpr: 1 })
  if (!networkRef.current) networkRef.current = seedNetwork()
  const dragNode = useRef<string | null>(null), connectFrom = useRef<string | null>(null)
  const [tool, setTool] = useState<Tool>('move'), [source, setSource] = useState('origin'), [destination, setDestination] = useState('arrival')
  const [message, setMessage] = useState('a small idea'), [selectedLinkId, setSelectedLinkId] = useState<string | null>(null)
  const [selectedPacketId, setSelectedPacketId] = useState('p2'), [stats, setStats] = useState<NetworkStats>({ delivered: 0, dropped: 0, inFlight: 2, latency: 0, tick: 1 })
  const [linkRevision, setLinkRevision] = useState(0), [connectHint, setConnectHint] = useState('Choose a connection or send a message')
  const restored = useRef(false)
  const state = networkRef.current!
  const selectedLink = state.links.find((link) => link.id === selectedLinkId)
  const selectedPacket = state.packets.find((packet) => packet.id === selectedPacketId)
  const shortest = shortestRoute(state, source, destination)

  useEffect(() => {
    if (!stateFromUrl || restored.current) return
    restored.current = true
    const savedSource = safeState(stateFromUrl, 'source', source), savedDestination = safeState(stateFromUrl, 'destination', destination)
    if (typeof savedSource === 'string' && state.nodes.some((node) => node.id === savedSource)) setSource(savedSource)
    if (typeof savedDestination === 'string' && state.nodes.some((node) => node.id === savedDestination)) setDestination(savedDestination)
  }, [stateFromUrl, source, destination, state.nodes])
  useEffect(() => { onShareState({ source, destination, message }) }, [source, destination, message, onShareState])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const resize = () => { sizeRef.current = resizeCanvas(canvas, 1.4) }
    const observer = new ResizeObserver(resize); observer.observe(canvas); resize()
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current, context = canvas?.getContext('2d', { alpha: false })
    if (!canvas || !context) return
    let animation = 0, stepTimer = 0, statsTimer = 0, disposed = false
    const render = () => {
      if (disposed) return
      const { width, height, dpr } = sizeRef.current
      const sim = networkRef.current!
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.fillStyle = '#080d17'; context.fillRect(0, 0, width, height)
      const depth = context.createRadialGradient(width * 0.51, height * 0.48, height * 0.05, width * 0.51, height * 0.48, height * 0.82)
      depth.addColorStop(0, 'rgba(35,65,91,.2)'); depth.addColorStop(0.55, 'rgba(15,31,51,.12)'); depth.addColorStop(1, 'rgba(5,11,20,0)')
      context.fillStyle = depth; context.fillRect(0, 0, width, height)
      context.strokeStyle = 'rgba(112,154,187,.09)'; context.lineWidth = 0.5
      for (let x = 0; x < width; x += 48) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke() }
      for (let y = 0; y < height; y += 48) { context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke() }

      const routeIds = selectedPacket?.route ?? shortest ?? []
      for (const link of sim.links) {
        const [a, b] = linkNodePair(link, sim.nodes)
        if (!a || !b) continue
        const ax = a.x * width, ay = a.y * height, bx = b.x * width, by = b.y * height
        const onRoute = routeIds.includes(link.a) && routeIds.includes(link.b) && Math.abs(routeIds.indexOf(link.a) - routeIds.indexOf(link.b)) === 1
        const congestion = link.queue.length / Math.max(1, link.capacity)
        context.beginPath(); context.moveTo(ax, ay); context.lineTo(bx, by)
        context.lineWidth = selectedLinkId === link.id ? 3 : 1.3 + congestion * 2.8
        context.strokeStyle = !link.active ? 'rgba(119,131,149,.2)' : congestion > 0.55 ? `rgba(255,126,108,${0.38 + congestion * 0.42})` : onRoute ? 'rgba(106,203,220,.65)' : 'rgba(114,151,177,.22)'
        context.setLineDash(link.active ? [] : [5, 7]); context.stroke(); context.setLineDash([])
        if (link.active) {
          const mx = (ax + bx) / 2, my = (ay + by) / 2
          context.beginPath(); context.arc(mx, my, 2.4, 0, Math.PI * 2); context.fillStyle = congestion > 0.55 ? '#f39c83' : 'rgba(165,203,219,.65)'; context.fill()
          if (selectedLinkId === link.id) {
            context.font = '8px ui-monospace, monospace'; context.fillStyle = '#c2d2dc'; context.fillText(`${link.latency} t · q ${link.queue.length}/${link.capacity}`, mx + 7, my - 8)
          }
          for (const transit of link.transit) {
            const packet = sim.packets.find((candidate) => candidate.id === transit.packetId)
            if (!packet) continue
            const packetIsSelected = packet.id === selectedPacketId
            const startsAtA = packet.current === link.a
            const progress = clamp(1 - transit.remaining / Math.max(1, link.latency), 0, 1)
            const t = startsAtA ? progress : 1 - progress, x = ax + (bx - ax) * t, y = ay + (by - ay) * t
            const color = packetIsSelected ? '#ffdd9e' : packet.status === 'transit' ? '#89e1e6' : '#90bad9'
            const aura = context.createRadialGradient(x, y, 0, x, y, packetIsSelected ? 18 : 12)
            aura.addColorStop(0, packetIsSelected ? 'rgba(255,224,165,.58)' : 'rgba(110,225,232,.42)'); aura.addColorStop(1, 'rgba(84,183,210,0)')
            context.fillStyle = aura; context.fillRect(x - 18, y - 18, 36, 36)
            context.beginPath(); context.arc(x, y, packetIsSelected ? 4.2 : 3.1, 0, Math.PI * 2); context.fillStyle = color; context.fill()
          }
        }
      }
      for (const node of sim.nodes) {
        const x = node.x * width, y = node.y * height, isEndpoint = node.id === source || node.id === destination
        const busy = sim.links.some((link) => (link.a === node.id || link.b === node.id) && link.queue.length > 0)
        const radius = isEndpoint ? 16 : 12.5
        const halo = context.createRadialGradient(x, y, 0, x, y, radius * 3.7)
        halo.addColorStop(0, isEndpoint ? 'rgba(126,208,220,.2)' : 'rgba(111,170,204,.16)'); halo.addColorStop(1, 'rgba(81,152,189,0)')
        context.fillStyle = halo; context.fillRect(x - radius * 4, y - radius * 4, radius * 8, radius * 8)
        context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2)
        context.fillStyle = busy ? 'rgba(28,62,75,.98)' : 'rgba(18,35,51,.96)'; context.fill()
        context.strokeStyle = isEndpoint ? 'rgba(173,228,230,.92)' : 'rgba(138,178,202,.62)'; context.lineWidth = isEndpoint ? 1.5 : 1; context.stroke()
        context.beginPath(); context.arc(x, y, 3, 0, Math.PI * 2); context.fillStyle = busy ? '#ffcc8d' : '#91c6d2'; context.fill()
        context.textAlign = 'center'; context.font = `${isEndpoint ? 11 : 9}px ui-sans-serif, system-ui`; context.fillStyle = isEndpoint ? '#e2eef2' : '#9fb4c2'; context.fillText(node.label, x, y + radius + 17)
      }
      context.textAlign = 'left'
      if (selectedPacket) {
        const pill = `PACKET ${selectedPacket.id} · ${selectedPacket.status.toUpperCase()} · ${selectedPacket.hops} HOPS`
        context.font = '8px ui-monospace, monospace'; context.fillStyle = 'rgba(186,215,222,.76)'; context.fillText(pill, 28, height - 31)
      }
      animation = requestAnimationFrame(render)
    }
    animation = requestAnimationFrame(render)
    stepTimer = window.setInterval(() => { if (!paused) stepNetwork(networkRef.current!) }, 78)
    statsTimer = window.setInterval(() => {
      const sim = networkRef.current!, delivered = sim.packets.filter((packet) => packet.status === 'delivered').length
      const dropped = sim.packets.filter((packet) => packet.status === 'dropped').length
      const inFlight = sim.packets.filter((packet) => ['routing', 'queued', 'transit', 'waiting'].includes(packet.status)).length
      setStats({ delivered, dropped, inFlight, latency: averageDeliveredLatency(sim), tick: sim.tick })
      const selected = sim.packets.find((packet) => packet.id === selectedPacketId)
      if (!selected && sim.packets.length) setSelectedPacketId(sim.packets.at(-1)!.id)
    }, 320)
    return () => { disposed = true; cancelAnimationFrame(animation); clearInterval(stepTimer); clearInterval(statsTimer) }
  }, [paused, source, destination, selectedLinkId, selectedPacketId, selectedPacket])

  const position = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = normalizedPointer(event, event.currentTarget)
    return { x: point.x, y: point.y, width: point.width, height: point.height }
  }
  const pointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = position(event), sim = networkRef.current!
    const node = sim.nodes.find((candidate) => Math.hypot(candidate.x * point.width - point.x * point.width, candidate.y * point.height - point.y * point.height) < 28)
    if (tool === 'connect' && node) {
      if (!connectFrom.current) { connectFrom.current = node.id; setConnectHint(`Now choose a second node from ${node.label}`) }
      else if (connectFrom.current !== node.id) {
        const exists = sim.links.some((link) => (link.a === connectFrom.current && link.b === node.id) || (link.b === connectFrom.current && link.a === node.id))
        if (!exists) sim.links.push({ id: `custom-${sim.nextPacket}-${sim.links.length}`, a: connectFrom.current, b: node.id, latency: 3, bandwidth: 2, capacity: 5, active: true, queue: [], transit: [], dropped: 0 })
        setConnectHint(exists ? 'That connection is already present' : 'New link · 3 ticks · two packets per tick')
        connectFrom.current = null
      }
      return
    }
    if (tool === 'move' && node) { dragNode.current = node.id; event.currentTarget.setPointerCapture(event.pointerId); return }
    if (tool === 'cut') {
      const hit = sim.links.find((link) => {
        const [a, b] = linkNodePair(link, sim.nodes)
        return a && b && distanceToSegment(point.x * point.width, point.y * point.height, a.x * point.width, a.y * point.height, b.x * point.width, b.y * point.height) < 13
      })
      if (hit) { setLinkActive(sim, hit.id, !hit.active); setSelectedLinkId(hit.id); setConnectHint(hit.active ? 'Connection failed · packets choose another route' : 'Connection restored') }
      return
    }
    const link = sim.links.find((candidate) => {
      const [a, b] = linkNodePair(candidate, sim.nodes)
      return a && b && distanceToSegment(point.x * point.width, point.y * point.height, a.x * point.width, a.y * point.height, b.x * point.width, b.y * point.height) < 12
    })
    if (link) { setSelectedLinkId(link.id); setConnectHint(`${link.active ? 'Active' : 'Failed'} link · ${link.latency} ticks · queue ${link.queue.length}/${link.capacity}`) }
    if (node) {
      if (node.id === destination) setSelectedPacketId(sim.packets.filter((packet) => packet.destination === node.id).at(-1)?.id ?? selectedPacketId)
      else setSelectedPacketId(sim.packets.filter((packet) => packet.current === node.id || packet.route.includes(node.id)).at(-1)?.id ?? selectedPacketId)
    }
  }
  const pointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!dragNode.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    const point = position(event), node = networkRef.current!.nodes.find((candidate) => candidate.id === dragNode.current)
    if (node) { node.x = clamp(point.x, 0.075, 0.925); node.y = clamp(point.y, 0.14, 0.83) }
  }
  const pointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => { dragNode.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }
  const send = (count = 1) => {
    const packets = sendPacket(networkRef.current!, source, destination, count, message)
    if (packets.length) { setSelectedPacketId(packets.at(-1)!.id); networkRef.current!.selectedPacket = packets.at(-1)!.id; setConnectHint(`Sent “${message.slice(0, 22)}” · route selected`) }
  }
  const canvasKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault(); event.stopPropagation(); send(1)
  }
  const reset = () => { networkRef.current = seedNetwork(); setSelectedPacketId('p2'); setSelectedLinkId(null); connectFrom.current = null; setConnectHint('Choose a connection or send a message') }
  const setLinkProperty = (key: 'latency' | 'bandwidth' | 'capacity', value: number) => { if (!selectedLink) return; selectedLink[key] = value; setLinkRevision((revision) => revision + 1) }
  void linkRevision
  const nodeOptions = networkRef.current!.nodes.map((node) => [node.id, node.label] as [string, string])
  const routeText = shortest?.join('  →  ') ?? 'No path · message waits for a connection'

  return <section className="iw-scene iw-network" aria-label="Interactive packet-routing network">
    <canvas ref={canvasRef} className="iw-canvas iw-network-canvas" tabIndex={0} aria-label="Network graph. Drag nodes to rearrange, click links to inspect, use Fail link or Add link. Focus the canvas and press Enter to send the current message." onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onKeyDown={canvasKeyDown} />
    <div className="iw-titleplate"><span>18 · INFORMATION STUDY</span><strong>The Living Network</strong><small>A message finds its way through.</small></div>
    <div className="iw-network-tools iw-glass-surface" role="group" aria-label="Network editing tools">{(['move', 'cut', 'connect'] as Tool[]).map((value) => <button key={value} className={tool === value ? 'is-selected' : ''} onClick={() => { setTool(value); connectFrom.current = null; setConnectHint(value === 'connect' ? 'Choose two nodes to add a connection' : 'Choose a connection or send a message') }} aria-pressed={tool === value}>{value === 'move' ? 'Move / inspect' : value === 'cut' ? 'Fail link' : 'Add link'}</button>)}</div>
    <div className="iw-network-stats iw-glass-surface" aria-live="polite"><span>NETWORK PULSE · TICK {stats.tick}</span><strong>{stats.inFlight} <small>IN FLIGHT</small></strong><div>{stats.delivered} delivered <i>·</i> {stats.dropped} dropped <i>·</i> {stats.latency.toFixed(1)} ticks mean</div></div>
    <div className="iw-network-route iw-glass-surface"><span>{connectHint}</span><small>{routeText}</small></div>
    <ControlPanel title="Network study" note="Queue-aware Dijkstra" visible={controlsVisible} onClose={onCloseControls} footer={<span>Packets recalculate at each hop. Links use ticks, queues and per-tick capacity.</span>}>
      <SelectControl label="From" value={source} options={nodeOptions} onChange={setSource} />
      <SelectControl label="To" value={destination} options={nodeOptions.filter(([id]) => id !== source)} onChange={setDestination} />
      <label className="iw-message-input"><span>Message payload</span><input maxLength={48} value={message} onChange={(event) => setMessage(event.target.value)} aria-label="Message text carried in packets" /></label>
      <ActionRow><button className="panel-action" onClick={() => send(1)}>Send a message <i>↗</i></button><button className="panel-action" onClick={() => send(5)}>Send a burst <i>»</i></button></ActionRow>
      <div className="iw-route-card"><span>SHORTEST CURRENT ROUTE</span><strong>{routeText}</strong><small>Current estimated cost {shortest?.slice(1).reduce((sum, id, index) => { const a = shortest[index]; const link = networkRef.current!.links.find((item) => item.active && ((item.a === a && item.b === id) || (item.b === a && item.a === id))); return sum + (link?.latency ?? 0) + (link?.queue.length ?? 0) * (1.2 + 2 / Math.max(1, link?.bandwidth ?? 1)) }, 0).toFixed(1) ?? '—'} ticks</small></div>
      {selectedLink && <div className="iw-panel-section" key={selectedLink.id}><span>Selected link · {selectedLink.id}</span>
        <RangeControl label="Latency" value={selectedLink.latency} min={1} max={12} step={1} format={(value) => `${value} ticks`} onChange={(value) => setLinkProperty('latency', value)} />
        <RangeControl label="Bandwidth" value={selectedLink.bandwidth} min={1} max={5} step={1} format={(value) => `${value} packets / tick`} onChange={(value) => setLinkProperty('bandwidth', value)} />
        <RangeControl label="Queue capacity" value={selectedLink.capacity} min={1} max={12} step={1} format={(value) => `${value} packets`} onChange={(value) => setLinkProperty('capacity', value)} />
        <button className="panel-action" onClick={() => { setLinkActive(networkRef.current!, selectedLink.id, !selectedLink.active); setConnectHint(selectedLink.active ? 'Connection failed · routes are recomputed at the next hop' : 'Connection restored') }}>{selectedLink.active ? 'Fail this connection' : 'Restore this connection'}</button>
      </div>}
      <p className="control-note">This discrete-time teaching model has directed packet progress over undirected links, fixed integer latency, bounded queues and per-tick bandwidth. It is not a simulation of TCP/IP or the public Internet.</p>
      <ActionRow><button className="panel-action" onClick={() => stepNetwork(networkRef.current!)}>Step network once</button><button className="panel-action" onClick={reset}>Reset network <i>↺</i></button></ActionRow>
      {selectedPacket && <div className="iw-trait-readout"><span>Selected packet · {selectedPacket.id}</span><div><i>STATUS</i><b>{selectedPacket.status}</b><i>HOPS</i><b>{selectedPacket.hops}</b></div><small>“{selectedPacket.payload}” · {selectedPacket.route.join(' → ')}</small></div>}
    </ControlPanel>
  </section>
}
