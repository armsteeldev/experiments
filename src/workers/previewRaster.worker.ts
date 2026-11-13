import { rasterMandelbrot, type PreviewPalette } from '../lib/fractalPreview'

type RasterRequest = { key: string; width: number; height: number; palette: PreviewPalette }
type RasterResponse = { key: string; bitmap: ImageBitmap }

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<RasterRequest>) => void) | null
  postMessage: (message: RasterResponse, transfer: Transferable[]) => void
}

scope.onmessage = ({ data }) => {
  const surface = new OffscreenCanvas(data.width, data.height)
  const context = surface.getContext('2d')
  if (!context) return
  const image = context.createImageData(data.width, data.height)
  image.data.set(rasterMandelbrot(data.width, data.height, data.palette))
  context.putImageData(image, 0, 0)
  const bitmap = surface.transferToImageBitmap()
  scope.postMessage({ key: data.key, bitmap }, [bitmap])
}
