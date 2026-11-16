import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { ExperimentControls } from '../types'
import { boundedStateSeed } from '../lib/experimentState'
import { MAX_SHARED_NEURAL_SAMPLES, restoreNeuralSamples } from '../lib/neuralState'
import { ControlPanel, RangeControl, SelectControl } from '../components/Controls'
import { accuracy, createNetwork, forwardNetwork, trainNetworkStep, type Activation, type NeuralNetwork, type Sample } from '../simulations/neural'
import './ComputingRethink.css'

type DatasetName = 'xor' | 'circle' | 'diagonal' | 'custom'
type Tool = 'draw' | 'erase' | 'probe'
type Plot = { x: number; y: number; w: number; h: number }

const datasets: [DatasetName, string][] = [['xor', 'Opposite corners'], ['circle', 'Inside the ring'], ['diagonal', 'Across a diagonal'], ['custom', 'My own examples']]
const hiddenSizes = [3, 4, 5, 6, 8]
const colors = { zero: '#f0a07e', one: '#71d4c0', pale: '#ece8d8' }
const outputValue = (value: number, activation: Activation) => activation === 'tanh' ? (value + 1) / 2 : activation === 'relu' ? value / (1 + value) : value

function makeDataset(kind: Exclude<DatasetName, 'custom'>, count = 48): Sample[] {
  let seed = kind === 'xor' ? 801 : kind === 'circle' ? 517 : kind === 'diagonal' ? 227 : 913
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  return Array.from({ length: count }, () => {
    const x = random() * 2 - 1, y = random() * 2 - 1
    const label = kind === 'xor' ? Number(x * y > 0) : kind === 'circle' ? Number(x * x + y * y < .48) : Number(x + y > .08)
    return { x: [x, y], y: label }
  })
}

function lossFor(network: NeuralNetwork, samples: readonly Sample[], activation: Activation) {
  return samples.reduce((sum, sample) => {
    const output = forwardNetwork(network, sample.x, activation).output[0]
    const target = activation === 'tanh' ? sample.y * 2 - 1 : sample.y
    return sum + .5 * (output - target) ** 2
  }, 0) / Math.max(1, samples.length)
}

function graphPlot(width: number, height: number): Plot {
  const mobile = width < 720
  return mobile
    ? { x: 16, y: Math.max(132, height * .2), w: width - 32, h: Math.max(210, height * .55) }
    : { x: 44, y: 154, w: width - 88, h: Math.max(280, height - 294) }
}

