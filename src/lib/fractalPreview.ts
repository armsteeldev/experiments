export type PreviewPalette = readonly [string, string, string]

export function rasterMandelbrot(width: number, height: number, palette: PreviewPalette) {
  const colors = palette.map((color) => [
    parseInt(color.slice(1, 3), 16),
    parseInt(color.slice(3, 5), 16),
    parseInt(color.slice(5, 7), 16),
  ])
  const pixels = new Uint8ClampedArray(width * height * 4)

  for (let y = 0; y < height; y++) {
    const ci = (y / height - 0.5) * 2.5
    for (let x = 0; x < width; x++) {
      const cr = (x / width - 0.5) * 3.7 - 0.45
      let zr = 0, zi = 0, iteration = 0
      while (zr * zr + zi * zi < 36 && iteration < 48) {
        const next = zr * zr - zi * zi + cr
        zi = 2 * zr * zi + ci
        zr = next
        iteration++
      }
      const offset = (y * width + x) * 4
      if (iteration < 48) {
        const shade = (iteration * 0.37 + Math.log2(Math.max(1, Math.log2(zr * zr + zi * zi))) * 0.28) % 1
        const color = colors[Math.floor(shade * 3) % 3]
        const intensity = 0.22 + 0.68 * (1 - shade * 0.8)
        pixels[offset] = color[0] * intensity
        pixels[offset + 1] = color[1] * intensity
        pixels[offset + 2] = color[2] * intensity
      } else {
        pixels[offset] = 5
        pixels[offset + 1] = 9
        pixels[offset + 2] = 15
      }
      pixels[offset + 3] = 255
    }
  }

  return pixels
}
