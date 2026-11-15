import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import AmbientField from './components/AmbientField'
import ArtworkPreview from './components/ArtworkPreview'
import ExperimentBoundary from './components/ExperimentBoundary'
import { Icon } from './components/Icon'
import { experiments } from './registry'
import journeyData from './data/journeys.json'
import discoveryConcepts from './data/discovery-concepts.json'
import siteCopy from './data/site-copy.json'
import { decodeState, encodeState, getFavorites, getRecent, getSavedExperiments, rememberVisit, removeSavedExperiment, saveExperimentState, toggleFavorite } from './lib/storage'
import { SITE_ORIGIN, updatePageMetadata } from './lib/metadata'
import type { ExperimentDefinition } from './types'

const experimentIds = experiments.map((item) => item.id)
const homeDescription = siteCopy.home.description

type JourneyStop = { exhibit: string; note: string }
type Journey = { id: string; shortTitle: string; title: string; description: string; stops: JourneyStop[] }
const journeys = journeyData as Journey[]

function journeyHref(journeyId: string, exhibitId: string) {
  const query = new URLSearchParams({ journey: journeyId })
  return `/exhibits/${encodeURIComponent(exhibitId)}?${query.toString()}`
}

function savedExperimentHref(experimentId: string, state: Record<string, unknown>) {
  const encoded = encodeState(state)
  const query = new URLSearchParams()
  if (encoded) query.set('state', encoded)
  return `/exhibits/${encodeURIComponent(experimentId)}${encoded ? `?${query.toString()}` : ''}`
}

function collectionStructuredData() {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${SITE_ORIGIN}/#website`,
        url: `${SITE_ORIGIN}/`,
        name: 'Armsteel Experiments',
        description: 'A browser-based museum of interactive computational art and science.',
        inLanguage: 'en',
      },
      {
        '@type': 'CollectionPage',
        '@id': `${SITE_ORIGIN}/#collection`,
        url: `${SITE_ORIGIN}/`,
        name: 'The Collection — Armsteel Experiments',
        description: homeDescription,
        isPartOf: { '@id': `${SITE_ORIGIN}/#website` },
        mainEntity: {
          '@type': 'ItemList',
          itemListOrder: 'https://schema.org/ItemListOrderUnordered',
          numberOfItems: experiments.length,
          itemListElement: experiments.map((item, index) => ({
            '@type': 'ListItem', position: index + 1, name: item.title,
            url: `${SITE_ORIGIN}/exhibits/${item.id}`,
          })),
        },
      },
    ],
  }
}

