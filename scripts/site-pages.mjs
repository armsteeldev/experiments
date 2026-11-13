import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

export const SITE_ORIGIN = 'https://experiments.armsteel.dev'
const SITE_NAME = 'Armsteel Experiments'
const SOCIAL_IMAGE = `${SITE_ORIGIN}/og-image.png`

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character])

const escapeXml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
})[character])

function breadcrumb(...items) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: new URL(item.path, SITE_ORIGIN).href,
    })),
  }
}

function homeStructuredData(experiments) {
  const items = experiments.map((experiment, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: experiment.title,
    url: new URL(`/exhibits/${experiment.id}`, SITE_ORIGIN).href,
  }))
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${SITE_ORIGIN}/#website`,
        url: `${SITE_ORIGIN}/`,
        name: SITE_NAME,
        description: 'A browser-based museum of interactive computational art and science.',
        inLanguage: 'en',
      },
      {
        '@type': 'CollectionPage',
        '@id': `${SITE_ORIGIN}/#collection`,
        url: `${SITE_ORIGIN}/`,
        name: 'The Collection — Armsteel Experiments',
        description: 'Thirteen interactive studies across mathematics, physics, computing, electronics, artificial life, and generative art.',
        isPartOf: { '@id': `${SITE_ORIGIN}/#website` },
        mainEntity: {
          '@type': 'ItemList',
          itemListOrder: 'https://schema.org/ItemListOrderUnordered',
          numberOfItems: items.length,
          itemListElement: items,
        },
      },
    ],
  }
}

function exhibitStructuredData(experiment) {
  const url = new URL(`/exhibits/${experiment.id}`, SITE_ORIGIN).href
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebApplication',
        '@id': `${url}#application`,
        name: experiment.title,
        description: experiment.metaDescription,
        url,
        applicationCategory: 'EducationalApplication',
        operatingSystem: 'Any',
        isAccessibleForFree: true,
        inLanguage: 'en',
      },
      breadcrumb(
        { name: 'Home', path: '/' },
        { name: experiment.title, path: `/exhibits/${experiment.id}` },
      ),
    ],
  }
}

function privacyStructuredData(copy) {
  const url = new URL('/privacy', SITE_ORIGIN).href
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': `${url}#page`,
    name: copy.title,
    description: copy.description,
    url,
    inLanguage: 'en',
    breadcrumb: breadcrumb(
      { name: 'Home', path: '/' },
      { name: 'Privacy', path: '/privacy' },
    ),
  }
}

