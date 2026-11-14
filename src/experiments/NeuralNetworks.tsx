import { useEffect, useRef, useState } from 'react'
import type { ExperimentControls } from '../types'
import { ActionRow, ControlPanel, RangeControl, SelectControl } from '../components/Controls'
import { accuracy, createNetwork, forwardNetwork, trainNetworkStep, type Activation, type NeuralNetwork, type Sample } from '../simulations/neural'
import { useDiscoveryHint } from '../lib/useDiscoveryHint'
import './ExpandedExhibits.css'

type DatasetName = 'xor' | 'circle' | 'diagonal'
const datasets: [DatasetName, string][] = [['xor', 'Opposite corners · XOR'], ['circle', 'Inside or outside · circle'], ['diagonal', 'A diagonal boundary']]
const hiddenSizes = [3, 4, 5, 6, 8]
function makeDataset(kind: DatasetName, count = 72): Sample[] {
  let seed = kind === 'xor' ? 801 : kind === 'circle' ? 517 : 227
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  return Array.from({ length: count }, () => {
    const x = random() * 2 - 1, y = random() * 2 - 1
    const label = kind === 'xor' ? Number(x * y > 0) : kind === 'circle' ? Number(x * x + y * y < .48) : Number(x + y > .08)
    return { x: [x, y], y: label }
  })
}
const outputValue = (value: number, activation: Activation) => activation === 'tanh' ? (value + 1) / 2 : activation === 'relu' ? value / (1 + value) : value
const palette = { teal: '#75d5c2', coral: '#f2a283', lavender: '#ad9ceb', pale: '#e5e1d4' }
function measureLoss(network: NeuralNetwork, samples: readonly Sample[], activation: Activation) {
  return samples.reduce((loss, sample) => {
    const output = forwardNetwork(network, sample.x, activation).output[0], target = activation === 'tanh' ? sample.y * 2 - 1 : sample.y
    return loss + .5 * (output - target) ** 2
  }, 0) / Math.max(1, samples.length)
}

