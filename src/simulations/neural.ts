export type Activation = 'tanh' | 'sigmoid' | 'relu'
export type NeuralLayer = { weights: number[][]; biases: number[] }
export type NeuralNetwork = { sizes: number[]; layers: NeuralLayer[] }
export type Sample = { x: number[]; y: number }
const sigmoid = (x: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, x))))
const activate = (x: number, fn: Activation) => fn === 'tanh' ? Math.tanh(x) : fn === 'relu' ? Math.max(0, x) : sigmoid(x)
const derivative = (output: number, fn: Activation) => fn === 'tanh' ? 1 - output * output : fn === 'relu' ? (output > 0 ? 1 : 0) : output * (1 - output)

export function createNetwork(sizes: number[], seed = 7): NeuralNetwork {
  if (sizes.length < 2 || sizes.some((size) => !Number.isInteger(size) || size < 1 || size > 12)) throw new Error('Network layers must contain 1–12 neurons')
  let value = seed >>> 0
  const random = () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 4294967296 }
  const layers = sizes.slice(1).map((count, i) => ({
    weights: Array.from({ length: count }, () => Array.from({ length: sizes[i] }, () => (random() * 2 - 1) * Math.sqrt(2 / sizes[i]))),
    biases: Array(count).fill(0).map(() => (random() * 2 - 1) * 0.12),
  }))
  return { sizes: [...sizes], layers }
}

export function forwardNetwork(network: NeuralNetwork, input: number[], activation: Activation = 'tanh') {
  if (input.length !== network.sizes[0]) throw new Error(`Expected ${network.sizes[0]} input values`)
  const activations = [input.slice()]
  for (const layer of network.layers) {
    const previous = activations[activations.length - 1]
    activations.push(layer.weights.map((weights, row) => activate(weights.reduce((sum, weight, col) => sum + weight * previous[col], layer.biases[row]), activation)))
  }
  return { output: activations[activations.length - 1], activations }
}

export function trainNetworkStep(network: NeuralNetwork, samples: readonly Sample[], activation: Activation = 'tanh', rate = 0.08) {
  let loss = 0
  for (const sample of samples) {
    const { output, activations } = forwardNetwork(network, sample.x, activation)
    const target = activation === 'tanh' ? sample.y * 2 - 1 : sample.y
    const error = output[0] - target
    loss += 0.5 * error * error
    const deltas: number[][] = Array(network.layers.length)
    let last = network.layers.length - 1
    deltas[last] = [error * derivative(output[0], activation)]
    for (let layerIndex = last - 1; layerIndex >= 0; layerIndex--) {
      const layer = network.layers[layerIndex], next = network.layers[layerIndex + 1]
      deltas[layerIndex] = layer.biases.map((_, neuron) => {
        let downstream = 0
        for (let j = 0; j < next.weights.length; j++) downstream += next.weights[j][neuron] * deltas[layerIndex + 1][j]
        return downstream * derivative(activations[layerIndex + 1][neuron], activation)
      })
    }
    for (let layerIndex = 0; layerIndex < network.layers.length; layerIndex++) {
      const layer = network.layers[layerIndex], prior = activations[layerIndex]
      for (let neuron = 0; neuron < layer.weights.length; neuron++) {
        for (let inputIndex = 0; inputIndex < prior.length; inputIndex++) layer.weights[neuron][inputIndex] -= rate * deltas[layerIndex][neuron] * prior[inputIndex]
        layer.biases[neuron] -= rate * deltas[layerIndex][neuron]
      }
    }
  }
  return loss / Math.max(1, samples.length)
}

export function accuracy(network: NeuralNetwork, samples: readonly Sample[], activation: Activation = 'tanh') {
  let correct = 0
  for (const sample of samples) if ((forwardNetwork(network, sample.x, activation).output[0] >= (activation === 'tanh' ? 0 : .5)) === (sample.y >= 0.5)) correct++
  return correct / Math.max(1, samples.length)
}
