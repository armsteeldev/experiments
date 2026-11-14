import { useEffect, useMemo, useRef, useState } from 'react'
import type { ExperimentControls } from '../types'
import { ActionRow, ControlPanel, SelectControl } from '../components/Controls'
import { createCpuState, decodeCpuInstruction, executeCpuInstruction, fetchCpuInstruction, parseProgram, type CpuState } from '../simulations/cpu'
import './ExpandedExhibits.css'

const programs: Record<string, { name: string; code: string }> = {
  sum: { name: 'Add two numbers', code: 'LDI A, 7\nLDI B, 5\nADD A, B\nOUT A\nHLT' },
  memory: { name: 'Visit memory', code: 'LDI A, 42\nSTORE 3, A\nLOAD B, 3\nOUT B\nHLT' },
  loop: { name: 'Count by one', code: 'LDI A, 0\nLDI B, 1\nLDI C, 5\nADD A, B\nSUB C, B\nJNZ C, 3\nOUT A\nHLT' },
}
const instructions = ['LDI R, n', 'MOV R, R', 'ADD / SUB / MUL R, R', 'LOAD R, address', 'STORE address, R', 'OUT R', 'JMP address', 'JNZ R, address', 'HLT']
const cloneCpu = (cpu: CpuState): CpuState => ({ ...cpu, registers: { ...cpu.registers }, memory: cpu.memory.slice(), transfer: [...cpu.transfer] })
const dataValue = (value: number) => value.toString().padStart(2, '0')
const byteBits = (value: number) => (value & 255).toString(2).padStart(8, '0')
const addressLabel = (value: number) => value.toString(16).toUpperCase().padStart(2, '0')

function decodeNote(instruction: CpuState['ir']) {
  if (!instruction) return 'The decoder is waiting for an instruction from ROM.'
  const [first, second] = instruction.args
  if (instruction.op === 'LDI') return `LDI copies the constant ${second} into register ${first}.`
  if (['ADD', 'SUB', 'MUL'].includes(instruction.op)) return `${instruction.op} selects registers ${first} and ${second}, then sends both values to the ALU.`
  if (instruction.op === 'LOAD') return `LOAD selects RAM address ${second} and destination register ${first}.`
  if (instruction.op === 'STORE') return `STORE selects register ${second} and RAM address ${first}.`
  if (instruction.op === 'JNZ') return `JNZ checks ${first}; if it is not zero, the next address becomes ${second}.`
  if (instruction.op === 'JMP') return `JMP replaces the next address with ${first}.`
  if (instruction.op === 'HLT') return 'HLT tells the control unit to stop the clock.'
  return `${instruction.op} moves a value between registers.`
}

function executeNote(instruction: CpuState['ir'], before: CpuState, after: CpuState) {
  if (!instruction) return 'No instruction was available to execute.'
  const [first, second] = instruction.args
  if (instruction.op === 'LDI') { const value = after.registers[first?.toUpperCase() ?? 'A']; return `R${first} ← ${Number(second) & 255}  ·  ${byteBits(value)}` }
  if (instruction.op === 'MOV') return `R${first} copies ${before.registers[second?.toUpperCase() ?? 'A']} from R${second}.`
  if (['ADD', 'SUB', 'MUL'].includes(instruction.op)) {
    const a = before.registers[first?.toUpperCase() ?? 'A'], b = before.registers[second?.toUpperCase() ?? 'A'], result = after.registers[first?.toUpperCase() ?? 'A']
    const operation = instruction.op === 'ADD' ? '+' : instruction.op === 'SUB' ? '−' : '×'
    const wrap = instruction.op === 'SUB' && a < b || instruction.op === 'ADD' && a + b > 255 || instruction.op === 'MUL' && a * b > 255
    return `${byteBits(a)} ${operation} ${byteBits(b)} → ${byteBits(result)}  ·  R${first} = ${result}${wrap ? ' (wrapped to 8 bits)' : ''}`
  }
  if (instruction.op === 'LOAD') return `RAM[${second}] = ${after.registers[first?.toUpperCase() ?? 'A']} → R${first}.`
  if (instruction.op === 'STORE') return `R${second} = ${before.registers[second?.toUpperCase() ?? 'A']} → RAM[${first}].`
  if (instruction.op === 'OUT') return `R${first} (${before.registers[first?.toUpperCase() ?? 'A']}) is copied to the output register.`
  if (instruction.op === 'JMP') return `Program counter set to instruction ${addressLabel(after.pc)}.`
  if (instruction.op === 'JNZ') return before.registers[first?.toUpperCase() ?? 'A'] !== 0 ? `R${first} was not zero; program counter jumps to ${addressLabel(after.pc)}.` : `R${first} was zero; execution continues at ${addressLabel(after.pc)}.`
  if (instruction.op === 'HLT') return 'The control unit halted. Reset or load a program to run again.'
  return 'The instruction completed.'
}