export default function NeuralNetworks({ paused, controlsVisible, stateFromUrl, onShareState, onCloseControls }: ExperimentControls) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hint = useDiscoveryHint('neural')
  const [dataset, setDataset] = useState<DatasetName>(() => ['xor', 'circle', 'diagonal'].includes(String(stateFromUrl?.dataset)) ? stateFromUrl?.dataset as DatasetName : 'xor')
  const [hidden, setHidden] = useState(() => hiddenSizes.includes(Number(stateFromUrl?.hidden)) ? Number(stateFromUrl?.hidden) : 5)
  const [depth, setDepth] = useState(() => [1, 2].includes(Number(stateFromUrl?.depth)) ? Number(stateFromUrl?.depth) : 1)
  const [activation, setActivation] = useState<Activation>(() => ['tanh', 'sigmoid', 'relu'].includes(String(stateFromUrl?.activation)) ? stateFromUrl?.activation as Activation : 'tanh')
  const [rate, setRate] = useState(() => Number.isFinite(Number(stateFromUrl?.rate)) && Number(stateFromUrl?.rate) >= .01 && Number(stateFromUrl?.rate) <= .22 ? Number(stateFromUrl?.rate) : .08)
  const [training, setTraining] = useState(false)
  const [loss, setLoss] = useState('—')
  const [score, setScore] = useState('—')
  const [input, setInput] = useState<[number, number]>([.38, -.24])
  const network = useRef<NeuralNetwork>(createNetwork([2, 5, 1], 4))
  const samples = useRef(makeDataset(dataset))
  const inputRef = useRef<[number, number]>(input)
  const settings = useRef({ paused, training, activation, rate, hidden, depth })
  const seed = useRef(5)
  settings.current = { paused, training, activation, rate, hidden, depth }
  inputRef.current = input

  const resetNetwork = (kind = dataset, neurons = hidden, layers = depth) => {
    samples.current = makeDataset(kind)
    network.current = createNetwork([2, ...Array(layers).fill(neurons), 1], ++seed.current)
    setTraining(false); setLoss(measureLoss(network.current, samples.current, activation).toFixed(4)); setScore(`${Math.round(accuracy(network.current, samples.current, activation) * 100)}%`)
  }
  useEffect(() => { resetNetwork(dataset, hidden, depth) }, [dataset, hidden, depth])
  useEffect(() => { setTraining(false); setLoss(measureLoss(network.current, samples.current, activation).toFixed(4)); setScore(`${Math.round(accuracy(network.current, samples.current, activation) * 100)}%`) }, [activation])
  useEffect(() => { onShareState({ dataset, hidden, depth, activation, rate }); }, [dataset, hidden, depth, activation, rate, onShareState])
  useEffect(() => {
    const canvas = canvasRef.current, ctx = canvas?.getContext('2d', { alpha: false })
    if (!canvas || !ctx) return
    let width = 0, height = 0, dpr = 1, raf = 0, lastTrain = 0, lastStats = 0
    let drawnLoss = 0.2
    const resize = () => { const rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return; width = rect.width; height = rect.height; dpr = Math.min(devicePixelRatio || 1, 1.5, Math.sqrt(2_400_000 / (width * height))); canvas.width = Math.floor(width * dpr); canvas.height = Math.floor(height * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0) }
    const plot = () => width < 720
      ? ({ x: width * .06, y: height * .25, w: width * .88, h: height * .36 })
      : ({ x: width * .06, y: height * .24, w: width * .56, h: height * .61 })
    const draw = (now: number) => {
      if(document.hidden){raf=requestAnimationFrame(draw);return}
      const p = plot(), q = settings.current, net = network.current, data = samples.current
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#080d14'; ctx.fillRect(0, 0, width, height)
      const atmosphere = ctx.createRadialGradient(width * .58, height * .52, 0, width * .58, height * .52, width * .72); atmosphere.addColorStop(0, 'rgba(34,65,77,.21)'); atmosphere.addColorStop(1, 'rgba(3,7,12,0)'); ctx.fillStyle = atmosphere; ctx.fillRect(0, 0, width, height)
      ctx.fillStyle = '#08121a'; ctx.fillRect(p.x, p.y, p.w, p.h)
      const cols = 52, rows = 40, cw = p.w / cols, ch = p.h / rows
      for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < cols; gx++) {
        const x = (gx + .5) / cols * 2 - 1, y = 1 - (gy + .5) / rows * 2
        const probability = outputValue(forwardNetwork(net, [x, y], q.activation).output[0], q.activation)
        const strength = Math.min(1, Math.abs(probability - .5) * 2)
        ctx.fillStyle = probability > .5 ? `rgba(92,211,191,${.06 + strength * .25})` : `rgba(240,139,116,${.06 + strength * .23})`
        ctx.fillRect(p.x + gx * cw, p.y + gy * ch, cw + .5, ch + .5)
      }
      ctx.save(); ctx.beginPath(); ctx.rect(p.x, p.y, p.w, p.h); ctx.clip()
      for (const sample of data) { const x = p.x + (sample.x[0] + 1) * p.w / 2, y = p.y + (1 - sample.x[1]) * p.h / 2; ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2); ctx.fillStyle = sample.y ? '#8ee2ca' : '#f4a28a'; ctx.fill(); ctx.strokeStyle = '#081018'; ctx.lineWidth = 1; ctx.stroke() }
      const px = p.x + (inputRef.current[0] + 1) * p.w / 2, py = p.y + (1 - inputRef.current[1]) * p.h / 2
      ctx.beginPath(); ctx.arc(px, py, 8, 0, Math.PI * 2); ctx.strokeStyle = '#fff5db'; ctx.lineWidth = 1; ctx.stroke(); ctx.beginPath(); ctx.arc(px, py, 2.2, 0, Math.PI * 2); ctx.fillStyle = '#fff5db'; ctx.fill(); ctx.restore()
      ctx.strokeStyle = 'rgba(207,228,231,.22)'; ctx.lineWidth = 1; ctx.strokeRect(p.x, p.y, p.w, p.h)
      ctx.strokeStyle = 'rgba(212,231,235,.12)'; ctx.setLineDash([2, 6]); ctx.beginPath(); ctx.moveTo(p.x + p.w / 2, p.y); ctx.lineTo(p.x + p.w / 2, p.y + p.h); ctx.moveTo(p.x, p.y + p.h / 2); ctx.lineTo(p.x + p.w, p.y + p.h / 2); ctx.stroke(); ctx.setLineDash([])
      ctx.textAlign = 'left'; ctx.fillStyle = '#91a6ac'; ctx.font = '10px monospace'; ctx.fillText('INPUT SPACE · x₁', p.x + 4, p.y - 12); ctx.fillText('x₂', Math.max(5, p.x - 22), p.y + 12)

      const mobile = width < 720
      const graphX = width * (mobile ? .14 : .72), graphY = height * (mobile ? .70 : .24), graphW = width * (mobile ? .72 : .23), graphH = height * (mobile ? .17 : .48)
      const layerXs = net.sizes.map((_, index) => graphX + index * (graphW / (net.sizes.length - 1)))
      const positions = net.sizes.map((count, layerIndex) => Array.from({ length: count }, (_, i) => ({ x: layerXs[layerIndex], y: graphY + (i + 1) * graphH / (count + 1) })))
      const computed = forwardNetwork(net, inputRef.current, q.activation)
      for (let layerIndex = 0; layerIndex < net.layers.length; layerIndex++) {
        const layer = net.layers[layerIndex]
        for (let out = 0; out < layer.weights.length; out++) for (let from = 0; from < layer.weights[out].length; from++) {
          const a = positions[layerIndex][from], b = positions[layerIndex + 1][out], weight = layer.weights[out][from]
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.strokeStyle = weight >= 0 ? `rgba(105,209,191,${.16 + Math.min(.72, Math.abs(weight) * .17)})` : `rgba(236,137,123,${.16 + Math.min(.72, Math.abs(weight) * .17)})`; ctx.lineWidth = .45 + Math.min(2.2, Math.abs(weight) * .42); ctx.stroke()
        }
      }
      positions.forEach((layer, layerIndex) => layer.forEach((point, neuron) => {
        const activationValue = computed.activations[layerIndex][neuron], normalized = outputValue(activationValue, q.activation), r = layerIndex === 0 ? 7 : layerIndex === positions.length - 1 ? 10 : 5.2
        const hue = normalized >= .5 ? palette.teal : palette.coral
        const glow = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, r * 3.7); glow.addColorStop(0, hue + '66'); glow.addColorStop(1, hue + '00'); ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(point.x, point.y, r * 3.7, 0, Math.PI * 2); ctx.fill()
        ctx.beginPath(); ctx.arc(point.x, point.y, r, 0, Math.PI * 2); ctx.fillStyle = `rgba(10,20,27,${1 - normalized * .28})`; ctx.fill(); ctx.strokeStyle = hue; ctx.lineWidth = 1.1; ctx.stroke()
        ctx.beginPath(); ctx.arc(point.x, point.y, r * Math.max(.08, normalized), 0, Math.PI * 2); ctx.fillStyle = hue + 'cf'; ctx.fill()
        ctx.fillStyle = '#90a2a7'; ctx.font = mobile ? '7px monospace' : '9px monospace'; ctx.textAlign = layerIndex === 0 ? 'left' : layerIndex === positions.length - 1 ? 'right' : 'center'; ctx.fillText(layerIndex === 0 ? `x${neuron + 1}` : layerIndex === positions.length - 1 ? `${normalized.toFixed(2)}` : `${activationValue.toFixed(2)}`, point.x + (layerIndex === 0 ? -12 : layerIndex === positions.length - 1 ? 18 : 0), point.y + r + 12)
      }))
      ctx.textAlign = 'center'; ctx.fillStyle = '#a2b5b6'; ctx.font = '9px monospace'; ctx.fillText('INPUT', layerXs[0], graphY - 24); ctx.fillText('OUTPUT', layerXs[layerXs.length - 1], graphY - 24)
      const prediction = outputValue(computed.output[0], q.activation)
      if (!mobile) {
        ctx.textAlign = 'left'; ctx.fillStyle = '#82979e'; ctx.font = '9px monospace'; ctx.fillText(`BACKPROPAGATION · ${q.activation.toUpperCase()}`, graphX - 12, height * .84)
        ctx.fillStyle = '#e6ebe1'; ctx.font = '13px monospace'; ctx.fillText(`ŷ ${prediction.toFixed(3)}`, graphX - 12, height * .9)
        ctx.fillStyle = '#7d9299'; ctx.font = '9px monospace'; ctx.fillText(`w̄ ${meanWeight(net).toFixed(2)}   b̄ ${meanBias(net).toFixed(2)}`, graphX - 12, height * .94)
      }
      if (q.training && !q.paused && now - lastTrain > 65) { drawnLoss = trainNetworkStep(net, data, q.activation, q.rate); lastTrain = now }
      if (q.training && now - lastStats > 230) { setLoss(drawnLoss.toFixed(4)); setScore(`${Math.round(accuracy(net, data, q.activation) * 100)}%`); lastStats = now }
      raf = requestAnimationFrame(draw)
    }
    function meanWeight(net: NeuralNetwork) { const values = net.layers.flatMap((layer) => layer.weights.flat()); return values.reduce((sum, value) => sum + Math.abs(value), 0) / Math.max(1, values.length) }
    function meanBias(net: NeuralNetwork) { const values = net.layers.flatMap((layer) => layer.biases); return values.reduce((sum, value) => sum + Math.abs(value), 0) / Math.max(1, values.length) }
    const observer = new ResizeObserver(resize); observer.observe(canvas); resize(); raf = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(raf); observer.disconnect() }
  }, [])

  const updateInput = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current; if (!canvas) return
    const rect = canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top
    const mobile = rect.width < 720, plotX = .06, plotWidth = mobile ? .88 : .56, plotY = mobile ? .25 : .24, plotHeight = mobile ? .36 : .61
    if (x > rect.width * (mobile ? .96 : .65) || x < rect.width * (mobile ? .04 : .04) || y < rect.height * (plotY - .02) || y > rect.height * (plotY + plotHeight + .02)) return
    hint.dismiss()
    setInput([Math.max(-1, Math.min(1, ((x / rect.width - plotX) / plotWidth) * 2 - 1)), Math.max(-1, Math.min(1, 1 - ((y / rect.height - plotY) / plotHeight) * 2))])
  }
  const currentPrediction = outputValue(forwardNetwork(network.current, input, activation).output[0], activation)

  return <section className="experiment-surface neural-surface" aria-label="Trainable neural network">
    <canvas className="experiment-canvas neural-canvas" ref={canvasRef} aria-label="Prediction map. Teal and coral areas are the network's current guesses; dots are examples. Drag to test a point." aria-describedby={hint.visible ? 'neural-first-move' : 'neural-map-help'} onPointerDown={updateInput} onPointerMove={(event) => { if (event.buttons & 1) updateInput(event) }} />
    {hint.visible ? <aside className="scene-nudge scene-nudge-neural" id="neural-first-move" role="note"><span>Try this · Neural Networks</span><p>Move the bright point, then press Train. Watch the colour map change around the example dots.</p><button onClick={hint.dismiss} aria-label="Dismiss first-move hint">×</button></aside> : <button className="scene-nudge-reopen scene-nudge-neural-reopen" onClick={hint.show} aria-label="Show interaction tip" title="Show interaction tip">i</button>}
    <div className="neural-heading"><span className="exp-eyebrow">A SMALL LEARNING MACHINE <i /></span><h2>Watch the boundary <em>move.</em></h2><p id="neural-map-help">Each dot is an example. Teal and coral show the two groups. Drag a point, then press Train to watch the boundary change.</p></div>
    <div className="neural-metrics"><div><span>MISMATCH <i>LOSS</i></span><strong>{loss}</strong><small>Lower means guesses are closer to the examples.</small></div><div><span>EXAMPLES CORRECT <i>ACCURACY</i></span><strong>{score}</strong></div><div><span>THIS POINT <i>PREDICTION</i></span><strong>{currentPrediction.toFixed(3)} · {currentPrediction >= .5 ? 'Class 1' : 'Class 0'}</strong><small>{currentPrediction >= .5 ? 'The model colours it teal.' : 'The model colours it coral.'}</small></div></div>
    <div className="neural-training-tools"><button className={training ? 'training' : ''} onClick={() => { setTraining((value) => !value); hint.dismiss() }}>{training ? 'Ⅱ  Pause training' : '▶  Train the network'}</button><button onClick={() => { resetNetwork(); hint.dismiss() }}>Reset and compare</button></div>
    <div className="neural-input-readout"><span>POINT BEING TESTED</span><b>x₁ {input[0].toFixed(2)}</b><b>x₂ {input[1].toFixed(2)}</b><small>Use the map or the two sliders in Controls.</small></div>
    <ControlPanel title="Neural Networks" note="Feedforward · backpropagation" visible={controlsVisible} onClose={onCloseControls}>
      <SelectControl label="Training examples" value={dataset} options={datasets as [string, string][]} onChange={(value) => setDataset(value as DatasetName)} />
      <SelectControl label="Neurons in each middle layer" value={String(hidden)} options={hiddenSizes.map((size) => [String(size), `${size} neurons`] as [string,string])} onChange={(value) => setHidden(Number(value))} />
      <SelectControl label="Number of middle layers" value={String(depth)} options={[["1", "One layer"], ["2", "Two layers"]]} onChange={(value) => setDepth(Number(value))} />
      <SelectControl label="Neuron response rule · activation" value={activation} options={[["tanh", "tanh"], ["sigmoid", "sigmoid"], ["relu", "ReLU"]]} onChange={(value) => setActivation(value as Activation)} />
      <RangeControl label="Weight update size · learning rate" value={rate} min={.01} max={.22} step={.005} format={(v) => v.toFixed(3)} onChange={setRate} />
      <RangeControl label="Test point x₁" value={input[0]} min={-1} max={1} step={.01} format={(v) => v.toFixed(2)} onChange={(v) => setInput(([_, y]) => [v, y])} />
      <RangeControl label="Test point x₂" value={input[1]} min={-1} max={1} step={.01} format={(v) => v.toFixed(2)} onChange={(v) => setInput(([x]) => [x, v])} />
      <ActionRow><button className="small-action" onClick={() => setTraining((value) => !value)}>{training ? 'Pause training' : 'Train continuously'}</button><button className="small-action" onClick={() => resetNetwork()}>Reset weights</button></ActionRow>
      <p className="control-note">The two labelled groups are classes 0 and 1. This feedforward network learns by backpropagation: neurons combine weighted inputs using an activation rule, and each update adjusts weights to reduce loss. Teal lines carry positive weights, coral lines negative weights; thicker lines have greater magnitude.</p>
    </ControlPanel>
  </section>
}
