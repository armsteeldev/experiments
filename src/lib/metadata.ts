export const SITE_ORIGIN = 'https://experiments.armsteel.dev'
export const SOCIAL_IMAGE = `${SITE_ORIGIN}/og-image.png`

export type PageMetadata = {
  title: string
  description: string
  canonical?: string
  robots?: string
  type?: 'website' | 'article'
  jsonLd?: unknown
}

function setMeta(attribute: 'name' | 'property', key: string, value: string | undefined) {
  const selector = `meta[${attribute}="${key}"]`
  let element = document.head.querySelector<HTMLMetaElement>(selector)
  if (!value) {
    element?.remove()
    return
  }
  if (!element) {
    element = document.createElement('meta')
    element.setAttribute(attribute, key)
    document.head.append(element)
  }
  element.content = value
}

export function updatePageMetadata(page: PageMetadata) {
  document.documentElement.lang = 'en'
  document.title = page.title
  setMeta('name', 'description', page.description)
  setMeta('name', 'robots', page.robots ?? 'index,follow')
  setMeta('property', 'og:type', page.type ?? 'website')
  setMeta('property', 'og:site_name', 'Armsteel Experiments')
  setMeta('property', 'og:title', page.title)
  setMeta('property', 'og:description', page.description)
  setMeta('property', 'og:url', page.canonical)
  setMeta('property', 'og:image', SOCIAL_IMAGE)
  setMeta('property', 'og:image:type', 'image/png')
  setMeta('property', 'og:image:width', '1200')
  setMeta('property', 'og:image:height', '630')
  setMeta('property', 'og:image:alt', 'Armsteel Experiments — Where rules become worlds')
  setMeta('name', 'twitter:card', 'summary_large_image')
  setMeta('name', 'twitter:title', page.title)
  setMeta('name', 'twitter:description', page.description)
  setMeta('name', 'twitter:image', SOCIAL_IMAGE)
  setMeta('name', 'twitter:image:alt', 'Armsteel Experiments — Where rules become worlds')

  let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (page.canonical) {
    if (!canonical) {
      canonical = document.createElement('link')
      canonical.rel = 'canonical'
      document.head.append(canonical)
    }
    canonical.href = new URL(page.canonical, SITE_ORIGIN).href
  } else {
    canonical?.remove()
  }

  let structuredData = document.head.querySelector<HTMLScriptElement>('#structured-data')
  if (page.jsonLd) {
    if (!structuredData) {
      structuredData = document.createElement('script')
      structuredData.id = 'structured-data'
      structuredData.type = 'application/ld+json'
      document.head.append(structuredData)
    }
    structuredData.textContent = JSON.stringify(page.jsonLd)
  } else {
    structuredData?.remove()
  }
}
