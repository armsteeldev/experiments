export type Opcode = 'LDI' | 'MOV' | 'ADD' | 'SUB' | 'MUL' | 'LOAD' | 'STORE' | 'OUT' | 'JMP' | 'JNZ' | 'HLT'
export type Instruction = { op: Opcode; args: string[]; source: string }
export type CpuState = { registers: Record<string, number>; pc: number; ir: Instruction | null; memory: number[]; output: number; halted: boolean; cycles: number; transfer: string[]; error: string | null }
const opcodes = new Set<Opcode>(['LDI', 'MOV', 'ADD', 'SUB', 'MUL', 'LOAD', 'STORE', 'OUT', 'JMP', 'JNZ', 'HLT'])

export function parseProgram(source: string): Instruction[] {
  return source.split(/\r?\n/).map((line) => line.split(';')[0].trim()).filter(Boolean).map((line) => {
    const [head, ...rest] = line.split(/\s+/), op = head.toUpperCase() as Opcode
    if (!opcodes.has(op)) throw new Error(`Unknown instruction: ${head}`)
    return { op, args: rest.join(' ').split(',').map((arg) => arg.trim()).filter(Boolean), source: line }
  })
}
export function createCpuState(): CpuState {
  return { registers: { A: 0, B: 0, C: 0, D: 0 }, pc: 0, ir: null, memory: Array(16).fill(0), output: 0, halted: false, cycles: 0, transfer: [], error: null }
}
const register = (cpu: CpuState, name: string) => {
  const key = name?.toUpperCase()
  if (!(key in cpu.registers)) throw new Error(`Unknown register: ${name}`)
  return key
}
const addressOf = (token: string) => {
  const address = Number(token)
  if (!Number.isInteger(address) || address < 0 || address > 15) throw new Error(`Memory address must be 0–15: ${token}`)
  return address
}

export function fetchCpuInstruction(cpu: CpuState, program: readonly Instruction[]) {
  cpu.transfer = []; cpu.error = null
  if (cpu.halted) return null
  if (cpu.pc < 0 || cpu.pc >= program.length) { cpu.halted = true; cpu.transfer = ['PC', 'HALT']; return null }
  const instruction = program[cpu.pc]
  cpu.ir = instruction
  cpu.transfer.push('PC', 'MEMORY', 'IR')
  cpu.pc++
  return instruction
}

export function decodeCpuInstruction(cpu: CpuState) {
  if (!cpu.ir || cpu.halted) return cpu
  cpu.transfer = ['IR', 'DECODER']
  return cpu
}

export function executeCpuInstruction(cpu: CpuState) {
  if (!cpu.ir || cpu.halted) return cpu
  cpu.transfer = ['DECODER']
  const instruction = cpu.ir
  try {
    const [first, second] = instruction.args
    switch (instruction.op) {
      case 'LDI': { const target = register(cpu, first), immediate = Number(second); if (!Number.isFinite(immediate)) throw new Error('LDI expects a numeric constant'); cpu.registers[target] = immediate & 255; cpu.transfer.push('IMMEDIATE', 'BUS', `R${target}`); break }
      case 'MOV': { const target = register(cpu, first), source = register(cpu, second); cpu.registers[target] = cpu.registers[source]; cpu.transfer.push(`R${source}`, 'BUS', `R${target}`); break }
      case 'ADD': case 'SUB': case 'MUL': {
        const target = register(cpu, first), source = register(cpu, second), a = cpu.registers[target], b = cpu.registers[source]
        cpu.registers[target] = (instruction.op === 'ADD' ? a + b : instruction.op === 'SUB' ? a - b : a * b) & 255
        cpu.transfer.push(`R${target}`, 'ALU', `R${source}`, 'ALU', 'BUS', `R${target}`); break
      }
      case 'LOAD': { const target = register(cpu, first), address = addressOf(second); cpu.registers[target] = cpu.memory[address]; cpu.transfer.push('MEMORY', 'BUS', `R${target}`); break }
      case 'STORE': { const address = addressOf(first), source = register(cpu, second); cpu.memory[address] = cpu.registers[source]; cpu.transfer.push(`R${source}`, 'BUS', 'MEMORY'); break }
      case 'OUT': { const source = register(cpu, first); cpu.output = cpu.registers[source]; cpu.transfer.push(`R${source}`, 'BUS', 'OUTPUT'); break }
      case 'JMP': cpu.pc = addressOf(first); cpu.transfer.push('PC', 'DECODER', 'PC'); break
      case 'JNZ': { const source = register(cpu, first); if (cpu.registers[source] !== 0) cpu.pc = addressOf(second); cpu.transfer.push(`R${source}`, 'DECODER', 'PC'); break }
      case 'HLT': cpu.halted = true; cpu.transfer.push('DECODER', 'HALT'); break
    }
    cpu.cycles++
  } catch (error) {
    cpu.error = error instanceof Error ? error.message : String(error)
    cpu.halted = true
  }
  return cpu
}

export function executeCpuCycle(cpu: CpuState, program: readonly Instruction[]) {
  fetchCpuInstruction(cpu, program)
  decodeCpuInstruction(cpu)
  executeCpuInstruction(cpu)
  return cpu
}