function plainInstructionNote(instruction: CpuState['ir'], state: CpuState, phase: 'decode' | 'execute', beforeState?: CpuState) {
  if (!instruction) return 'The computer is waiting for an instruction.'
  const [first, second] = instruction.args
  const left = first?.toUpperCase() ?? 'A'
  const right = second?.toUpperCase() ?? 'A'
  const operands = beforeState ?? state
  const leftValue = operands.registers[left] ?? 0
  const rightValue = operands.registers[right] ?? 0
  if (phase === 'decode') {
    if (instruction.op === 'LDI') return `The computer reads the line: put ${second} into number holder ${first}.`
    if (instruction.op === 'ADD') return `The computer reads the line: add the numbers in ${first} and ${second}.`
    if (instruction.op === 'SUB') return `The computer reads the line: subtract ${second} from ${first}.`
    if (instruction.op === 'MUL') return `The computer reads the line: multiply the numbers in ${first} and ${second}.`
    if (instruction.op === 'OUT') return `The computer reads the line: show the number in ${first}.`
    if (instruction.op === 'LOAD') return `The computer reads the line: copy the value at memory place ${second} into ${first}.`
    if (instruction.op === 'STORE') return `The computer reads the line: save ${second} in memory place ${first}.`
    if (instruction.op === 'HLT') return 'The computer reads the instruction to finish this program.'
    return `The computer reads the instruction ${instruction.source}.`
  }
  if (instruction.op === 'LDI') return `Number holder ${first} now holds ${state.registers[left]}. The computer has stored this number for the next step.`
  if (instruction.op === 'MOV') return `Number holder ${first} now copies ${state.registers[left]} from ${second}.`
  if (instruction.op === 'ADD') return `The math unit adds ${leftValue} + ${rightValue}; number holder ${first} changes to ${state.registers[left]}.`
  if (instruction.op === 'SUB') return `The math unit subtracts ${rightValue} from ${leftValue}; number holder ${first} changes to ${state.registers[left]}.`
  if (instruction.op === 'MUL') return `The math unit multiplies ${leftValue} × ${rightValue}; number holder ${first} changes to ${state.registers[left]}.`
  if (instruction.op === 'OUT') return `The result display now shows ${state.output}, copied from number holder ${first}.`
  if (instruction.op === 'LOAD') return `Memory place ${second} contains ${state.registers[left]}; that value is now in number holder ${first}.`
  if (instruction.op === 'STORE') return `Memory place ${first} now holds ${state.memory[Number(first)] ?? 0}, copied from number holder ${second}.`
  if (instruction.op === 'JMP') return `The next instruction will come from line ${state.pc}.`
  if (instruction.op === 'JNZ') return operands.registers[left] !== 0 ? `${first} is ${operands.registers[left]}, so the computer returns to line ${state.pc}.` : `${first} is 0, so the computer continues to line ${state.pc}.`
  if (instruction.op === 'HLT') return `The computer has finished. The result display stays at ${state.output}.`
  return `The computer completed ${instruction.op}.`
}

