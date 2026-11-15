import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dist = resolve(root, 'dist')
const site = 'https://experiments.armsteel.dev'
const metadata = JSON.parse(await readFile(resolve(root, 'src/data/experiments.json'), 'utf8'))
const registry = await readFile(resolve(root, 'src/registry.ts'), 'utf8')

assert.equal(metadata.length, 19, 'the registry contains the thirteen established exhibits and six Invisible World studies')
assert.deepEqual(metadata.slice(13).map((item) => item.id), ['waves', 'optics', 'sound', 'garden', 'network', 'lensing'], 'the new studies have stable numbered collection order')
assert.equal(new Set(metadata.map((item) => item.id)).size, metadata.length, 'exhibit IDs are unique')
assert.equal(new Set(metadata.map((item) => item.number)).size, metadata.length, 'exhibit numbers are unique')
for (const item of metadata) {
  assert.match(item.id, /^[a-z0-9-]+$/, `${item.id} is a safe route segment`)
  assert.ok(item.title.trim(), `${item.id} has a title`)
  assert.ok(item.metaDescription.trim().length >= 60 && item.metaDescription.length <= 180, `${item.id} has a useful search description`)
  assert.match(registry, new RegExp(`\\b${item.id}:\\s*lazy\\(`), `${item.id} has a lazy component registration`)
  assert.ok((item.related ?? []).every((id) => id !== item.id && metadata.some((candidate) => candidate.id === id)), `${item.id} has valid related-study links`)
}

const readPage = (route) => readFile(resolve(dist, route), 'utf8')
const attribute = (tag, name) => tag?.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'))?.[1]
const findMeta = (html, key, kind = 'name') => {
  const tag = html.match(new RegExp(`<meta\\b(?=[^>]*\\b${kind}="${key}")[^>]*>`, 'i'))?.[0]
  return attribute(tag, 'content')
}
const findCanonical = (html) => {
  const tag = html.match(/<link\b(?=[^>]*\brel="canonical")[^>]*>/i)?.[0]
  return attribute(tag, 'href')
}
const structuredData = (html) => {
  const raw = html.match(/<script\b(?=[^>]*\bid="structured-data")[^>]*>([\s\S]*?)<\/script>/i)?.[1]
  return raw ? JSON.parse(raw) : null
}

const rootHtml = await readPage('index.html')
assert.equal(findCanonical(rootHtml), `${site}/`)
assert.equal(findMeta(rootHtml, 'robots'), 'index,follow')
assert.equal(findMeta(rootHtml, 'og:image', 'property'), `${site}/og-image.png`)
assert.equal(findMeta(rootHtml, 'twitter:card'), 'summary_large_image')
assert.ok(rootHtml.includes('<title>Armsteel Experiments — Where rules become worlds</title>'))
const rootSchema = structuredData(rootHtml)
assert.ok(Array.isArray(rootSchema['@graph']))
assert.ok(rootSchema['@graph'].some((item) => item['@type'] === 'WebSite'))
const collection = rootSchema['@graph'].find((item) => item['@type'] === 'CollectionPage')
assert.equal(collection?.mainEntity?.numberOfItems, metadata.length)
assert.equal((rootHtml.match(/href="\/exhibits\//g) ?? []).length, metadata.length, 'the static homepage exposes every exhibit link')

const seenDescriptions = new Set([findMeta(rootHtml, 'description')])
for (const item of metadata) {
  const route = `exhibits/${item.id}/index.html`
  const html = await readPage(route)
  const canonical = `${site}/exhibits/${item.id}`
  assert.equal(findCanonical(html), canonical, `${item.id} has its own canonical`)
  assert.equal(findMeta(html, 'description'), item.metaDescription, `${item.id} has its registry description`)
  assert.equal(findMeta(html, 'og:url', 'property'), canonical, `${item.id} has the matching social URL`)
  assert.equal(findMeta(html, 'og:title', 'property'), `${item.title} — Armsteel Experiments`)
  assert.equal(findMeta(html, 'og:image', 'property'), `${site}/og-image.png`)
  assert.equal(findMeta(html, 'twitter:card'), 'summary_large_image')
  assert.ok(html.includes(`<h1>${item.title}</h1>`), `${item.id} has a server-rendered heading`)
  assert.ok(!seenDescriptions.has(item.metaDescription), `${item.id} description is unique`)
  seenDescriptions.add(item.metaDescription)
  const schema = structuredData(html)
  assert.ok(schema?.['@graph']?.some((entry) => entry['@type'] === 'WebApplication'))
  assert.ok(schema?.['@graph']?.some((entry) => entry['@type'] === 'BreadcrumbList'))
}

const privacyHtml = await readPage('privacy/index.html')
assert.equal(findCanonical(privacyHtml), `${site}/privacy`)
const siteCopy = JSON.parse(await readFile(resolve(root, 'src/data/site-copy.json'), 'utf8'))
assert.match(privacyHtml, /armsteel:favorites/)
assert.match(privacyHtml, /armsteel:saved-scenes/)
assert.match(privacyHtml, /Living Network includes its message text/)
assert.match(privacyHtml, /private or sensitive information/)
assert.match(privacyHtml, /armsteeldev@outlook\.com/)
assert.ok(privacyHtml.includes(siteCopy.privacy.heading))
assert.ok(structuredData(privacyHtml))

const notFoundHtml = await readPage('404.html')
assert.equal(findMeta(notFoundHtml, 'robots'), 'noindex,nofollow')
assert.equal(findCanonical(notFoundHtml), undefined)
assert.match(notFoundHtml, /This page is not in the collection\./)

const sitemap = await readPage('sitemap.xml')
assert.match(sitemap, /^<\?xml version="1\.0" encoding="UTF-8"\?>/)
assert.match(sitemap, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/)
assert.doesNotMatch(sitemap, /<lastmod>/)
const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])
const expectedUrls = [
  `${site}/`,
  ...metadata.map((item) => `${site}/exhibits/${item.id}`),
  `${site}/privacy`,
].sort()
assert.equal(sitemapUrls.length, expectedUrls.length)
assert.deepEqual([...sitemapUrls].sort(), expectedUrls)
assert.equal(new Set(sitemapUrls).size, sitemapUrls.length)
assert.ok(sitemapUrls.every((url) => url.startsWith(`${site}/`) && !url.includes('?')))

const robots = await readPage('robots.txt')
assert.match(robots, /^User-agent: \*\nAllow: \/\n/m)
assert.match(robots, new RegExp(`^Sitemap: ${site.replaceAll('.', '\\.')}\\/sitemap\\.xml$`, 'm'))
assert.doesNotMatch(robots, /Disallow:/i)

const manifest = JSON.parse(await readPage('site.webmanifest'))
assert.equal(manifest.name, 'Armsteel Experiments')
for (const icon of manifest.icons) await access(resolve(dist, icon.src.slice(1)))
for (const asset of ['favicon.svg', 'apple-touch-icon.png', 'og-image.svg', 'og-image.png']) await access(resolve(dist, asset))

console.log(`Production page checks passed: ${metadata.length} exhibits, ${sitemapUrls.length} canonical URLs, metadata, JSON-LD, icons, robots.txt, and sitemap.xml.`)
