import { readFile } from 'node:fs/promises'

const supervisorPid = Number(process.env.ARMSTEEL_QA_SUPERVISOR_PID)
let managed = Number.isInteger(supervisorPid) && supervisorPid === process.ppid

if (managed && process.platform === 'linux') {
  const parentCommand = await readFile('/proc/' + process.ppid + '/cmdline', 'utf8').catch(() => '')
  managed = parentCommand.includes('run-browser-qa.mjs')
}

if (!managed) {
  console.error('Browser QA scripts must run through npm run qa:<name>; direct execution skips resource limits and cleanup.')
  process.exit(1)
}