export default function InsideMachine({ paused, controlsVisible, stateFromUrl, onShareState, onCloseControls }: ExperimentControls) {
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 720px)').matches)
  const initialProgram = typeof stateFromUrl?.program === 'string' ? stateFromUrl.program : 'sum'
  const [example, setExample] = useState(Object.hasOwn(programs, initialProgram) ? initialProgram : 'sum')
  const [source, setSource] = useState(programs[Object.hasOwn(programs, initialProgram) ? initialProgram : 'sum'].code)
  const [cpu, setCpu] = useState<CpuState>(createCpuState)
  const [autoRun, setAutoRun] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'fetch' | 'decode' | 'execute'>('idle')
  const [stepNote, setStepNote] = useState('Registers hold numbers; memory stores instructions and data. Step to watch the math unit (ALU) add 7 + 5.')
  const [stepDetail, setStepDetail] = useState('Each instruction is fetched from program memory, interpreted, then carried out by the machine.')
  const [clock, setClock] = useState(0)
  const [error, setError] = useState('')
  const [trace, setTrace] = useState<string[]>([])
  const phaseTimers = useRef<number[]>([])
  const cpuRef = useRef(cpu); cpuRef.current = cpu
  const program = useMemo(() => { try { return parseProgram(source) } catch { return [] } }, [source])
  useEffect(() => {
    const query = window.matchMedia('(max-width: 720px)')
    const update = () => setCompact(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  useEffect(() => { onShareState({ program: example }); }, [example, onShareState])

  const runCycle = () => {
    if (!program.length) { setError('This program has no valid instructions.'); return }
    const next = cloneCpu(cpuRef.current)
    phaseTimers.current.forEach((timer) => window.clearTimeout(timer)); phaseTimers.current = []
    const address = next.pc, instruction = fetchCpuInstruction(next, program)
    if (!instruction) { setCpu(next); cpuRef.current = next; setError(next.error ?? ''); setStepNote('The program counter reached the end of ROM.'); setPhase('idle'); return }
    setCpu(next); cpuRef.current = next; setError(next.error ?? '')
    setTrace(next.transfer); setPhase('fetch'); setStepNote(`Reading line ${addressLabel(address)}: “${instruction.source}”.`); setStepDetail(`Fetch: the program counter selects address ${addressLabel(address)} and copies the instruction from ROM into the instruction register.`)
    phaseTimers.current.push(window.setTimeout(() => { const decoding=cloneCpu(cpuRef.current);decodeCpuInstruction(decoding);setCpu(decoding);cpuRef.current=decoding;setTrace(decoding.transfer);setPhase('decode');setStepNote(plainInstructionNote(instruction, decoding, 'decode'));setStepDetail(decodeNote(instruction)) }, 170))
    phaseTimers.current.push(window.setTimeout(() => { const before=cloneCpu(cpuRef.current),executing=cloneCpu(cpuRef.current);executeCpuInstruction(executing);setCpu(executing);cpuRef.current=executing;setError(executing.error??'');setTrace(executing.transfer);setClock((value)=>value+1);setPhase('execute');setStepNote(executing.error ? `The computer stopped: ${executing.error}` : plainInstructionNote(instruction, executing, 'execute', before));setStepDetail(executing.error ? `Fault · ${executing.error}` : executeNote(instruction,before,executing)) }, 340))
    phaseTimers.current.push(window.setTimeout(() => setPhase('idle'), 740))
  }
  useEffect(() => {
    if (!autoRun || paused || cpu.halted || !program.length || error) return
    const timer = window.setInterval(() => { if (!document.hidden) runCycle() }, 960)
    return () => window.clearInterval(timer)
  }, [autoRun, paused, cpu.halted, program, error])
  useEffect(() => () => { phaseTimers.current.forEach((timer) => window.clearTimeout(timer)) }, [])

  const reset = (run = false) => { phaseTimers.current.forEach((timer)=>window.clearTimeout(timer));phaseTimers.current=[];const fresh = createCpuState(); setCpu(fresh); cpuRef.current = fresh; setClock(0);setError(''); setTrace([]); setPhase('idle');setStepNote(example === 'sum' ? 'Registers hold numbers; memory stores instructions and data. Step to watch the math unit (ALU) add 7 + 5.' : 'Program reset. Step once to follow the next instruction.');setStepDetail('Registers are small places to hold numbers. The highlighted program line tells the computer what to do next.');setAutoRun(run) }
  const loadExample = (name: string) => { if(!programs[name])return;phaseTimers.current.forEach((timer)=>window.clearTimeout(timer));phaseTimers.current=[];setExample(name); setSource(programs[name].code); const fresh = createCpuState(); setCpu(fresh); cpuRef.current = fresh;setClock(0); setError(''); setTrace([]); setPhase('idle');setStepNote(name === 'sum' ? 'Registers hold numbers; memory stores instructions and data. Step to watch the math unit (ALU) add 7 + 5.' : `${programs[name].name} is ready. Step through it to follow the data.`);setStepDetail('Registers hold numbers; memory holds program instructions and saved data.');setAutoRun(false) }
  const currentLine = cpu.ir ? Math.max(0, cpu.pc - 1) : cpu.pc
  const lit = (name: string) => trace.includes(name) ? ' signal-hot' : ''

  return <section className="experiment-surface machine-surface" aria-label="Interactive simplified CPU">
    <div className="machine-backdrop" aria-hidden="true"><div className="machine-orbit orbit-a" /><div className="machine-orbit orbit-b" /><div className="machine-grid" /></div>
    <div className="machine-topline"><span className="exp-eyebrow">A SMALL COMPUTER <i /></span><span>CLOCK <b>{clock.toString().padStart(4, '0')}</b></span><span>{cpu.halted ? 'HALTED' : paused ? 'EXHIBIT PAUSED' : autoRun ? 'RUNNING' : clock === 0 ? 'READY TO STEP' : 'STEP MODE'} <i className={cpu.halted ? 'status-off' : ''} /></span></div>
    <div className="machine-rom-mobile"><span>ROM · CURRENT LINE <small>{addressLabel(currentLine)}</small></span><strong>{program[currentLine]?.source ?? 'Program complete'}</strong></div>
    <div className="cpu-stage">
      <div className="program-window machine-glass">
        <div className="machine-window-label"><span>{example === 'sum' ? 'TRY: ADD 7 + 5' : 'PROGRAM · ROM'}</span><span>{example === 'sum' ? 'STEP EACH LINE' : '8-BIT ISA'}</span></div>
        <div className="machine-code-list">{program.length ? program.map((line, index) => <div key={index} className={(index === currentLine && !cpu.halted ? 'pc-active ' : '') + (cpu.halted && index === currentLine ? 'pc-halted' : '')}><small>{index.toString(16).toUpperCase().padStart(2, '0')}</small><code>{line.source}</code>{index === currentLine && !cpu.halted && <i>PC</i>}</div>) : <p className="machine-code-error">{error || 'Write an instruction to begin.'}</p>}</div>
      </div>
      <div className="processor-core">
        <div className="core-caption"><span>PROCESSING UNIT</span><i>{phase === 'idle' ? 'IDLE BETWEEN CLOCKS' : phase.toUpperCase()}</i></div>
        <svg className={'datapath' + (compact ? ' datapath-compact' : '')} viewBox={compact ? '0 0 450 550' : '0 0 1000 620'} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`CPU datapath. Current instruction ${cpu.ir?.source ?? program[currentLine]?.source ?? 'none'}. Register A ${cpu.registers.A}, B ${cpu.registers.B}, C ${cpu.registers.C}, D ${cpu.registers.D}; output ${cpu.output}.`}>
          <defs><filter id="signal-glow"><feGaussianBlur stdDeviation="4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
          {compact ? <g className="machine-buses">
            <path className={'bus-line' + lit('PC')} d="M116 129 H172" />
            <path className={'bus-line' + lit('MEMORY')} d="M282 83 H313 V129 H334" />
            <path className={'bus-line' + lit('IR')} d="M382 161 V203 H76 V230" />
            <path className={'bus-line' + lit('DECODER')} d="M132 264 H174" />
            <path className={'bus-line' + lit('ALU')} d="M284 264 H334" />
            <path className={'bus-line' + lit('BUS')} d="M229 298 V365 H394" />
            <path className={'bus-line register-bus' + (['RA','RB','RC','RD'].some((name)=>trace.includes(name)) ? ' signal-hot' : '')} d="M62 365 H394 M62 365 V380 M170 365 V380 M278 365 V380 M386 365 V380" />
            <path className={'bus-line' + lit('OUTPUT')} d="M62 380 V344 H382 V298" />
          </g> : <g className="machine-buses">
            <path className={'bus-line' + lit('PC')} d="M175 263 H205 V112 H225" />
            <path className={'bus-line' + lit('MEMORY')} d="M380 112 H440" />
            <path className={'bus-line' + lit('IR')} d="M590 112 H650" />
            <path className={'bus-line' + lit('DECODER')} d="M740 162 V220 H525 V270" />
            <path className={'bus-line' + lit('ALU')} d="M620 324 H820" />
            <path className={'bus-line' + lit('BUS')} d="M525 378 V431 H155" />
            <path className={'bus-line register-bus' + (['RA','RB','RC','RD'].some((name)=>trace.includes(name)) ? ' signal-hot' : '')} d="M155 431 H845 M155 431 V455 M385 431 V455 M615 431 V455 M845 431 V455" />
            <path className={'bus-line' + lit('OUTPUT')} d="M155 455 V414 H890 V378" />
          </g>}
          {(compact ? [
            { key:'PC', x:20, y:96, w:96, h:66, value:cpu.pc.toString(16).toUpperCase().padStart(2,'0'), caption:'program counter' },
            { key:'MEMORY', x:172, y:50, w:110, h:66, value:cpu.ir?.source ?? 'ROM / RAM', caption:'program + data' },
            { key:'IR', x:334, y:96, w:96, h:66, value:cpu.ir?.op ?? '—', caption:'instruction register' },
            { key:'DECODER', x:20, y:230, w:112, h:68, value:phase === 'decode' ? 'DECODE' : 'CONTROL', caption:'instruction decoder' },
            { key:'ALU', x:174, y:230, w:110, h:68, value:cpu.ir?.op && ['ADD','SUB','MUL'].includes(cpu.ir.op) ? cpu.ir.op : 'ALU', caption:'arithmetic logic unit' },
            { key:'OUTPUT', x:334, y:230, w:96, h:68, value:dataValue(cpu.output), caption:'output register' },
          ] : [
            { key:'PC', x:30, y:218, w:145, h:90, value:cpu.pc.toString(16).toUpperCase().padStart(2,'0'), caption:'program counter · next address' },
            { key:'MEMORY', x:225, y:67, w:155, h:90, value:cpu.ir?.source ?? 'ROM + RAM', caption:'program + data memory' },
            { key:'IR', x:440, y:67, w:150, h:90, value:cpu.ir?.op ?? '—', caption:'instruction register' },
            { key:'DECODER', x:650, y:67, w:180, h:90, value:phase === 'decode' ? 'DECODE' : 'CONTROL', caption:'instruction decoder' },
            { key:'ALU', x:430, y:270, w:190, h:108, value:cpu.ir?.op && ['ADD','SUB','MUL'].includes(cpu.ir.op) ? cpu.ir.op : 'ALU', caption:'arithmetic logic unit' },
            { key:'OUTPUT', x:820, y:270, w:140, h:108, value:dataValue(cpu.output), caption:'output register' },
          ]).map(({key,x,y,w,h,value,caption}) => <g key={key} className={'machine-block' + (trace.includes(key) ? ' block-active' : '')} transform={`translate(${x} ${y})`}>
            <rect width={w} height={h} rx="11" />
            <text className="block-kicker" x="12" y="22">{key}</text>
            <text className="block-value" x="12" y={compact ? 44 : 53}>{value}</text>
            <text className="block-caption" x="12" y={h - 12}>{caption}</text>
          </g>)}
          {(compact ? ['A','B','C','D'].map((name,index)=>({name,x:14+index*108,y:380,w:96,h:72})) : ['A','B','C','D'].map((name,index)=>({name,x:70+index*220,y:455,w:170,h:92}))).map(({name,x,y,w,h}) => <g key={`R${name}`} className={'register-tile machine-register' + (trace.includes(`R${name}`) ? ' register-active' : '')} transform={`translate(${x} ${y})`}>
            <rect width={w} height={h} rx="9" />
            <text className="register-name" x="11" y="18">REGISTER R{name}</text>
            <text className="register-value" x="11" y={compact ? 43 : 49}>{byteBits(cpu.registers[name])}</text>
            <text className="register-decimal" x={w-10} y={h-9} textAnchor="end">{dataValue(cpu.registers[name])} · {cpu.registers[name]}</text>
          </g>)}
          {phase !== 'idle' && <text x={compact ? 225 : 500} y={compact ? 530 : 592} textAnchor="middle" className="cycle-phase-label">{phase === 'fetch' ? '01   FETCH INSTRUCTION' : phase === 'decode' ? '02   DECODE OPCODE & OPERANDS' : '03   EXECUTE · COMMIT RESULT'}</text>}
        </svg>
        <div className="current-instruction"><span>INSTRUCTION REGISTER</span><strong>{cpu.ir?.source ?? 'Awaiting first clock'}</strong>{cpu.ir && <small>Next address <b>{cpu.pc.toString(16).toUpperCase().padStart(2, '0')}</b></small>}</div>
      </div>
      <div className="machine-memory machine-glass"><div className="machine-window-label"><span>DATA RAM</span><span>16 × 8 BIT</span></div><div className="memory-cells">{cpu.memory.map((value, i) => <div key={i} role="group" aria-label={`Memory address ${i}: ${value}`} className={trace.includes('MEMORY') && cpu.ir?.args.includes(String(i)) ? 'memory-active' : ''}><small>{i.toString(16).toUpperCase()}</small><b>{dataValue(value)}</b></div>)}</div><p>OUTPUT REGISTER <strong>{dataValue(cpu.output)} <i>· {cpu.output}</i></strong></p></div>
    </div>
    <div className="machine-controls"><button className="machine-step" onClick={() => { setAutoRun(false); runCycle() }} disabled={cpu.halted||phase!=='idle'} aria-label="Execute one instruction"><span>▸</span> Step instruction</button><button className="machine-run" onClick={() => setAutoRun((value) => !value)}>{autoRun ? 'Pause clock' : 'Run program'} <span>{autoRun ? 'Ⅱ' : '▶'}</span></button><button className="machine-reset" onClick={() => reset(false)}>Reset</button><span className="machine-cycle-legend"><i className={phase === 'fetch' ? 'phase-active' : ''}>01 FETCH</i><b>→</b><i className={phase === 'decode' ? 'phase-active' : ''}>02 DECODE</i><b>→</b><i className={phase === 'execute' ? 'phase-active' : ''}>03 EXECUTE</i></span></div>
    <div className="machine-live-readout" aria-live="polite">{error ? `FAULT · ${error}` : stepNote}</div>
    <ControlPanel title="Inside the Machine" note="8-bit teaching CPU · 4 registers" visible={controlsVisible} onClose={onCloseControls}>
      <SelectControl label="Example program" value={example} options={[...Object.entries(programs).map(([key, value]) => [key, value.name] as [string,string]), ...(example==='custom' ? [['custom','Custom program'] as [string,string]] : [])]} onChange={loadExample} />
      <details className="machine-step-detail"><summary>How this step works</summary><p>{stepDetail}</p></details>
      <details className="machine-step-detail"><summary>Read the machine's stored numbers</summary><p>Register A holds {cpu.registers.A} ({byteBits(cpu.registers.A)}); B holds {cpu.registers.B} ({byteBits(cpu.registers.B)}); C holds {cpu.registers.C} ({byteBits(cpu.registers.C)}); D holds {cpu.registers.D} ({byteBits(cpu.registers.D)}). The output register shows {cpu.output} ({byteBits(cpu.output)}).</p></details>
      <label className="machine-editor"><span>ASSEMBLY SOURCE</span><textarea spellCheck={false} value={source} onChange={(event) => { setSource(event.target.value); setExample('custom'); reset(false) }} aria-label="Assembly program source" /></label>
      <ActionRow><button className="small-action" onClick={() => { reset(true) }}>Reset & run</button><button className="small-action" onClick={() => { setAutoRun(false); runCycle() }} disabled={cpu.halted||phase!=='idle'}>Step</button><button className="small-action" onClick={() => reset(false)}>Clear state</button></ActionRow>
      <div className="instruction-reference"><span>INSTRUCTION SET</span><p>{instructions.map((instruction) => <code key={instruction}>{instruction}</code>)}</p></div>
      <p className="control-note">Registers hold unsigned 8-bit values. Their tiles show all eight bits and the decimal value. ADD, SUB and MUL wrap modulo 256; jumps address instruction rows. Loading an example leaves it ready to step.</p>
    </ControlPanel>
  </section>
}