function experimentStructuredData(experiment: ExperimentDefinition) {
  const path = `/exhibits/${experiment.id}`
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebApplication',
        '@id': `${SITE_ORIGIN}${path}#application`,
        name: experiment.title,
        description: experiment.metaDescription,
        url: `${SITE_ORIGIN}${path}`,
        applicationCategory: 'EducationalApplication',
        operatingSystem: 'Any',
        isAccessibleForFree: true,
        inLanguage: 'en',
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_ORIGIN}/` },
          { '@type': 'ListItem', position: 2, name: experiment.title, item: `${SITE_ORIGIN}${path}` },
        ],
      },
    ],
  }
}

function Brand() {
  return <Link className="brand" to="/" aria-label="Armsteel Experiments — exhibition entrance">
    <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
    <span className="brand-words"><strong>ARMSTEEL</strong><small>EXPERIMENTS</small></span>
  </Link>
}

function Header() {
  return <header className="site-header">
    <Brand />
    <nav className="header-nav" aria-label="Main navigation">
      <Link to="/#collection" className="header-link">Collection <span aria-hidden="true">↘</span></Link>
      <Link to="/privacy" className="header-link">Privacy</Link>
    </nav>
  </header>
}

function FavoriteButton({ id, favorites, onToggle }: { id: string; favorites: string[]; onToggle: (id: string) => void }) {
  const selected = favorites.includes(id)
  const title = experiments.find((item) => item.id === id)?.title ?? 'study'
  return <button className={'favorite-button' + (selected ? ' selected' : '')} onClick={() => onToggle(id)} aria-label={selected ? `Remove ${title} from favourites` : `Add ${title} to favourites`} aria-pressed={selected} title={selected ? 'Remove from favourites' : 'Save to favourites'}>
    <Icon name="heart" />
  </button>
}

function normalized(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()
}

function Exhibition() {
  const [filter, setFilter] = useState<string>('All works')
  const [query, setQuery] = useState('')
  const [favorites, setFavorites] = useState<string[]>(() => getFavorites(experimentIds))
  const [savedExperiments, setSavedExperiments] = useState(() => getSavedExperiments(experimentIds))
  const [searchOpen, setSearchOpen] = useState(false)
  const [selectedJourneyId, setSelectedJourneyId] = useState(journeys[0]?.id ?? '')
  const navigate = useNavigate()
  const searchRef = useRef<HTMLInputElement>(null)
  const searchButtonRef = useRef<HTMLButtonElement>(null)
  const recent = getRecent()
  const filters = useMemo(() => ['All works', ...new Set(experiments.map((item) => item.category)), 'Favourites'], [])
  const shown = useMemo(() => {
    const needle = normalized(query.trim())
    return experiments.filter((item) => {
      const matchesFilter = filter === 'All works' || (filter === 'Favourites' ? favorites.includes(item.id) : item.category === filter)
      const haystack = normalized([item.title, item.category, item.description, item.subtitle, item.about, item.method, item.metaDescription, ...item.concepts].join(' '))
      return matchesFilter && (!needle || haystack.includes(needle))
    })
  }, [filter, query, favorites])
  const recentlyViewed = recent.map((id) => experiments.find((item) => item.id === id)).filter((item): item is ExperimentDefinition => !!item)
  const selectedJourney = journeys.find((journey) => journey.id === selectedJourneyId) ?? journeys[0]
  const selectedJourneyStops = selectedJourney?.stops.map((stop) => ({
    ...stop,
    experiment: experiments.find((item) => item.id === stop.exhibit),
  })).filter((stop): stop is JourneyStop & { experiment: ExperimentDefinition } => Boolean(stop.experiment)) ?? []
  const showJourneys = filter === 'All works' && !query.trim()
  const featured = filter === 'All works' && !query.trim() ? experiments.find((item) => item.featured) : undefined
  const gridItems = featured ? shown.filter((item) => item.id !== featured.id) : shown

  useEffect(() => updatePageMetadata({
    title: 'Armsteel Experiments — Where rules become worlds',
    description: homeDescription,
    canonical: '/',
    jsonLd: collectionStructuredData(),
  }), [])

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus()
  }, [searchOpen])

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
      }
      if (event.key === 'Escape' && searchOpen) {
        setSearchOpen(false)
        searchButtonRef.current?.focus()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [searchOpen])

  const discover = () => {
    const unseen = experiments.filter((item) => !recent.includes(item.id))
    const pool = unseen.length ? unseen : experiments
    const choice = pool[Math.floor(Math.random() * pool.length)]
    if (choice) navigate('/exhibits/' + choice.id)
  }
  const favorite = (id: string) => setFavorites(toggleFavorite(id, experimentIds))
  const removeSaved = (id: string) => setSavedExperiments(removeSavedExperiment(id, experimentIds).experiments)

  return <main className="exhibition-page">
    <a className="skip-link" href="#collection">Skip to collection</a>
    <AmbientField />
    <div className="ambient-grain" aria-hidden="true" />
    <Header />

    <section className="hero-shell portal-hero" aria-labelledby="entrance-title">
      <div className="hero-study-art" aria-hidden="true"><ArtworkPreview id="attractors" live /></div>
      <div className="hero-copy">
        <h1 id="entrance-title"><span>Where rules</span><br /><span>become <em>worlds.</em></span></h1>
        <p className="hero-description">{siteCopy.home.intro}</p>
        <a href="#collection" className="glass-cta">Explore the collection <Icon name="arrow" /></a>
      </div>
    </section>

    <section className="collection-section section-wrap" id="collection" aria-labelledby="collection-title">
      <div className="section-heading collection-heading">
        <div><p className="eyebrow"><span className="eyebrow-rule" /> THE COLLECTION</p><h2 id="collection-title">Choose a world.</h2></div>
        <div className="collection-tools">
          <button ref={searchButtonRef} className="quiet-button" onClick={() => setSearchOpen((value) => !value)} aria-label={searchOpen ? 'Close collection search' : 'Search the collection'} aria-expanded={searchOpen} aria-controls="collection-search">
            <Icon name={searchOpen ? 'close' : 'search'} /><span>{searchOpen ? 'Close search' : 'Find a study'}</span><kbd>CTRL / ⌘ K</kbd>
          </button>
          <button className="quiet-button" onClick={discover} aria-label="Surprise me with a study"><Icon name="shuffle" /><span>Surprise me</span></button>
        </div>
      </div>
      {searchOpen && <div className="search-panel" id="collection-search" role="search">
        <Icon name="search" />
        <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="A pattern, a feeling, a name…" aria-label="Search studies by name, discipline or idea" aria-controls="gallery-grid" />
        {query && <button className="search-clear" onClick={() => setQuery('')} aria-label="Clear search"><Icon name="close" /></button>}
        <kbd>ESC</kbd>
      </div>}
      {searchOpen && !query.trim() && <div className="search-ideas" role="group" aria-label="Explore the collection by idea">
        <span>START WITH AN IDEA</span>
        {discoveryConcepts.map(({ term, label }) => <button key={term} type="button" onClick={() => setQuery(term)} aria-pressed={normalized(query.trim()) === normalized(term)}>{label}</button>)}
      </div>}
      <div className="filter-row" role="group" aria-label="Filter the collection by discipline">
        {filters.map((item) => <button key={item} className={'filter-chip' + (filter === item ? ' active' : '')} onClick={() => setFilter(item)} aria-pressed={filter === item}>
          {item}{item === 'Favourites' && favorites.length > 0 ? <span>{favorites.length}</span> : null}
        </button>)}
        <span className="result-count" aria-live="polite">{String(shown.length).padStart(2, '0')} {shown.length === 1 ? 'STUDY' : 'STUDIES'}</span>
      </div>

      {featured && <article className="featured-piece">
        <Link to={'/exhibits/' + featured.id} className="featured-art-link" aria-label={`Enter ${featured.title}: ${featured.description}`}>
          <ArtworkPreview id={featured.id} />
          <span className="featured-shade" aria-hidden="true" />
          <span className="featured-copy">
            <span className="featured-kicker">{featured.number} <i>·</i> {featured.category}</span>
            <strong>{featured.title}</strong>
            <span className="featured-subtitle">{featured.subtitle}</span>
            <span className="featured-enter">Enter this world <Icon name="arrow" /></span>
          </span>
          <span className="featured-mark" aria-hidden="true"><Icon name="arrow" /></span>
        </Link>
        <FavoriteButton id={featured.id} favorites={favorites} onToggle={favorite} />
      </article>}

      {showJourneys && selectedJourney && selectedJourneyStops.length > 0 && <section className="journey-section" id="journeys" aria-labelledby="journeys-heading">
        <div className="journey-intro">
          <p className="eyebrow"><span className="eyebrow-rule" /> CURATED PATHS</p>
          <h2 id="journeys-heading">Follow an idea.</h2>
          <p>Short walks through connected worlds. Start at the beginning or open any stop that catches your eye.</p>
        </div>
        <div className="journey-content">
          <div className="journey-tabs" role="group" aria-label="Choose a curated path">
            {journeys.map((journey) => <button key={journey.id} type="button" onClick={() => setSelectedJourneyId(journey.id)} aria-pressed={selectedJourney.id === journey.id}>
              {journey.shortTitle}
            </button>)}
          </div>
          <div className="journey-panel" aria-labelledby="journey-title" data-journey-id={selectedJourney.id}>
            <div className="journey-panel-heading">
              <div><span>{selectedJourneyStops.length} stops</span><h3 id="journey-title">{selectedJourney.title}</h3></div>
              <p>{selectedJourney.description}</p>
            </div>
            <ol className="journey-route" style={{ '--journey-stop-count': selectedJourneyStops.length } as React.CSSProperties}>
              {selectedJourneyStops.map(({ note, experiment }, index) => <li key={experiment.id}>
                <Link to={journeyHref(selectedJourney.id, experiment.id)} aria-label={`Open stop ${index + 1} of ${selectedJourneyStops.length}: ${experiment.title}. ${note}`}>
                  <span className="journey-step-number">{String(index + 1).padStart(2, '0')}</span>
                  <span className="journey-step-copy"><strong>{experiment.title}</strong><small>{note}</small></span>
                </Link>
              </li>)}
            </ol>
            <Link className="journey-begin" to={journeyHref(selectedJourney.id, selectedJourneyStops[0].experiment.id)}>
              Begin with {selectedJourneyStops[0].experiment.title} <Icon name="arrow" />
            </Link>
          </div>
        </div>
      </section>}

      {savedExperiments.length > 0 && <section className="saved-experiments" aria-labelledby="saved-experiments-heading">
        <div className="saved-experiments-heading">
          <div><p className="eyebrow"><span className="eyebrow-rule" /> YOUR NOTEBOOK</p><h2 id="saved-experiments-heading">Keep a particular setup.</h2></div>
          <p>Settings saved on this device. A running simulation’s full history is not included.</p>
        </div>
        <div className="saved-experiments-grid">
          {savedExperiments.map((saved) => {
            const item = experiments.find((candidate) => candidate.id === saved.exhibitId)
            if (!item) return null
            return <article className="saved-experiment-card" key={saved.id}>
              <Link to={savedExperimentHref(saved.exhibitId, saved.state)}>
                <span>{item.number} <i>·</i> {item.title} <time dateTime={saved.savedAt}>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(saved.savedAt))}</time></span>
                <strong>{saved.name}</strong>
                <small>Open these settings <Icon name="arrow" /></small>
              </Link>
              <button type="button" onClick={() => removeSaved(saved.id)} aria-label={`Remove saved setup ${saved.name}`} title="Remove saved setup"><Icon name="close" /></button>
            </article>
          })}
        </div>
      </section>}

      {gridItems.length ? <div className="gallery-grid" id="gallery-grid" aria-live="polite">
        {gridItems.map((item, index) => <article className="gallery-card" key={item.id} style={{ '--card-index': index } as React.CSSProperties}>
          <div className="card-art">
            <Link to={'/exhibits/' + item.id} className="card-art-link" aria-label={`Enter ${item.title}: ${item.description}`}>
              <ArtworkPreview id={item.id} />
              <span className="card-index" aria-hidden="true">{item.number}</span>
              <span className="card-open" aria-hidden="true"><Icon name="arrow" /></span>
            </Link>
            <FavoriteButton id={item.id} favorites={favorites} onToggle={favorite} />
          </div>
          <div className="card-meta"><span>{item.category}</span></div>
          <Link to={'/exhibits/' + item.id} className="card-title-link"><h3>{item.title}</h3></Link>
          <p className="card-subtitle">{item.subtitle}</p>
        </article>)}
      </div> : <div className="empty-state" role="status">
        <span className="empty-glyph" aria-hidden="true">∅</span>
        <p>{filter === 'Favourites' && favorites.length === 0 ? 'Saved studies will gather here.' : 'No studies found in this corner of the gallery.'}</p>
        {filter === 'Favourites' && favorites.length === 0 && <small>Use the heart on any artwork to keep it close.</small>}
        <button className="text-link" onClick={() => { setFilter('All works'); setQuery('') }}>Return to all works <Icon name="arrow" /></button>
      </div>}
    </section>

    {recentlyViewed.length > 0 && <section className="recent-section section-wrap" aria-labelledby="recent-heading">
      <div className="recent-label"><p className="eyebrow"><span className="eyebrow-rule" /> YOUR TRAIL</p><h2 id="recent-heading">Return to a study.</h2></div>
      <div className="recent-list">{recentlyViewed.slice(0, 4).map((item) => <Link to={'/exhibits/' + item.id} key={item.id}>
        <span>{item.number}</span><strong>{item.title}</strong><small>{item.category}</small><Icon name="arrow" />
      </Link>)}</div>
    </section>}
    <footer className="portal-footer section-wrap"><Brand /><span>{experiments.length} studies · One living collection</span><Link to="/privacy">Privacy</Link></footer>
  </main>
}

type Overlay = 'controls' | 'info' | 'selector'

function ExhibitPage() {
  const { id } = useParams()
  const experiment = experiments.find((item) => item.id === id)
  if (!experiment) return <NotFoundPage />
  return <ExhibitExperience experiment={experiment} />
}

function ExhibitExperience({ experiment }: { experiment: ExperimentDefinition }) {
  const navigate = useNavigate()
  const location = useLocation()
  const stageRef = useRef<HTMLElement>(null)
  const stateRef = useRef<Record<string, unknown>>({})
  const overlayReturnFocus = useRef<HTMLElement | null>(null)
  const keepJourneyOpen = useRef(false)
  const [paused, setPaused] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [documentVisible, setDocumentVisible] = useState(() => !document.hidden)
  const [activeOverlay, setActiveOverlay] = useState<Overlay | null>(null)
  const [interfaceVisible, setInterfaceVisible] = useState(true)
  const [isFavorite, setIsFavorite] = useState(() => getFavorites(experimentIds).includes(experiment.id))
  const [fullscreen, setFullscreen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [savedName, setSavedName] = useState(`${experiment.title} settings`)
  const [savedMessage, setSavedMessage] = useState('')
  const captureState = useCallback((state: Record<string, unknown>) => { stateRef.current = state }, [])
  const requestedJourneyId = new URLSearchParams(location.search).get('journey')
  const activeJourney = journeys.find((journey) => journey.id === requestedJourneyId && journey.stops.some((stop) => stop.exhibit === experiment.id))
  const journeyIndex = activeJourney?.stops.findIndex((stop) => stop.exhibit === experiment.id) ?? -1
  const previousJourneyStop = journeyIndex > 0 ? activeJourney?.stops[journeyIndex - 1] : undefined
  const nextJourneyStop = activeJourney && journeyIndex >= 0 ? activeJourney.stops[journeyIndex + 1] : undefined
  const previousJourneyExperiment = previousJourneyStop ? experiments.find((item) => item.id === previousJourneyStop.exhibit) : undefined
  const nextJourneyExperiment = nextJourneyStop ? experiments.find((item) => item.id === nextJourneyStop.exhibit) : undefined

  useEffect(() => {
    rememberVisit(experiment.id, experimentIds)
    setIsFavorite(getFavorites(experimentIds).includes(experiment.id))
    setPaused(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    setSavedName(`${experiment.title} settings`)
    setSavedMessage('')
    if (!keepJourneyOpen.current) setActiveOverlay(null)
    keepJourneyOpen.current = false
    setInterfaceVisible(true)
    stateRef.current = {}
    const path = `/exhibits/${experiment.id}`
    updatePageMetadata({
      title: `${experiment.title} — Armsteel Experiments`,
      description: experiment.metaDescription,
      canonical: path,
      type: 'article',
      jsonLd: experimentStructuredData(experiment),
    })
  }, [experiment.id])

  useEffect(() => {
    document.body.classList.add('immersive-active')
    return () => document.body.classList.remove('immersive-active')
  }, [])

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setPaused(preference.matches)
    preference.addEventListener('change', update)
    return () => preference.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const visibility = () => setDocumentVisible(!document.hidden)
    document.addEventListener('visibilitychange', visibility)
    return () => document.removeEventListener('visibilitychange', visibility)
  }, [])

  useEffect(() => {
    const update = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', update)
    return () => document.removeEventListener('fullscreenchange', update)
  }, [])

  useEffect(() => {
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && !target.closest('.experience-dock, .floating-panel, .interface-reveal')) setActiveOverlay(null)
    }
    document.addEventListener('pointerdown', dismissOutside)
    return () => document.removeEventListener('pointerdown', dismissOutside)
  }, [])

  useEffect(() => {
    if (!activeOverlay) return
    const panelId = activeOverlay === 'controls' ? 'experiment-controls' : activeOverlay === 'selector' ? 'experiment-selector' : 'experiment-information'
    let cancelled = false
    let frame = 0
    let timeout = 0
    let observer: MutationObserver | null = null
    const focusPanel = () => {
      if (cancelled) return false
      const panel = document.getElementById(panelId)
      const target = panel?.querySelector<HTMLElement>('button, input, select, [tabindex="0"]')
      if (!panel || !target || panel.hasAttribute('inert') || panel.getAttribute('aria-hidden') === 'true') return false
      target.focus({ preventScroll: true })
      observer?.disconnect()
      if (timeout) window.clearTimeout(timeout)
      return true
    }
    observer = new MutationObserver(() => { focusPanel() })
    observer.observe(stageRef.current ?? document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-hidden', 'inert'] })
    frame = requestAnimationFrame(() => {
      if (focusPanel()) return
      timeout = window.setTimeout(() => observer?.disconnect(), 2500)
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      if (timeout) window.clearTimeout(timeout)
      observer?.disconnect()
    }
  }, [activeOverlay, experiment?.id])

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target
      const element = target instanceof Element ? target : null
      const editing = element?.closest('input, textarea, select, [contenteditable="true"], [role="slider"]')
      if (event.key === 'Escape') {
        if (activeOverlay) {
          setActiveOverlay(null)
          requestAnimationFrame(() => overlayReturnFocus.current?.focus())
          event.preventDefault()
        } else if (document.fullscreenElement) {
          void document.exitFullscreen()
        } else {
          setInterfaceVisible(true)
        }
        return
      }
      if (event.key.toLowerCase() === 'h' && !editing) {
        event.preventDefault()
        setInterfaceVisible((value) => !value)
        setActiveOverlay(null)
        return
      }
      if (editing || element?.closest('button, a')) return
      if (activeOverlay && activeOverlay !== 'selector' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) return
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        const index = experiments.findIndex((item) => item.id === experiment?.id)
        if (index >= 0) navigate('/exhibits/' + experiments[(index + (event.key === 'ArrowRight' ? 1 : -1) + experiments.length) % experiments.length].id)
      } else if (event.code === 'Space') {
        event.preventDefault()
        setPaused((value) => !value)
      } else if (event.key.toLowerCase() === 'f') {
        event.preventDefault()
        const node = stageRef.current
        if (document.fullscreenElement) void document.exitFullscreen()
        else if (node) void node.requestFullscreen()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [activeOverlay, experiment?.id, navigate])

  const share = async () => {
    const url = new URL(window.location.href)
    const parameters = encodeState(stateRef.current)
    if (parameters) url.searchParams.set('state', parameters)
    try {
      await navigator.clipboard.writeText(url.toString())
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      window.prompt('Copy this exhibit link', url.toString())
    }
  }
  const saveCurrentSettings = () => {
    const result = saveExperimentState(experiment.id, savedName, stateRef.current, experimentIds)
    if (result.status === 'saved') setSavedMessage('Saved in this browser.')
    else if (result.status === 'memory-only') setSavedMessage('Saved for this tab. Browser storage is unavailable.')
    else if (result.status === 'full') setSavedMessage('Notebook full. Remove a saved setup before adding another.')
    else if (result.status === 'too-large') setSavedMessage('These settings exceed the notebook’s storage limit.')
    else setSavedMessage('This setup could not be saved. Its settings may be empty or unsupported.')
  }
  const visit = (targetId: string) => { setActiveOverlay(null); navigate('/exhibits/' + targetId) }
  const move = (delta: number) => {
    const index = experiments.findIndex((item) => item.id === experiment.id)
    visit(experiments[(index + delta + experiments.length) % experiments.length].id)
  }
  const random = () => {
    const recentIds = getRecent(experimentIds)
    const choices = experiments.filter((item) => item.id !== experiment.id && !recentIds.includes(item.id))
    const pool = choices.length ? choices : experiments.filter((item) => item.id !== experiment.id)
    const choice = pool[Math.floor(Math.random() * pool.length)]
    if (choice) visit(choice.id)
  }
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else if (stageRef.current) void stageRef.current.requestFullscreen()
  }
  const overlay = (value: Overlay) => {
    if (activeOverlay === value) setActiveOverlay(null)
    else {
      overlayReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setActiveOverlay(value)
    }
  }
  const closeOverlay = () => {
    setActiveOverlay(null)
    requestAnimationFrame(() => overlayReturnFocus.current?.focus())
  }
  const Component = experiment.Component

  return <main ref={stageRef} className={'exhibit-page environment-' + experiment.id} aria-label={experiment.title + ' immersive experiment'} onPointerMove={(event) => { if (!interfaceVisible && event.clientY > window.innerHeight - 112) setInterfaceVisible(true) }}>
    <div className="environment-aura" aria-hidden="true" />
    <div className="experiment-viewport">
      <ExperimentBoundary key={experiment.id}>
        <Suspense fallback={<div className="experience-loading" role="status"><span className="loading-orbit" aria-hidden="true" /><span>Opening {experiment.title}</span></div>}>
          <Component paused={paused || !documentVisible} controlsVisible={activeOverlay === 'controls'} stateFromUrl={decodeState(location.search)} onShareState={captureState} onCloseControls={closeOverlay} />
        </Suspense>
      </ExperimentBoundary>
    </div>

    {activeOverlay === 'info' && <section id="experiment-information" className="info-panel floating-panel glass-material" role="region" aria-labelledby="experiment-info-title">
      <button className="panel-close" onClick={closeOverlay} aria-label="Close information" title="Close information"><Icon name="close" /></button>
      <span className="info-category">{experiment.category} <i>·</i> {experiment.number} / {String(experiments.length).padStart(2, '0')}</span>
      <h1 id="experiment-info-title">{experiment.title}</h1>
      <p>{experiment.description}</p>
      {activeJourney && journeyIndex >= 0 && <section className="journey-current" aria-label={`Curated path ${activeJourney.title}`} data-journey-id={activeJourney.id} data-journey-step={journeyIndex + 1}>
        <div className="journey-current-heading">
          <span>{activeJourney.shortTitle} · {String(journeyIndex + 1).padStart(2, '0')} / {String(activeJourney.stops.length).padStart(2, '0')}</span>
          <div role="progressbar" aria-label={`Progress through ${activeJourney.title}`} aria-valuemin={1} aria-valuemax={activeJourney.stops.length} aria-valuenow={journeyIndex + 1} style={{ '--journey-progress': `${((journeyIndex + 1) / activeJourney.stops.length) * 100}%` } as React.CSSProperties} />
        </div>
        <h2>{activeJourney.title}</h2>
        <p>{activeJourney.stops[journeyIndex].note}</p>
        <nav aria-label={`Navigate ${activeJourney.title}`}>
          {previousJourneyExperiment && <Link to={journeyHref(activeJourney.id, previousJourneyExperiment.id)} onClick={(event) => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) keepJourneyOpen.current = true }} aria-label={`Previous in this thread: ${previousJourneyExperiment.title}`}><span>←</span> Previous</Link>}
          {nextJourneyExperiment && <Link to={journeyHref(activeJourney.id, nextJourneyExperiment.id)} onClick={(event) => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) keepJourneyOpen.current = true }} aria-label={`Continue this thread to ${nextJourneyExperiment.title}`}>Next · {nextJourneyExperiment.title} <span>→</span></Link>}
          {!nextJourneyExperiment && <Link to="/" aria-label="Return to the collection after completing this thread">Thread complete · Return to the collection <span>→</span></Link>}
          <Link to={`/exhibits/${experiment.id}`} className="journey-exit" aria-label="Continue exploring without this curated path">Explore freely</Link>
        </nav>
      </section>}
      <details className="info-reading"><summary>Read the underlying idea</summary><p>{experiment.about}</p></details>
      {experiment.related?.length ? <nav className="related-studies" aria-label="Related experiments"><span>FOLLOW THIS THREAD</span><div>{experiment.related.map((id) => experiments.find((item) => item.id === id)).filter((item): item is ExperimentDefinition => !!item).map((item) => <Link key={item.id} to={'/exhibits/' + item.id}><small>{item.number}</small><strong>{item.title}</strong><Icon name="arrow" /></Link>)}</div></nav> : null}
      <div className="info-method"><span>UNDERLYING IDEA</span><strong>{experiment.method}</strong></div>
      <section className="saved-experiment-save" aria-labelledby="saved-experiment-form-heading">
        <label id="saved-experiment-form-heading" htmlFor="saved-experiment-name">Save these settings</label>
        <div><input id="saved-experiment-name" value={savedName} maxLength={64} onChange={(event) => { setSavedName(event.target.value); setSavedMessage('') }} aria-describedby="saved-experiment-note" />
          <button type="button" onClick={saveCurrentSettings} disabled={!savedName.trim()}>Save</button></div>
        <p id="saved-experiment-note">Presets and settings are saved. A running simulation’s full history is not.{experiment.id === 'network' ? ' The message is included, so avoid private text.' : ''}{experiment.id === 'machine' ? ' Your edited assembly is included when you save or share; avoid private comments.' : ''}{experiment.id === 'gravity' ? ' A changed system’s body positions, velocities and masses replay from the last edit; trails and collision history restart.' : ''}{experiment.id === 'logic' ? ' Your gates, wires, switch values and build goal are included; signal values are recalculated.' : ''}{experiment.id === 'forces' ? ' Your charge arrangement and field framing are included; released test particles and their trails restart empty.' : ''}{experiment.id === 'boids' ? ' Placed field marks and the random seed are included; flock positions and trails start fresh.' : ''}{experiment.id === 'automata' ? ' Your last drawn cell arrangement is included and restarts at generation zero; cell ages and trails are not.' : ''}{experiment.id === 'reaction' ? ' The selected start pattern and seed are included; painted marks and evolved chemistry start fresh.' : ''}{experiment.id === 'fluid' ? ' The starting flow and settings are included; hand-drawn strokes and evolved dye are not.' : ''}</p>
        {savedMessage && <p className="saved-experiment-status" role="status">{savedMessage}</p>}
      </section>
      <div className="info-actions">
        <button onClick={() => setIsFavorite(toggleFavorite(experiment.id, experimentIds).includes(experiment.id))} aria-pressed={isFavorite}><Icon name="heart" />{isFavorite ? 'Saved to exhibition' : 'Save to exhibition'}</button>
        <button onClick={() => { void share() }}><Icon name="share" />{copied ? 'Link copied' : 'Share this experiment'}</button>
      </div>
    </section>}

    {activeOverlay === 'selector' && <div id="experiment-selector" className="experiment-selector floating-panel glass-material" role="dialog" aria-modal="false" aria-label="Choose an experiment">
      <div className="selector-heading"><span>MOVE TO A WORLD</span><button onClick={random} className="selector-surprise"><Icon name="shuffle" /> Surprise me</button><kbd>ESC</kbd></div>
      <div className="selector-list">
        {experiments.map((item) => <button key={item.id} className={item.id === experiment.id ? 'selected' : ''} onClick={() => visit(item.id)} aria-current={item.id === experiment.id ? 'page' : undefined}>
          <span>{item.number}</span><strong>{item.title}</strong><small>{item.category}</small>{item.id === experiment.id && <i>HERE</i>}
        </button>)}
      </div>
    </div>}

    <button className="interface-reveal glass-material" onClick={() => setInterfaceVisible(true)} aria-label="Show experiment controls" hidden={interfaceVisible}><Icon name="menu" /><span>Show controls</span></button>
    <div className={'experience-chrome' + (interfaceVisible ? '' : ' chrome-hidden')} aria-hidden={!interfaceVisible} inert={!interfaceVisible}>
      <nav className="experience-dock glass-material" aria-label="Experiment navigation and controls">
        <button className="dock-button dock-home" onClick={() => navigate('/')} aria-label="Return to exhibition" title="Return to exhibition" data-tooltip="Exhibition">
          <Icon name="back" /><span className="dock-home-label">Exhibition</span>
        </button>
        <span className="dock-divider" aria-hidden="true" />
        <button className="dock-button dock-step" onClick={() => move(-1)} aria-label="Previous experiment" title="Previous experiment · ←" data-tooltip="Previous"><Icon name="back" /></button>
        <button className="dock-current" onClick={() => overlay('selector')} aria-expanded={activeOverlay === 'selector'} aria-controls="experiment-selector" aria-label={'Choose experiment. Current experiment: ' + experiment.title} title="Choose an experiment">
          <small>{experiment.number}</small><span>{experiment.title}</span><Icon name="chevron" />
        </button>
        <button className="dock-button dock-step" onClick={() => move(1)} aria-label="Next experiment" title="Next experiment · →" data-tooltip="Next"><Icon name="arrow" /></button>
        <button className="dock-button dock-random" onClick={random} aria-label="Surprise me with another experiment" title="Surprise me" data-tooltip="Surprise me"><Icon name="shuffle" /></button>
        <span className="dock-divider dock-actions-divider" aria-hidden="true" />
        <button className={'dock-button' + (activeOverlay === 'controls' ? ' is-active' : '')} onClick={() => overlay('controls')} aria-label="Toggle experiment controls" aria-expanded={activeOverlay === 'controls'} aria-controls="experiment-controls" title="Experiment controls" data-tooltip="Controls"><Icon name="sliders" /></button>
        <button className={'dock-button' + (activeOverlay === 'info' ? ' is-active' : '')} onClick={() => overlay('info')} aria-label="Toggle experiment information" aria-expanded={activeOverlay === 'info'} aria-controls="experiment-information" title="About this experiment" data-tooltip="About"><Icon name="info" /></button>
        <button className="dock-button" onClick={() => setPaused((value) => !value)} aria-label={paused ? 'Resume experiment' : 'Pause experiment'} aria-pressed={paused} title={paused ? 'Resume · Space' : 'Pause · Space'} data-tooltip={paused ? 'Resume' : 'Pause'}><Icon name={paused ? 'play' : 'pause'} /></button>
        <button className="dock-button" onClick={toggleFullscreen} aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} aria-pressed={fullscreen} title="Fullscreen · F" data-tooltip="Fullscreen"><Icon name={fullscreen ? 'collapse' : 'expand'} /></button>
      </nav>
      <span className="keyboard-hint" aria-hidden="true">HIDE INTERFACE · H</span>
    </div>
  </main>
}

function PrivacyPage() {
  useEffect(() => updatePageMetadata({
    title: siteCopy.privacy.title,
    description: siteCopy.privacy.description,
    canonical: '/privacy',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      '@id': `${SITE_ORIGIN}/privacy#page`,
      name: siteCopy.privacy.title,
      description: siteCopy.privacy.description,
      url: `${SITE_ORIGIN}/privacy`,
      inLanguage: 'en',
      breadcrumb: {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_ORIGIN}/` },
          { '@type': 'ListItem', position: 2, name: 'Privacy', item: `${SITE_ORIGIN}/privacy` },
        ],
      },
    },
  }), [])

  const renderParagraph = (paragraph: string) => paragraph.split(/\[(armsteel:favorites|armsteel:saved-scenes|experiments\.armsteel\.dev|email|contact page)\]/g).map((part, index) => {
    if (part === 'armsteel:favorites' || part === 'armsteel:saved-scenes' || part === 'experiments.armsteel.dev') return <code key={index}>{part}</code>
    if (part === 'email') return <a key={index} href="mailto:armsteeldev@outlook.com">armsteeldev@outlook.com</a>
    if (part === 'contact page') return <a key={index} href="https://armsteel.dev/contact/">Armsteel contact page</a>
    return part
  })

  return <div className="information-page privacy-page">
    <a className="skip-link" href="#privacy-content">Skip to privacy information</a>
    <Header />
    <main id="privacy-content" className="privacy-content section-wrap" aria-labelledby="privacy-title">
      <p className="eyebrow"><span className="eyebrow-rule" /> PRIVACY</p>
      <h1 id="privacy-title">{siteCopy.privacy.heading}</h1>
      <p className="privacy-intro">{siteCopy.privacy.intro}</p>
      {siteCopy.privacy.sections.map((section) => <section key={section.heading} aria-labelledby={`privacy-${section.heading.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
        <h2 id={`privacy-${section.heading.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>{section.heading}</h2>
        {section.paragraphs.map((paragraph) => <p key={paragraph}>{renderParagraph(paragraph)}</p>)}
      </section>)}
    </main>
    <footer className="portal-footer section-wrap"><Brand /><span>Armsteel Experiments</span><Link to="/">Return to the collection</Link></footer>
  </div>
}

function NotFoundPage() {
  useEffect(() => updatePageMetadata({
    title: siteCopy.notFound.title,
    description: siteCopy.notFound.description,
    robots: 'noindex,nofollow',
  }), [])

  return <div className="information-page not-found-page">
    <a className="skip-link" href="#not-found-content">Skip to page message</a>
    <Header />
    <main id="not-found-content" className="not-found-content section-wrap" aria-labelledby="not-found-title">
      <p className="eyebrow"><span className="eyebrow-rule" /> 404 · OUTSIDE THE COLLECTION</p>
      <h1 id="not-found-title">{siteCopy.notFound.heading}</h1>
      <p>{siteCopy.notFound.message}</p>
      <Link className="glass-cta" to="/">Return to the exhibition <Icon name="arrow" /></Link>
    </main>
    <footer className="portal-footer section-wrap"><Brand /><span>Armsteel Experiments</span><Link to="/privacy">Privacy</Link></footer>
  </div>
}

export default function App() {
  const location = useLocation()
  useEffect(() => {
    document.documentElement.classList.add('app-mounted')
  }, [])
  useEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView()
    else window.scrollTo({ top: 0, behavior: 'instant' })
  }, [location.pathname, location.hash])
  return <Routes>
    <Route path="/" element={<Exhibition />} />
    <Route path="/exhibits/:id" element={<ExhibitPage />} />
    <Route path="/privacy" element={<PrivacyPage />} />
    <Route path="*" element={<NotFoundPage />} />
  </Routes>
}
