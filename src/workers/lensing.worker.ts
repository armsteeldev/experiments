import { createLensingTable, rasterizeLensedSky } from '../simulations/lensing'

type Request =
  | { type: 'table'; requestId: number; mass: number; maxImpact: number; samples: number }
  | { type: 'sky'; requestId: number; width: number; height: number; distance: number; sourceRatio: number }
const scope = self as unknown as { onmessage: ((event: MessageEvent<Request>) => void) | null; postMessage: (message: unknown, transfer?: Transferable[]) => void }
let table: ReturnType<typeof createLensingTable> | null = null

scope.onmessage = ({ data }) => {
  if (data.type === 'table') {
    table = createLensingTable(data.mass, data.maxImpact, data.samples)
    scope.postMessage({ type: 'table', requestId: data.requestId, table })
  } else if (table) {
    const pixels = rasterizeLensedSky(table, data.width, data.height, data.distance, data.sourceRatio)
    scope.postMessage({ type: 'sky', requestId: data.requestId, width: data.width, height: data.height, pixels: pixels.buffer }, [pixels.buffer])
  }
}