function NetworkInspector({ network, input, activation, onClose }: { network: NeuralNetwork; input: number[]; activation: Activation; onClose: () => void }) {
  const [selectedWeight, setSelectedWeight] = useState<{ layer: number; from: number; to: number } | null>(null)
  const state = forwardNetwork(network, input, activation)
  const selectedWeightValue = selectedWeight ? network.layers[selectedWeight.layer]?.weights[selectedWeight.to]?.[selectedWeight.from] ?? null : null
  const width = 520, height = 300, gutter = 62
  const xs = network.sizes.map((_, layer) => gutter + layer * ((width - gutter * 2) / (network.sizes.length - 1)))
  const points = network.sizes.map((size, layer) => Array.from({ length: size }, (_, index) => ({ x: xs[layer], y: 54 + (index + 1) * 202 / (size + 1) })))
  return <aside className="neural-network-inspector" aria-label="Inspect the neural network">
    <header><div><span>UNDER THE SURFACE</span><strong>One small network</strong></div><button onClick={onClose} aria-label="Close network inspection">×</button></header>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Network with layer sizes ${network.sizes.join(', ')}`}>
      {network.layers.map((layer, layerIndex) => layer.weights.map((weights, to) => weights.map((weight, from) => {
        const start = points[layerIndex][from], end = points[layerIndex + 1][to]
        const selected = selectedWeight?.layer === layerIndex && selectedWeight.from === from && selectedWeight.to === to
        const select = () => setSelectedWeight({ layer: layerIndex, from, to })
        return <g key={`${layerIndex}-${to}-${from}`} className={`weight-inspection${selected ? ' weight-selected' : ''}`} tabIndex={0} role="button" aria-pressed={selected} aria-label={`Inspect weight from neuron ${from + 1} in layer ${layerIndex + 1} to neuron ${to + 1} in layer ${layerIndex + 2}: ${weight.toFixed(3)}`} onClick={select} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select() } }}>
          <title>{`Weight ${weight.toFixed(3)}`}</title><path className="weight-visible" d={`M${start.x} ${start.y} L${end.x} ${end.y}`} stroke={weight >= 0 ? colors.one : colors.zero} strokeOpacity={Math.min(.86, .24 + Math.abs(weight) * .34)} strokeWidth={Math.min(4, .75 + Math.abs(weight) * .8)} /><path className="weight-hitbox" d={`M${start.x} ${start.y} L${end.x} ${end.y}`} />
        </g>
      })))}
      {points.map((layer, layerIndex) => layer.map((point, neuron) => {
        const value = state.activations[layerIndex][neuron], norm = layerIndex === 0 ? (value + 1) / 2 : outputValue(value, activation)
        return <g key={`${layerIndex}-${neuron}`} className="neuron-inspection"><circle cx={point.x} cy={point.y} r={layerIndex === 0 ? 14 : 11} /><circle className="neuron-activation" cx={point.x} cy={point.y} r={Math.max(2, (layerIndex === 0 ? 10 : 7) * norm)} /><text x={point.x} y={point.y + 27} textAnchor="middle">{layerIndex === 0 ? `x${neuron + 1}` : value.toFixed(2)}</text></g>
      }))}
      {network.sizes.map((size, index) => <text key={index} className="network-layer-label" x={xs[index]} y="24" textAnchor="middle">{index === 0 ? 'INPUT' : index === network.sizes.length - 1 ? 'GUESS' : `${size} NEURONS`}</text>)}
    </svg>
    <p>{selectedWeight && selectedWeightValue !== null ? `Layer ${selectedWeight.layer + 1}: neuron ${selectedWeight.from + 1} → neuron ${selectedWeight.to + 1} · weight ${selectedWeightValue.toFixed(3)}.` : 'Select a connection to inspect its exact weight.'} Teal lines are positive; coral lines are negative.</p>
    <small>Current input · {input[0].toFixed(2)}, {input[1].toFixed(2)} <i>→</i> {outputValue(state.output[0], activation).toFixed(3)}</small>
  </aside>
}

export default function NeuralNetworks({ paused, controlsVisible, stateFromUrl, onShareState, onCloseControls }: ExperimentControls) {
  const initialDataset = datasets.some(([key]) => key === stateFromUrl?.dataset) ? stateFromUrl?.dataset as DatasetName : 'xor'
  const [dataset, setDataset] = useState<DatasetName>(initialDataset)
  const [samples, setSamples] = useState<Sample[]>(() => initialDataset === 'custom'
    ? restoreNeuralSamples(stateFromUrl?.examples) ?? []
    : makeDataset(initialDataset))
  const [hidden, setHidden] = useState(() => hiddenSizes.includes(Number(stateFromUrl?.hidden)) ? Number(stateFromUrl?.hidden) : 5)
  const [depth, setDepth] = useState(() => [1, 2].includes(Number(stateFromUrl?.depth)) ? Number(stateFromUrl?.depth) : 1)
  const [activation, setActivation] = useState<Activation>(() => ['tanh', 'sigmoid', 'relu'].includes(String(stateFromUrl?.activation)) ? stateFromUrl?.activation as Activation : 'tanh')
  const [rate, setRate] = useState(() => Number.isFinite(Number(stateFromUrl?.rate)) && Number(stateFromUrl?.rate) >= .01 && Number(stateFromUrl?.rate) <= .22 ? Number(stateFromUrl?.rate) : .08)
  const [tool, setTool] = useState<Tool>('draw')
  const [classToAdd, setClassToAdd] = useState<0 | 1>(1)
  const [training, setTraining] = useState(false)
  const [input, setInput] = useState<[number, number]>([.38, -.24])
  const [note, setNote] = useState('Tap the map to place a teal example. Drag any dot to move it.')
  const [metrics, setMetrics] = useState({ loss: 0, accuracy: 0 })
  const [networkVersion, setNetworkVersion] = useState(0)
  const [dataVersion, setDataVersion] = useState(0)
  const [undoCount, setUndoCount] = useState(0)
  const [networkOpen, setNetworkOpen] = useState(false)
  const [weightSeed, setWeightSeed] = useState(() => boundedStateSeed(stateFromUrl?.weightSeed, 1))
  const [keyboardPoint, setKeyboardPoint] = useState<[number, number]>([0, 0])
  const [mapFocused, setMapFocused] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [network, setNetwork] = useState(() => createNetwork([2, hidden, 1], weightSeed))
  const samplesRef = useRef(samples)
  samplesRef.current = samples
  const trainingRef = useRef(false)
  const undoStack = useRef<Sample[][]>([])
  const dragIndex = useRef<number | null>(null)
  const dragRecorded = useRef(false)
  const lastDragPaint = useRef(0)
  const drawFrame = useRef<number | null>(null)

  const prediction = outputValue(forwardNetwork(network, input, activation).output[0], activation)
  const correct = accuracy(network, samples, activation)
  const classCounts = [samples.filter((sample) => sample.y === 0).length, samples.filter((sample) => sample.y === 1).length]

  const updateStats = (targetSamples = samplesRef.current, targetActivation = activation) => {
    setMetrics({ loss: lossFor(network, targetSamples, targetActivation), accuracy: accuracy(network, targetSamples, targetActivation) })
  }
  const haltTraining = () => { trainingRef.current = false; setTraining(false) }
  const pushUndo = () => {
    undoStack.current = [...undoStack.current, samplesRef.current.map((sample) => ({ x: [...sample.x], y: sample.y }))].slice(-40)
    setUndoCount(undoStack.current.length)
  }
  const setExamples = (next: Sample[], message: string, updateMap = true) => {
    trainingRef.current = false; setTraining(false)
    samplesRef.current = next; setSamples(next); setDataset('custom'); setNote(message)
    setMetrics({ loss: lossFor(network, next, activation), accuracy: accuracy(network, next, activation) })
    if (updateMap) setDataVersion((version) => version + 1)
  }
  const resetWeights = (nextHidden = hidden, nextDepth = depth, nextActivation = activation) => {
    haltTraining()
    const nextSeed = ((weightSeed + 1) >>> 0) || 1
    setWeightSeed(nextSeed)
    const nextNetwork = createNetwork([2, ...Array(nextDepth).fill(nextHidden), 1], nextSeed)
    setNetwork(nextNetwork)
    setNetworkVersion((version) => version + 1)
    setMetrics({ loss: lossFor(nextNetwork, samplesRef.current, nextActivation), accuracy: accuracy(nextNetwork, samplesRef.current, nextActivation) })
    setNote('Fresh weights. The map shows the new network’s actual first guesses.')
  }

  useEffect(() => {
    onShareState({
      dataset, hidden, depth, activation, rate, weightSeed,
      ...(dataset === 'custom' ? { examples: samples.map((sample) => ({ x: [...sample.x], y: sample.y })) } : {}),
    })
  }, [dataset, hidden, depth, activation, rate, weightSeed, samples, onShareState])
  useEffect(() => { updateStats() }, [])
  useEffect(() => {
    if (!training || paused || samplesRef.current.length === 0) { trainingRef.current = false; return }
    trainingRef.current = true
    const timer = window.setInterval(() => {
      if (!trainingRef.current || document.hidden) return
      const currentSamples = samplesRef.current
      const nextLoss = trainNetworkStep(network, currentSamples, activation, rate)
      setMetrics({ loss: nextLoss, accuracy: accuracy(network, currentSamples, activation) })
      setNetworkVersion((version) => version + 1)
    }, 80)
    return () => { window.clearInterval(timer); if (paused || samplesRef.current.length === 0) trainingRef.current = false }
  }, [training, paused, activation, rate])

  useEffect(() => {
    const canvas = canvasRef.current, ctx = canvas?.getContext('2d', { alpha: false })
    if (!canvas || !ctx) return
    let width = 0, height = 0, dpr = 1
    const draw = () => {
      drawFrame.current = null
      const rect = canvas.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      width = rect.width; height = rect.height
      dpr = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(2_000_000 / (width * height)))
      if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) { canvas.width = Math.floor(width * dpr); canvas.height = Math.floor(height * dpr) }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#071019'; ctx.fillRect(0, 0, width, height)
      const plot = graphPlot(width, height), countX = width < 720 ? 34 : 58, countY = width < 720 ? 28 : 40
      const cellW = plot.w / countX, cellH = plot.h / countY
      ctx.fillStyle = '#091922'; ctx.fillRect(plot.x, plot.y, plot.w, plot.h)
      for (let row = 0; row < countY; row++) for (let column = 0; column < countX; column++) {
        const x = (column + .5) / countX * 2 - 1, y = 1 - (row + .5) / countY * 2
        const value = outputValue(forwardNetwork(network, [x, y], activation).output[0], activation)
        const confidence = Math.min(1, Math.abs(value - .5) * 2)
        ctx.fillStyle = value >= .5 ? `rgba(81,205,177,${.035 + confidence * .27})` : `rgba(230,133,105,${.035 + confidence * .25})`
        ctx.fillRect(plot.x + column * cellW, plot.y + row * cellH, cellW + .6, cellH + .6)
      }
      ctx.save(); ctx.beginPath(); ctx.rect(plot.x, plot.y, plot.w, plot.h); ctx.clip()
      for (const sample of samplesRef.current) {
        const x = plot.x + (sample.x[0] + 1) * plot.w / 2, y = plot.y + (1 - sample.x[1]) * plot.h / 2
        const guess = outputValue(forwardNetwork(network, sample.x, activation).output[0], activation) >= .5 ? 1 : 0
        ctx.beginPath(); ctx.arc(x, y, width < 720 ? 5 : 6, 0, Math.PI * 2); ctx.fillStyle = sample.y ? colors.one : colors.zero; ctx.fill()
        ctx.lineWidth = guess === sample.y ? 1 : 2; ctx.strokeStyle = guess === sample.y ? 'rgba(4,14,18,.92)' : '#f1e9d5'; ctx.stroke()
        if (guess !== sample.y) { ctx.beginPath(); ctx.arc(x, y, width < 720 ? 8 : 10, 0, Math.PI * 2); ctx.strokeStyle = '#f1e9d5'; ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.stroke(); ctx.setLineDash([]) }
      }
      const px = plot.x + (input[0] + 1) * plot.w / 2, py = plot.y + (1 - input[1]) * plot.h / 2
      const guessColor = prediction >= .5 ? colors.one : colors.zero
      ctx.beginPath(); ctx.arc(px, py, width < 720 ? 10 : 13, 0, Math.PI * 2); ctx.strokeStyle = colors.pale; ctx.lineWidth = 1.5; ctx.stroke()
      ctx.beginPath(); ctx.arc(px, py, width < 720 ? 4 : 5, 0, Math.PI * 2); ctx.fillStyle = guessColor; ctx.fill()
      if (mapFocused) {
        const kx = plot.x + (keyboardPoint[0] + 1) * plot.w / 2, ky = plot.y + (1 - keyboardPoint[1]) * plot.h / 2
        ctx.beginPath(); ctx.arc(kx, ky, width < 720 ? 11 : 14, 0, Math.PI * 2); ctx.strokeStyle = '#f3e9ba'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([])
        ctx.beginPath(); ctx.moveTo(kx - 16, ky); ctx.lineTo(kx + 16, ky); ctx.moveTo(kx, ky - 16); ctx.lineTo(kx, ky + 16); ctx.strokeStyle = '#f3e9ba'; ctx.lineWidth = 1; ctx.stroke()
      }
      ctx.restore()
      ctx.strokeStyle = 'rgba(196,222,221,.29)'; ctx.lineWidth = 1; ctx.strokeRect(plot.x, plot.y, plot.w, plot.h)
      ctx.strokeStyle = 'rgba(199,224,223,.17)'; ctx.setLineDash([3, 8]); ctx.beginPath(); ctx.moveTo(plot.x + plot.w / 2, plot.y); ctx.lineTo(plot.x + plot.w / 2, plot.y + plot.h); ctx.moveTo(plot.x, plot.y + plot.h / 2); ctx.lineTo(plot.x + plot.w, plot.y + plot.h / 2); ctx.stroke(); ctx.setLineDash([])
      ctx.fillStyle = '#91a9a7'; ctx.font = `${width < 720 ? 10 : 12}px monospace`; ctx.fillText('x₂', plot.x + 10, plot.y + 22); ctx.textAlign = 'right'; ctx.fillText('x₁', plot.x + plot.w - 10, plot.y + plot.h - 12); ctx.textAlign = 'left'
    }
    const scheduleDraw = () => { if (drawFrame.current !== null) cancelAnimationFrame(drawFrame.current); drawFrame.current = requestAnimationFrame(draw) }
    const observer = new ResizeObserver(scheduleDraw); observer.observe(canvas); scheduleDraw()
    return () => { observer.disconnect(); if (drawFrame.current !== null) cancelAnimationFrame(drawFrame.current) }
  }, [networkVersion, dataVersion, input, activation, keyboardPoint, mapFocused])

  const coords = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect(), plot = graphPlot(rect.width, rect.height)
    const x = event.clientX - rect.left, y = event.clientY - rect.top
    if (x < plot.x || x > plot.x + plot.w || y < plot.y || y > plot.y + plot.h) return null
    return [Math.max(-1, Math.min(1, ((x - plot.x) / plot.w) * 2 - 1)), Math.max(-1, Math.min(1, 1 - ((y - plot.y) / plot.h) * 2))] as [number, number]
  }
  const nearestSample = (point: [number, number]) => {
    let nearest = -1, distance = .09
    samplesRef.current.forEach((sample, index) => {
      const next = Math.hypot(sample.x[0] - point[0], sample.x[1] - point[1])
      if (next < distance) { nearest = index; distance = next }
    })
    return nearest
  }
  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = coords(event)
    if (!point) return
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId)
    setMapFocused(false)
    setKeyboardPoint(point)
    if (tool === 'probe') {
      setInput(point); setNote(`The network guesses ${outputValue(forwardNetwork(network, point, activation).output[0], activation) >= .5 ? 'teal' : 'coral'} at this new point. It is not added to the examples.`)
      return
    }
    const near = nearestSample(point)
    if (tool === 'erase') {
      if (near < 0) { setNote('Tap close to a dot to erase that example.'); return }
      pushUndo(); const next = samplesRef.current.filter((_, index) => index !== near)
      setExamples(next, 'Example removed. Undo is ready if you want it back.')
      return
    }
    haltTraining()
    const next = samplesRef.current.map((sample) => ({ x: [...sample.x], y: sample.y }))
    if (near >= 0) { dragIndex.current = near; dragRecorded.current = false; setNote('Move this example. Training pauses while you edit the pattern.') }
    else if (next.length >= MAX_SHARED_NEURAL_SAMPLES) {
      setNote(`This lesson is limited to ${MAX_SHARED_NEURAL_SAMPLES} examples so it stays quick to train and easy to share. Erase one to make room.`)
    } else { pushUndo(); dragIndex.current = next.length; dragRecorded.current = true; next.push({ x: point, y: classToAdd }); setExamples(next, `Added a ${classToAdd === 1 ? 'teal' : 'coral'} example. Drag to place it precisely.`) }
  }
  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!(event.buttons & 1) || dragIndex.current === null || tool !== 'draw') return
    const point = coords(event), now = performance.now()
    if (!point || now - lastDragPaint.current < 70) return
    if (!dragRecorded.current) { pushUndo(); dragRecorded.current = true }
    lastDragPaint.current = now
    const next = samplesRef.current.map((sample, index) => index === dragIndex.current ? { x: point, y: sample.y } : sample)
    setExamples(next, 'Moving an example. The network is paused while its lesson changes.')
  }
  const handlePointerUp = () => { dragIndex.current = null; dragRecorded.current = false; updateStats(); setDataVersion((version) => version + 1) }

  const chooseDataset = (next: DatasetName) => {
    pushUndo(); haltTraining(); dragIndex.current = null; setDataset(next)
    const nextSamples = next === 'custom' ? [] : makeDataset(next)
    samplesRef.current = nextSamples; setSamples(nextSamples)
    const nextSeed = weightSeed + 1; setWeightSeed(nextSeed); const nextNetwork = createNetwork([2, ...Array(depth).fill(hidden), 1], nextSeed); setNetwork(nextNetwork)
    setNetworkVersion((version) => version + 1); setDataVersion((version) => version + 1)
    setMetrics({ loss: lossFor(nextNetwork, nextSamples, activation), accuracy: accuracy(nextNetwork, nextSamples, activation) })
    setTool('draw'); setNote(next === 'custom' ? 'Blank page. Choose a colour and tap to add the first example.' : 'Fresh examples and fresh weights. The map starts with the network’s real guesses.')
  }
  const undo = () => {
    const prior = undoStack.current.pop()
    if (!prior) return
    setUndoCount(undoStack.current.length); dragIndex.current = null; dragRecorded.current = false
    setExamples(prior.map((sample) => ({ x: [...sample.x], y: sample.y })), 'Last example edit undone.')
  }
  const clearExamples = () => {
    pushUndo(); setExamples([], 'The map is clear. Add examples in both colours, then train it.')
  }
  const changeArchitecture = (nextHidden: number, nextDepth: number) => {
    setHidden(nextHidden); setDepth(nextDepth); resetWeights(nextHidden, nextDepth)
  }
  const changeActivation = (next: Activation) => { setActivation(next); resetWeights(hidden, depth, next) }
  const toggleTraining = () => {
    if (training) { haltTraining(); setNote('Training paused. The current weights are kept.') }
    else if (samplesRef.current.length >= 2) { trainingRef.current = true; setTraining(true); setTool('probe'); setNote('Learning from the coloured examples. The boundary is the network’s current prediction.') }
  }
  const useKeyboardTool = () => {
    const point = keyboardPoint
    if (tool === 'probe') {
      setInput(point)
      setNote(`Test point at x ${point[0].toFixed(2)}, y ${point[1].toFixed(2)}. It is not added to the examples.`)
      return
    }
    if (tool === 'erase') {
      const near = nearestSample(point)
      if (near < 0) { setNote(`No example close to x ${point[0].toFixed(2)}, y ${point[1].toFixed(2)}.`); return }
      pushUndo()
      setExamples(samplesRef.current.filter((_, index) => index !== near), `Removed the example at x ${point[0].toFixed(2)}, y ${point[1].toFixed(2)}. Undo is ready.`)
      return
    }
    if (samplesRef.current.length >= MAX_SHARED_NEURAL_SAMPLES) {
      setNote(`This lesson is limited to ${MAX_SHARED_NEURAL_SAMPLES} examples so it stays quick to train and easy to share. Erase one to make room.`)
      return
    }
    haltTraining()
    pushUndo()
    const next = [...samplesRef.current.map((sample) => ({ x: [...sample.x], y: sample.y })), { x: point, y: classToAdd }]
    setExamples(next, `Placed a ${classToAdd === 1 ? 'teal' : 'coral'} example at x ${point[0].toFixed(2)}, y ${point[1].toFixed(2)}.`)
  }
  const handleMapKeyDown = (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault(); setMapFocused(true)
      const step = event.shiftKey ? .1 : .05
      const round = (value: number) => Math.round(Math.max(-1, Math.min(1, value)) * 20) / 20
      const point: [number, number] = [round(keyboardPoint[0] + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0)), round(keyboardPoint[1] + (event.key === 'ArrowDown' ? -step : event.key === 'ArrowUp' ? step : 0))]
      setKeyboardPoint(point)
      setNote(`Keyboard point at x ${point[0].toFixed(2)}, y ${point[1].toFixed(2)}. Press Enter to use the selected tool.`)
    } else if (event.key === 'Home') {
      event.preventDefault(); setMapFocused(true); setKeyboardPoint([0, 0]); setNote('Keyboard point returned to the centre of the map.')
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); setMapFocused(true); useKeyboardTool()
    }
  }

  return <section className={`experiment-surface neural-playground${tool === 'erase' ? ' tool-erasing' : tool === 'probe' ? ' tool-probing' : ''}`} aria-label="Neural Networks, an interactive learning playground">
    <canvas ref={canvasRef} tabIndex={0} className="neural-learning-map" aria-label="Interactive map of the network’s predictions and training examples. Click to add an example, drag a dot to move it, or choose Test a guess. Keyboard: arrows move a point by 0.05, Shift plus arrows move by 0.10, Enter uses the selected tool, and Home returns to the centre." aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Shift+ArrowUp Shift+ArrowDown Shift+ArrowLeft Shift+ArrowRight Enter Space Home" onFocus={() => setMapFocused(true)} onBlur={() => setMapFocused(false)} onKeyDown={handleMapKeyDown} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} />
    <span className="neural-map-keyboard-help" aria-hidden="true">Arrow keys move · Shift moves farther · Enter uses the selected tool · Home centres</span>
    <header className="neural-playground-head">
      <div><span className="neural-kicker"><i /> TEACH A TINY MACHINE</span><h1>Show it a <em>pattern.</em></h1><p>Tap to add an example. Watch the colour map change as it learns.</p></div>
      <div className="neural-score" aria-live="polite"><span>{samples.length} EXAMPLES · {Math.round(correct * samples.length)} GUESSED RIGHT</span><strong>{samples.length ? `${Math.round(correct * 100)}%` : '—'}</strong><small>{samples.length ? `${classCounts[0]} coral · ${classCounts[1]} teal` : 'Add examples to begin'}</small></div>
    </header>

    <div className="neural-patterns" role="group" aria-label="Choose a starter pattern">
      <span>START WITH</span>
      {datasets.slice(0, 3).map(([key, label]) => <button key={key} className={dataset === key ? 'pattern-selected' : ''} onClick={() => chooseDataset(key)} aria-pressed={dataset === key}>{label}</button>)}
      <button className={dataset === 'custom' ? 'pattern-selected' : ''} onClick={() => chooseDataset('custom')} aria-pressed={dataset === 'custom'}>Blank canvas</button>
    </div>

    <div className="neural-example-tools">
      <span>ADD AN EXAMPLE</span>
      <button className={`class-tool class-zero${classToAdd === 0 ? ' class-selected' : ''}`} onClick={() => { setTool('draw'); setClassToAdd(0); setNote('Tap the map to add a coral example. Drag any dot to move it.') }} aria-pressed={classToAdd === 0}><i /> CORAL</button>
      <button className={`class-tool class-one${classToAdd === 1 ? ' class-selected' : ''}`} onClick={() => { setTool('draw'); setClassToAdd(1); setNote('Tap the map to add a teal example. Drag any dot to move it.') }} aria-pressed={classToAdd === 1}><i /> TEAL</button>
      <button className={`map-tool${tool === 'erase' ? ' tool-selected' : ''}`} onClick={() => { haltTraining(); setTool(tool === 'erase' ? 'draw' : 'erase'); setNote(tool === 'erase' ? 'Draw mode. Tap to add an example.' : 'Erase mode. Tap a dot to remove it.') }} aria-pressed={tool === 'erase'}>⌫ Erase</button>
      <button className="map-tool" onClick={undo} disabled={!undoCount}>↶ Undo</button>
      <button className="map-tool" onClick={clearExamples} disabled={!samples.length}>Clear</button>
    </div>

    <div className="neural-map-legend"><span><i className="legend-zero" /> CORAL EXAMPLE</span><span><i className="legend-one" /> TEAL EXAMPLE</span><span><i className="legend-miss" /> WRONG GUESS</span><span><i className="legend-probe" /> TEST POINT</span></div>
    <div className="neural-learning-controls">
      <div className="neural-tool-status" role="status" aria-live="polite" aria-atomic="true"><strong>{tool === 'probe' ? `The model guesses ${prediction >= .5 ? 'TEAL' : 'CORAL'}` : tool === 'erase' ? 'ERASE AN EXAMPLE' : `ADDING ${classToAdd === 1 ? 'TEAL' : 'CORAL'} EXAMPLES`}</strong><small>{tool === 'probe' ? `${prediction.toFixed(3)} confidence · test points stay out of training` : note}</small></div>
      <button className={`neural-probe-button${tool === 'probe' ? ' probe-active' : ''}`} onClick={() => { haltTraining(); setTool(tool === 'probe' ? 'draw' : 'probe'); setNote('Tap anywhere on the map to test a new point. It will not be added to the examples.') }} aria-pressed={tool === 'probe'}>Test a guess <span>◎</span></button>
      <button className={`neural-learn-button${training ? ' learning-now' : ''}`} onClick={toggleTraining} disabled={samples.length < 2}>{training ? 'Pause learning' : 'Teach it this pattern'} <span>{training ? 'Ⅱ' : '▶'}</span></button>
      <div className="neural-loss-readout"><span>LOSS</span><strong>{metrics.loss.toFixed(3)}</strong></div>
      <button className="neural-inspect-button" onClick={() => setNetworkOpen((open) => !open)} aria-expanded={networkOpen}>Inspect network</button>
    </div>

    {networkOpen && <NetworkInspector network={network} input={input} activation={activation} onClose={() => setNetworkOpen(false)} />}

    <ControlPanel title="Neural Networks" note="Feedforward · backpropagation" visible={controlsVisible} onClose={onCloseControls}>
      <SelectControl label="Training pattern" value={dataset} options={datasets} onChange={(value) => chooseDataset(value as DatasetName)} />
      <SelectControl label="Neurons in each hidden layer" value={String(hidden)} options={hiddenSizes.map((size) => [String(size), `${size} neurons`] as [string, string])} onChange={(value) => changeArchitecture(Number(value), depth)} />
      <SelectControl label="Number of hidden layers" value={String(depth)} options={[["1", "One layer"], ["2", "Two layers"]]} onChange={(value) => changeArchitecture(hidden, Number(value))} />
      <SelectControl label="Activation function" value={activation} options={[["tanh", "tanh"], ["sigmoid", "sigmoid"], ["relu", "ReLU"]]} onChange={(value) => changeActivation(value as Activation)} />
      <RangeControl label="Learning rate" value={rate} min={.01} max={.22} step={.005} format={(value) => value.toFixed(3)} onChange={setRate} />
      <div className="neural-advanced-metrics"><span>TRAINING EXAMPLES <b>{samples.length}</b></span><span>ACCURACY <b>{Math.round(correct * 100)}%</b></span><span>MEAN SQUARED LOSS <b>{metrics.loss.toFixed(4)}</b></span><span>LIVE PREDICTION <b>{prediction.toFixed(4)}</b></span></div>
      <button className="small-action" onClick={() => resetWeights()}>Reset the weights</button>
      <p className="control-note">The canvas colours come from the actual network output at each location. It learns from labelled examples with backpropagation. New test points are never added to training unless you place them in draw mode. Custom lesson positions and labels are included in the public share URL, up to {MAX_SHARED_NEURAL_SAMPLES} examples; trained weights restart from the saved initialization seed.</p>
    </ControlPanel>
  </section>
}
