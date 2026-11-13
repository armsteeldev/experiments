import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { generateSitePages } from './scripts/site-pages.mjs'

function staticSitePages(): Plugin {
  let rootDir = process.cwd()
  let outDir = resolve(rootDir, 'dist')

  return {
    name: 'armsteel-static-site-pages',
    apply: 'build' as const,
    configResolved(config) {
      rootDir = config.root
      outDir = resolve(config.root, config.build.outDir)
    },
    async closeBundle() {
      await generateSitePages({ rootDir, outDir })
    },
  }
}

export default defineConfig({
  plugins: [react(), staticSitePages()],
  build: { target: 'es2022' },
})
