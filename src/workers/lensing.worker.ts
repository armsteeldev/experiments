import { createLensingTableCooperative, rasterizeLensedSkyCooperative, type LensingTable } from '../simulations/lensing'

type Request =
  | { type: 'table'; requestId: number; mass: number; maxImpact: number; samples: number }
  | { type: 'sky'; requestId: number; width: number; height: number; distance: number; sourceRatio: number }
  | { type: 'cancel'; target?: 'table' | 'sky' | 'all' }
const scope = self as unknown as { onmessage: ((event: MessageEvent<Request>) => void) | null; postMessage: (message: unknown, transfer?: Transferable[]) => void }
let table: LensingTable | null = null
let activeTableRequest = 0, activeSkyRequest = 0

scope.onmessage = ({ data }) => {
  if (data.type === 'cancel') {
    const target = data.target ?? 'all'
    if (target === 'table' || target === 'all') { activeTableRequest++; table = null }
    if (target === 'sky' || target === 'all') activeSkyRequest++
    return
  }
  if (data.type === 'table') {
    activeTableRequest = data.requestId
    activeSkyRequest++
    table = null
    void createLensingTableCooperative(data.mass, data.maxImpact, data.samples, () => activeTableRequest !== data.requestId)
      .then((created) => {
        if (!created || activeTableRequest !== data.requestId) return
        table = created
        scope.postMessage({ type: 'table', requestId: data.requestId, table: created })
      })
  } else if (table) {
    const currentTable = table, tableRequest = activeTableRequest
    activeSkyRequest = data.requestId
    void rasterizeLensedSkyCooperative(currentTable, data.width, data.height, data.distance, data.sourceRatio, () => activeSkyRequest !== data.requestId || activeTableRequest !== tableRequest || table !== currentTable)
      .then((pixels) => {
        if (!pixels || activeSkyRequest !== data.requestId || table !== currentTable) return
        scope.postMessage({ type: 'sky', requestId: data.requestId, width: data.width, height: data.height, pixels: pixels.buffer }, [pixels.buffer])
      })
  }
}
