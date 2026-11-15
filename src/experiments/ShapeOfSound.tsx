import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { ActionRow, ControlPanel, RangeControl, Segmented } from '../components/Controls'
import type { ExperimentControls } from '../types'
import { addHarmonic, applyLowpassResponse, harmonicsToPeriodicWaveCoefficients, lowpassMagnitude, quietSignalGain, signalSpectrum, synthesizeSignal, timbreHarmonics } from '../simulations/sound'
import type { Harmonic, TimbrePreset } from '../simulations/sound'
import { clamp, normalizedPointer, resizeCanvas, safeState } from './invisibleWorld'
import './invisible-world.css'

type ViewMode = 'spectrum' | 'spectrogram'
type AudioRig = { context: AudioContext; oscillator: OscillatorNode; filter: BiquadFilterNode; gain: GainNode }

function peakFor(samples: Float32Array) {
  let peak = 0
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample))
  return Math.max(0.2, peak)
}
export default function ShapeOfSound({ paused, controlsVisible, stateFromUrl, onShareState, onCloseControls }: ExperimentControls) {
  const canvasRef = useRef<HTMLCanvasElement>(null), spectrogramRef = useRef<HTMLCanvasElement>(null), sizeRef = useRef({ width: 1, height: 1, dpr: 1 })
  const spectrogramInitializedRef = useRef(false), spectrogramLastColumnAtRef = useRef(0)
  const audioRef = useRef<AudioRig | null>(null), audioStartRef = useRef<Promise<void> | null>(null), paintRef = useRef<() => void>(() => {}), timeRef = useRef(0), draggingComponent = useRef<number | null>(null)
  const [frequency, setFrequency] = useState(220), [harmonics, setHarmonics] = useState<Harmonic[]>(() => timbreHarmonics('triangle'))
  const [timbre, setTimbre] = useState<TimbrePreset | 'custom'>('triangle')
  const [selected, setSelected] = useState(1), [cutoff, setCutoff] = useState(1800), [filterOn, setFilterOn] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('spectrum'), [audioOn, setAudioOn] = useState(false), [muted, setMuted] = useState(false), [audioMessage, setAudioMessage] = useState('The waveform is visible with sound off.')
  const restored = useRef(false)
  const sampleRate = audioRef.current?.context.sampleRate ?? 44100
  const displayedHarmonics = useMemo(() => filterOn ? applyLowpassResponse(harmonics, frequency, cutoff, sampleRate) : harmonics, [harmonics, frequency, filterOn, cutoff, sampleRate])
  const signal = useMemo(() => synthesizeSignal({ frequency, harmonics: displayedHarmonics, samples: 2048 }), [frequency, displayedHarmonics])
  const rawSpectrum = useMemo(() => signalSpectrum(signal), [signal])
  const peak = useMemo(() => peakFor(signal), [signal])
  const audioPeak = useMemo(() => peakFor(synthesizeSignal({ frequency, harmonics, samples: 2048 })), [frequency, harmonics])
  const selectedHarmonic = harmonics.find((part) => part.multiple === selected) ?? harmonics[0]

  useEffect(() => {
    if (!stateFromUrl || restored.current) return
    restored.current = true
    const savedFrequency = safeState(stateFromUrl, 'frequency', frequency), savedHarmonics = safeState(stateFromUrl, 'harmonics', harmonics)
    if (typeof savedFrequency === 'number' && savedFrequency >= 55 && savedFrequency <= 660) setFrequency(savedFrequency)
    if (Array.isArray(savedHarmonics) && savedHarmonics.length > 0 && savedHarmonics.length <= 10 && savedHarmonics.every((part) => typeof part === 'object' && Number.isInteger((part as Harmonic).multiple) && (part as Harmonic).multiple > 0 && (part as Harmonic).multiple <= 24)) { setHarmonics(savedHarmonics as Harmonic[]); setTimbre('custom') }
  }, [stateFromUrl, frequency, harmonics])
  useEffect(() => { onShareState({ frequency, harmonics, cutoff, filterOn, viewMode }) }, [frequency, harmonics, cutoff, filterOn, viewMode, onShareState])

  const installPeriodicWave = useCallback((rig: AudioRig, values: Harmonic[]) => {
    const coefficients = harmonicsToPeriodicWaveCoefficients(values, 32)
    const wave = rig.context.createPeriodicWave(coefficients.real, coefficients.imaginary, { disableNormalization: true })
    rig.oscillator.setPeriodicWave(wave)
  }, [])
  const startAudio = async () => {
    if (audioStartRef.current) return audioStartRef.current
    const operation = (async () => {
      let context: AudioContext | null = null
      try {
        if (audioRef.current) {
          const rig = audioRef.current
          if (rig.context.state === 'suspended') await rig.context.resume()
          const nextOn = !audioOn
          setAudioOn(nextOn); setMuted(false)
          rig.gain.gain.setTargetAtTime(nextOn ? quietSignalGain(audioPeak) : 0, rig.context.currentTime, 0.035)
          setAudioMessage(nextOn ? 'Playing generated harmonics at a quiet level.' : 'Sound is off. The visual signal remains active.')
          return
        }
        context = new AudioContext()
        const oscillator = context.createOscillator(), filter = context.createBiquadFilter(), gain = context.createGain()
        filter.type = 'lowpass'; filter.frequency.value = cutoff; filter.Q.value = Math.SQRT1_2
        gain.gain.value = 0
        oscillator.frequency.value = frequency
        oscillator.connect(filter); filter.connect(gain); gain.connect(context.destination)
        const rig = { context, oscillator, filter, gain }
        audioRef.current = rig
        installPeriodicWave(rig, harmonics); oscillator.start(); await context.resume()
        setAudioOn(true); setMuted(false)
        gain.gain.setTargetAtTime(quietSignalGain(audioPeak), context.currentTime, 0.04)
        setAudioMessage('Playing a Web Audio oscillator synthesized from these visible Fourier components.')
      } catch {
        const rig = audioRef.current
        if (rig) { try { rig.oscillator.stop() } catch { /* The oscillator may already have stopped. */ }; void rig.context.close().catch(() => {}); audioRef.current = null }
        else if (context) void context.close().catch(() => {})
        setAudioOn(false); setMuted(false)
        setAudioMessage('Audio could not start in this browser. The visual instrument still works.')
      }
    })()
    audioStartRef.current = operation
    try { await operation } finally { if (audioStartRef.current === operation) audioStartRef.current = null }
  }
  const toggleMute = () => {
    const rig = audioRef.current
    if (!rig) return
    const nextMuted = !muted
    setMuted(nextMuted)
    rig.gain.gain.setTargetAtTime(nextMuted || !audioOn ? 0 : quietSignalGain(audioPeak), rig.context.currentTime, 0.02)
    setAudioMessage(nextMuted ? 'Muted. The waveform and spectrum continue to show the generated signal.' : 'Sound returned at a quiet level.')
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const resize = () => { sizeRef.current = resizeCanvas(canvas, 1.35); paintRef.current() }
    const observer = new ResizeObserver(resize); observer.observe(canvas); resize()
    return () => observer.disconnect()
  }, [])

  const paint = useCallback((time: number) => {
    const canvas = canvasRef.current, context = canvas?.getContext('2d', { alpha: false })
    if (!canvas || !context) return
    const { width, height, dpr } = sizeRef.current
    if (!width || !height) return
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.fillStyle = '#0b0a16'; context.fillRect(0, 0, width, height)
    const veil = context.createRadialGradient(width * 0.48, height * 0.43, 0, width * 0.48, height * 0.43, height * 0.86)
    veil.addColorStop(0, 'rgba(59,46,92,.28)'); veil.addColorStop(0.5, 'rgba(29,30,59,.12)'); veil.addColorStop(1, 'rgba(7,9,18,0)')
    context.fillStyle = veil; context.fillRect(0, 0, width, height)
    const top = Math.max(124, height * 0.18), plotH = height * 0.38, mid = top + plotH * 0.52
    context.strokeStyle = 'rgba(190,176,224,.13)'; context.lineWidth = 0.7
    for (let line = -2; line <= 2; line++) { const y = mid + line * plotH * 0.19; context.beginPath(); context.moveTo(width * 0.075, y); context.lineTo(width * 0.93, y); context.stroke() }
    for (let tick = 0; tick <= 8; tick++) { const x = width * (0.075 + tick * 0.106); context.beginPath(); context.moveTo(x, top + 4); context.lineTo(x, top + plotH); context.stroke() }
    context.font = '10px ui-monospace, monospace'; context.fillStyle = 'rgba(188,180,211,.72)'; context.fillText('ONE PERIOD · TIME DOMAIN', width * 0.075, top - 11)
    context.fillStyle = 'rgba(158,148,189,.6)'; context.fillText(`${frequency} Hz`, width * 0.875, top - 11)
    context.beginPath()
    for (let i = 0; i < signal.length; i++) {
      const x = width * 0.075 + i / (signal.length - 1) * width * 0.855
      const y = mid - signal[i] / peak * plotH * 0.42
      if (i === 0) context.moveTo(x, y); else context.lineTo(x, y)
    }
    context.strokeStyle = '#d4b9ff'; context.lineWidth = 1.8; context.shadowColor = '#ab7cff'; context.shadowBlur = 11; context.stroke(); context.shadowBlur = 0
    const cursor = width * (0.075 + ((time * frequency / 1000) % 1) * 0.855)
    context.beginPath(); context.moveTo(cursor, top); context.lineTo(cursor, top + plotH); context.strokeStyle = 'rgba(247,231,255,.55)'; context.lineWidth = 0.8; context.stroke()

    const specTop = height * 0.68, specBottom = height * 0.88, baseY = specBottom
    context.fillStyle = 'rgba(187,168,220,.72)'; context.font = '10px ui-monospace, monospace'
    context.fillText(viewMode === 'spectrum' ? 'FOURIER BARS · DRAG TO SHAPE' : 'SPECTROGRAM · GENERATED SIGNAL OVER TIME', width * 0.075, specTop - 12)
    if (viewMode === 'spectrum') {
      context.strokeStyle = 'rgba(190,176,224,.14)'; context.beginPath(); context.moveTo(width * 0.075, baseY); context.lineTo(width * 0.93, baseY); context.stroke()
      const barCount = 18, slot = width * 0.855 / barCount
      for (let bin = 1; bin <= barCount; bin++) {
        const amplitude = rawSpectrum[bin]
        const barHeight = Math.min(height * 0.17, amplitude * height * 0.22)
        const x = width * 0.075 + (bin - 1) * slot + slot * 0.25
        const selectedPart = harmonics.find((part) => part.multiple === bin)
        const gradient = context.createLinearGradient(x, baseY - barHeight, x, baseY)
        gradient.addColorStop(0, selectedPart && selectedPart.multiple === selected ? '#ffd29b' : '#99d5e8')
        gradient.addColorStop(1, 'rgba(135,111,203,.18)')
        context.fillStyle = gradient; context.fillRect(x, baseY - barHeight, slot * 0.5, barHeight)
        if (selectedPart) { context.fillStyle = 'rgba(219,211,238,.78)'; context.font = '8px ui-monospace, monospace'; context.fillText(String(bin), x + slot * 0.14, baseY + 14) }
      }
    } else {
      const specCanvas = spectrogramRef.current, specContext = specCanvas?.getContext('2d')
      if (specCanvas && specContext) {
        const specWidth = Math.max(1, Math.round(width * 0.855)), specHeight = Math.max(1, Math.round(height * 0.2))
        if (specCanvas.width !== specWidth || specCanvas.height !== specHeight) {
          specCanvas.width = specWidth; specCanvas.height = specHeight; spectrogramInitializedRef.current = false
        }
        const writeColumn = (column: ImageData, targetX: number) => {
          for (let y = 0; y < specHeight; y++) {
            const bin = Math.max(1, Math.min(rawSpectrum.length - 1, Math.round(1 + (1 - y / Math.max(1, specHeight - 1)) * 17)))
            const amplitude = rawSpectrum[bin], level = Math.min(1, Math.log1p(amplitude * 24) / Math.log1p(0.8 * 24))
            const index = y * 4
            column.data[index] = Math.round(12 + level * 230); column.data[index + 1] = Math.round(9 + level * 128); column.data[index + 2] = Math.round(25 + level * 228); column.data[index + 3] = 255
          }
          specContext.putImageData(column, targetX, 0)
        }
        if (!spectrogramInitializedRef.current) {
          const image = specContext.createImageData(specWidth, specHeight)
          for (let y = 0; y < specHeight; y++) {
            const bin = Math.max(1, Math.min(rawSpectrum.length - 1, Math.round(1 + (1 - y / Math.max(1, specHeight - 1)) * 17)))
            const amplitude = rawSpectrum[bin], level = Math.min(1, Math.log1p(amplitude * 24) / Math.log1p(0.8 * 24))
            const red = Math.round(12 + level * 230), green = Math.round(9 + level * 128), blue = Math.round(25 + level * 228)
            for (let x = 0; x < specWidth; x++) { const index = (y * specWidth + x) * 4; image.data[index] = red; image.data[index + 1] = green; image.data[index + 2] = blue; image.data[index + 3] = 255 }
          }
          specContext.putImageData(image, 0, 0); spectrogramInitializedRef.current = true
          spectrogramLastColumnAtRef.current = time
        } else if (time - spectrogramLastColumnAtRef.current >= 70) {
          const column = specContext.createImageData(1, specHeight)
          specContext.drawImage(specCanvas, -1, 0)
          writeColumn(column, specWidth - 1)
          spectrogramLastColumnAtRef.current = time
        }
        context.drawImage(specCanvas, width * 0.075, specTop, width * 0.855, height * 0.2)
        const cursorX = width * 0.93
        context.beginPath(); context.moveTo(cursorX, specTop); context.lineTo(cursorX, specTop + height * 0.2)
        context.strokeStyle = 'rgba(246,231,255,.3)'; context.lineWidth = .8; context.stroke()
      }
    }
    const labelY = height * 0.93
    context.fillStyle = 'rgba(189,178,211,.66)'; context.font = '9px ui-monospace, monospace'
    context.fillText(timbre.toUpperCase(), width * 0.075, labelY)
    context.fillText(`${harmonics.length} PARTIAL${harmonics.length === 1 ? '' : 'S'}`, width * 0.17, labelY)
    context.fillText(filterOn ? `LOW-PASS ${cutoff} Hz` : 'FILTER OPEN', width * 0.79, labelY)
  }, [signal, rawSpectrum, frequency, peak, viewMode, harmonics, filterOn, cutoff, selected, timbre])
  useEffect(() => { paintRef.current = () => paint(timeRef.current) }, [paint])

  useEffect(() => {
    let frame = 0, time = 0, last = 0, disposed = false
    const draw = (now: number) => {
      if (disposed) return
      const elapsed = last ? now - last : 0
      last = now
      if (!paused && elapsed > 28) { time += elapsed; timeRef.current = time }
      paint(time)
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => { disposed = true; cancelAnimationFrame(frame) }
  }, [paint, paused])

  useEffect(() => {
    const rig = audioRef.current
    if (!rig) return
    rig.oscillator.frequency.setTargetAtTime(frequency, rig.context.currentTime, 0.025)
    rig.filter.frequency.setTargetAtTime(filterOn ? cutoff : 20000, rig.context.currentTime, 0.03)
    rig.gain.gain.setTargetAtTime(audioOn && !muted ? quietSignalGain(audioPeak) : 0, rig.context.currentTime, 0.035)
    try { installPeriodicWave(rig, harmonics) } catch { setAudioMessage('The browser declined a harmonic update; reset the instrument to continue.') }
  }, [frequency, harmonics, cutoff, filterOn, installPeriodicWave, audioOn, muted, audioPeak])

  useEffect(() => () => {
    const rig = audioRef.current
    if (!rig) return
    try { rig.oscillator.stop() } catch { /* The oscillator may already have stopped. */ }
    void rig.context.close().catch(() => {})
    audioRef.current = null
  }, [])

  const chooseTimbre = (value: TimbrePreset) => { setTimbre(value); setHarmonics(timbreHarmonics(value)); setSelected(1) }
  const updateHarmonic = (key: 'amplitude' | 'phase', value: number) => { setTimbre('custom'); setHarmonics((previous) => previous.map((part) => part.multiple === selected ? { ...part, [key]: value } : part)) }
  const togglePartial = (multiple: number) => {
    setTimbre('custom')
    const next = addHarmonic(harmonics, multiple); setHarmonics(next)
    if (!next.some((part) => part.multiple === selected)) setSelected(next[0]?.multiple ?? 1)
    else if (!harmonics.some((part) => part.multiple === multiple)) setSelected(multiple)
  }
  const editSpectrum = (event: ReactPointerEvent<HTMLCanvasElement>, dragged: number | null) => {
    if (viewMode !== 'spectrum') return
    const point = normalizedPointer(event, event.currentTarget)
    if (point.x < 0.075 || point.x > 0.93 || point.y < 0.68 || point.y > 0.91) return
    const multiple = dragged ?? Math.max(1, Math.min(18, Math.floor((point.x - 0.075) / 0.855 * 18) + 1))
    const visibleAmplitude = Math.max(0, Math.min(0.8, (0.88 - point.y) / 0.17 * 0.8))
    const response = filterOn ? lowpassMagnitude(multiple * frequency, cutoff, sampleRate) : 1
    const amplitude = Math.max(0, Math.min(0.8, visibleAmplitude / Math.max(0.025, response)))
    setTimbre('custom')
    setSelected(multiple)
    setHarmonics((previous) => {
      const existing = previous.some((part) => part.multiple === multiple)
      return existing
        ? previous.map((part) => part.multiple === multiple ? { ...part, amplitude } : part)
        : [...previous, { multiple, amplitude, phase: 0 }].sort((a, b) => a.multiple - b.multiple)
    })
  }
  const beginSpectrumEdit = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (viewMode !== 'spectrum') return
    const point = normalizedPointer(event, event.currentTarget)
    if (point.x < 0.075 || point.x > 0.93 || point.y < 0.68 || point.y > 0.91) return
    const multiple = Math.max(1, Math.min(18, Math.floor((point.x - 0.075) / 0.855 * 18) + 1))
    draggingComponent.current = multiple
    event.currentTarget.setPointerCapture(event.pointerId)
    editSpectrum(event, multiple)
  }
  const moveSpectrumEdit = (event: ReactPointerEvent<HTMLCanvasElement>) => { if (draggingComponent.current !== null) editSpectrum(event, draggingComponent.current) }
  const endSpectrumEdit = (event: ReactPointerEvent<HTMLCanvasElement>) => { draggingComponent.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }
  const canvasKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (!event.key.startsWith('Arrow')) return
    event.preventDefault(); event.stopPropagation()
    setTimbre('custom')
    const available = harmonics.map((part) => part.multiple), index = Math.max(0, available.indexOf(selected))
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      setSelected(available[clamp(index + (event.key === 'ArrowRight' ? 1 : -1), 0, available.length - 1)])
    } else setHarmonics((previous) => previous.map((part) => part.multiple === selected ? { ...part, amplitude: clamp(part.amplitude + (event.key === 'ArrowUp' ? 0.03 : -0.03), 0, 0.8) } : part))
  }
  const reset = () => { setFrequency(220); setTimbre('triangle'); setHarmonics(timbreHarmonics('triangle')); setSelected(1); setCutoff(1800); setFilterOn(false); setViewMode('spectrum') }

  return <section className="iw-scene iw-sound" aria-label="Interactive Fourier sound instrument">
    <canvas ref={canvasRef} className="iw-canvas iw-sound-canvas" tabIndex={0} aria-label={`Visual waveform of ${frequency} hertz assembled from ${harmonics.length} harmonics. Tap or drag a Fourier bar to add or shape a harmonic; focus the canvas and use arrow keys to select and adjust components.`} onPointerDown={beginSpectrumEdit} onPointerMove={moveSpectrumEdit} onPointerUp={endSpectrumEdit} onPointerCancel={endSpectrumEdit} onKeyDown={canvasKeyDown} />
    <canvas ref={spectrogramRef} className="iw-spectrogram-buffer" aria-hidden="true" />
    <div className="iw-titleplate"><span>16 · ACOUSTIC STUDY</span><strong>The Shape of Sound</strong><small>One tone. Many possible forms.</small></div>
    <div className="iw-sound-actions iw-glass-surface">
      <button className={audioOn ? 'iw-audio-on' : ''} onClick={() => { void startAudio() }} aria-pressed={audioOn}>{audioOn ? 'Stop sound' : 'Listen to the signal'}</button>
      {audioOn && <button onClick={toggleMute} aria-label={muted ? 'Unmute generated sound' : 'Mute generated sound'}>{muted ? 'Unmute' : 'Mute'}</button>}
      <span>{audioOn && !muted ? 'AUDIO ON · LOW LEVEL' : 'AUDIO OFF'}</span>
    </div>
    <div className="iw-audio-status" role="status" aria-live="polite">{audioMessage}</div>
    <ControlPanel title="Sound instrument" note="Fourier synthesis" visible={controlsVisible} onClose={onCloseControls} footer={<span>Audio is generated locally after you press Listen.</span>}>
      <div className="iw-panel-section"><span>Start with a waveform</span><div className="iw-button-row iw-timbre-presets">
        {(['sine', 'triangle', 'square', 'sawtooth'] as TimbrePreset[]).map((value) => <button key={value} className={timbre === value ? 'selected' : ''} aria-pressed={timbre === value} onClick={() => chooseTimbre(value)}>{value === 'sawtooth' ? 'Saw' : value[0].toUpperCase() + value.slice(1)}</button>)}
      </div></div>
      <RangeControl label="Fundamental" value={frequency} min={55} max={660} step={1} format={(value) => `${Math.round(value)} Hz`} onChange={setFrequency} />
      <div className="iw-panel-section"><span>Build the tone · add or remove</span><div className="iw-harmonic-buttons">
        {[2, 3, 4, 5, 6, 8].map((multiple) => <button key={multiple} className={harmonics.some((part) => part.multiple === multiple) ? 'selected' : ''} onClick={() => togglePartial(multiple)} aria-pressed={harmonics.some((part) => part.multiple === multiple)}>{multiple === 2 ? '2nd' : `${multiple}th`}</button>)}
      </div></div>
      <div className="iw-panel-section"><span>Selected component</span><div className="iw-button-row iw-select-partial">{harmonics.map((part) => <button key={part.multiple} className={part.multiple === selected ? 'selected' : ''} onClick={() => setSelected(part.multiple)} aria-pressed={part.multiple === selected}>{part.multiple}×</button>)}</div></div>
      {selectedHarmonic && <>
        <RangeControl label={`Harmonic ${selected} amplitude`} value={selectedHarmonic.amplitude} min={0} max={0.8} step={0.01} format={(value) => value.toFixed(2)} onChange={(value) => updateHarmonic('amplitude', value)} />
        <RangeControl label="Phase" value={selectedHarmonic.phase} min={-Math.PI} max={Math.PI} step={0.01} format={(value) => `${(value * 180 / Math.PI).toFixed(0)}°`} onChange={(value) => updateHarmonic('phase', value)} />
      </>}
      <Segmented label="Lower display" value={viewMode} options={[["spectrum", "Spectrum"], ["spectrogram", "Spectrogram"]]} onChange={(value) => setViewMode(value as ViewMode)} />
      <div className="iw-filter-row"><label><input type="checkbox" checked={filterOn} onChange={(event) => setFilterOn(event.target.checked)} /> Enable low-pass filter</label><small>2-pole Butterworth</small></div>
      <RangeControl label="Filter cutoff" value={cutoff} min={180} max={8000} step={10} format={(value) => `${Math.round(value)} Hz`} onChange={(value) => setCutoff(value)} />
      <p className="control-note">The waveform and spectrum come from the same harmonic sum. The optional low-pass uses a Web Audio biquad; the displayed component bars apply its digital frequency response. Volume is capped at a quiet 5.5% output gain.</p>
      <ActionRow><button className="panel-action" onClick={reset}>Reset instrument <i>↺</i></button></ActionRow>
    </ControlPanel>
  </section>
}