function seoHead(page) {
  const entries = [
    `<title>${escapeHtml(page.title)}</title>`,
    `<meta name="description" content="${escapeHtml(page.description)}">`,
    `<meta name="robots" content="${escapeHtml(page.robots ?? 'index,follow')}">`,
    `<meta property="og:type" content="${escapeHtml(page.type ?? 'website')}">`,
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    `<meta property="og:title" content="${escapeHtml(page.title)}">`,
    `<meta property="og:description" content="${escapeHtml(page.description)}">`,
    `<meta property="og:image" content="${SOCIAL_IMAGE}">`,
    '<meta property="og:image:type" content="image/png">',
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta property="og:image:alt" content="Armsteel Experiments — Where rules become worlds">',
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${escapeHtml(page.title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(page.description)}">`,
    `<meta name="twitter:image" content="${SOCIAL_IMAGE}">`,
    '<meta name="twitter:image:alt" content="Armsteel Experiments — Where rules become worlds">',
  ]
  if (page.canonical) {
    const canonical = new URL(page.canonical, SITE_ORIGIN).href
    entries.push(`<link rel="canonical" href="${canonical}">`)
    entries.push(`<meta property="og:url" content="${canonical}">`)
  }
  if (page.jsonLd) {
    const json = JSON.stringify(page.jsonLd).replace(/</g, '\\u003c')
    entries.push(`<script id="structured-data" type="application/ld+json">${json}</script>`)
  }
  return entries.join('\n    ')
}

function renderPage(template, page) {
  const cleanTemplate = template
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '')
    .replace(/<meta\b(?=[^>]*\bname=["'](?:description|robots|twitter:[^"']+)["'])[^>]*\/?\s*>/gi, '')
    .replace(/<meta\b(?=[^>]*\bproperty=["']og:[^"']+["'])[^>]*\/?\s*>/gi, '')
    .replace(/<link\b(?=[^>]*\brel=["']canonical["'])[^>]*\/?\s*>/gi, '')
    .replace(/<script\b(?=[^>]*\bid=["']structured-data["'])[^>]*>[\s\S]*?<\/script>/gi, '')
  const withHead = cleanTemplate.replace(/<\/head>/i, `    ${seoHead(page)}\n  </head>`)
  if (!page.fallbackBody) return withHead
  return withHead.replace('<div id="root"></div>', `<div id="root"></div>\n    <div class="static-fallback">${page.fallbackBody}</div>`)
}

function privacyParagraph(value) {
  return escapeHtml(value).replace(/\[(armsteel:favorites|experiments\.armsteel\.dev|email|contact page)\]/g, (_, token) => {
    if (token === 'email') return '<a href="mailto:armsteeldev@outlook.com">armsteeldev@outlook.com</a>'
    if (token === 'contact page') return '<a href="https://armsteel.dev/contact/">Armsteel contact page</a>'
    return `<code>${escapeHtml(token)}</code>`
  })
}

function privacyFallback(copy) {
  const sections = copy.sections.map((section) => `<section><h2>${escapeHtml(section.heading)}</h2>${section.paragraphs.map((text) => `<p>${privacyParagraph(text)}</p>`).join('')}</section>`).join('')
  return `<main class="privacy-content section-wrap"><p class="eyebrow">PRIVACY</p><h1>${escapeHtml(copy.heading)}</h1><p class="privacy-intro">${escapeHtml(copy.intro)}</p>${sections}<p><a href="/">Return to the collection</a></p></main>`
}

function homeFallback(copy, experiments) {
  const studies = experiments.map((item) => `<li><a href="/exhibits/${encodeURIComponent(item.id)}">${escapeHtml(item.title)}</a><p>${escapeHtml(item.metaDescription)}</p></li>`).join('')
  return `<main class="collection-section section-wrap"><h1>${escapeHtml(copy.home.title)}</h1><p>${escapeHtml(copy.home.description)}</p><h2>The collection</h2><ol>${studies}</ol><p><a href="/privacy">Privacy</a></p></main>`
}

function exhibitFallback(experiment, index, count) {
  return `<main class="privacy-content section-wrap"><p class="eyebrow">${escapeHtml(experiment.category)} · ${String(index + 1).padStart(2, '0')} / ${String(count).padStart(2, '0')}</p><h1>${escapeHtml(experiment.title)}</h1><p>${escapeHtml(experiment.metaDescription)}</p><p>${escapeHtml(experiment.method)}</p><p><a href="/">Explore the full collection</a></p></main>`
}

function notFoundFallback(copy) {
  return `<main class="not-found-content section-wrap"><p class="eyebrow">404 · OUTSIDE THE COLLECTION</p><h1>${escapeHtml(copy.notFound.heading)}</h1><p>${escapeHtml(copy.notFound.message)}</p><a href="/">Return to the exhibition</a></main>`
}

async function writeRoute(outDir, pathname, html) {
  const file = pathname === '/' ? resolve(outDir, 'index.html') : resolve(outDir, pathname.slice(1), 'index.html')
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, html)
}

export async function generateSitePages({ rootDir, outDir }) {
  const root = resolve(rootDir)
  const output = resolve(outDir)
  const experiments = JSON.parse(await readFile(resolve(root, 'src/data/experiments.json'), 'utf8'))
  const copy = JSON.parse(await readFile(resolve(root, 'src/data/site-copy.json'), 'utf8'))
  const template = await readFile(resolve(output, 'index.html'), 'utf8')
  const pages = [{
    path: '/',
    title: copy.home.title,
    description: copy.home.description,
    canonical: '/',
    jsonLd: homeStructuredData(experiments),
    fallbackBody: homeFallback(copy, experiments),
  }]

  for (const [index, experiment] of experiments.entries()) {
    const path = `/exhibits/${experiment.id}`
    pages.push({
      path,
      title: `${experiment.title} — Armsteel Experiments`,
      description: experiment.metaDescription,
      canonical: path,
      type: 'article',
      jsonLd: exhibitStructuredData(experiment),
      fallbackBody: exhibitFallback(experiment, index, experiments.length),
    })
  }

  pages.push({
    path: '/privacy',
    title: copy.privacy.title,
    description: copy.privacy.description,
    canonical: '/privacy',
    jsonLd: privacyStructuredData(copy.privacy),
    fallbackBody: privacyFallback(copy.privacy),
  })

  for (const page of pages) await writeRoute(output, page.path, renderPage(template, page))

  const notFound = renderPage(template, {
    title: copy.notFound.title,
    description: copy.notFound.description,
    robots: 'noindex,nofollow',
    fallbackBody: notFoundFallback(copy),
  })
  await writeFile(resolve(output, '404.html'), notFound)

  const urls = pages.map(({ path }) => new URL(path, SITE_ORIGIN).href)
  const sitemap = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((url) => `  <url><loc>${escapeXml(url)}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n')
  await writeFile(resolve(output, 'sitemap.xml'), sitemap)
  await writeFile(resolve(output, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`)
}
