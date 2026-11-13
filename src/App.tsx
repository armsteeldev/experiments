import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import AmbientField from './components/AmbientField'
import ArtworkPreview from './components/ArtworkPreview'
import ExperimentBoundary from './components/ExperimentBoundary'
import { Icon } from './components/Icon'
import { experiments } from './registry'
import { decodeState, encodeState, getFavorites, getRecent, rememberVisit, toggleFavorite } from './lib/storage'
import type { ExperimentDefinition } from './types'

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
      <a href="#collection" className="header-link">Collection <span aria-hidden="true">↘</span></a>
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

function updateMetadata(title: string, description: string) {
  document.title = title
  const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]')
  if (meta) meta.content = description
  document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.setAttribute('content', title)
  document.querySelector<HTMLMetaElement>('meta[property="og:description"]')?.setAttribute('content', description)
  document.querySelector<HTMLMetaElement>('meta[name="twitter:title"]')?.setAttribute('content', title)
  document.querySelector<HTMLMetaElement>('meta[name="twitter:description"]')?.setAttribute('content', description)
}

function Exhibition() {
  const [filter, setFilter] = useState<string>('All works')
  const [query, setQuery] = useState('')
  const [favorites, setFavorites] = useState<string[]>(getFavorites)
  const [searchOpen, setSearchOpen] = useState(false)
  const navigate = useNavigate()
  const searchRef = useRef<HTMLInputElement>(null)
  const searchButtonRef = useRef<HTMLButtonElement>(null)
  const recent = getRecent()
  const filters = useMemo(() => ['All works', ...new Set(experiments.map((item) => item.category)), 'Favourites'], [])
  const shown = useMemo(() => {
    const needle = normalized(query.trim())
    return experiments.filter((item) => {
      const matchesFilter = filter === 'All works' || (filter === 'Favourites' ? favorites.includes(item.id) : item.category === filter)
      const haystack = normalized([item.title, item.category, item.description, item.subtitle, item.method].join(' '))
      return matchesFilter && (!needle || haystack.includes(needle))
    })
  }, [filter, query, favorites])
  const recentlyViewed = recent.map((id) => experiments.find((item) => item.id === id)).filter((item): item is ExperimentDefinition => !!item)
  const featured = filter === 'All works' && !query.trim() ? experiments.find((item) => item.featured) : undefined
  const gridItems = featured ? shown.filter((item) => item.id !== featured.id) : shown

  useEffect(() => {
    updateMetadata('Armsteel Experiments — Where rules become worlds', 'Enter a living collection of interactive experiments in mathematics, physics, computing and artificial life.')
  }, [])

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
  const favorite = (id: string) => setFavorites(toggleFavorite(id))

  return <main className="exhibition-page">
    <AmbientField />
    <div className="ambient-grain" aria-hidden="true" />
    <Header />

    <section className="hero-shell portal-hero" aria-labelledby="entrance-title">
      <div className="hero-copy">
        <h1 id="entrance-title"><span>Where rules</span><br /><span>become <em>worlds.</em></span></h1>
        <p className="hero-description">An interactive museum of computational beauty.</p>
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
    <footer className="portal-footer section-wrap"><Brand /><span>{experiments.length} studies · One living collection</span></footer>
  </main>
}

type Overlay = 'controls' | 'info' | 'selector'

function ExhibitPage() {
  const { id } = useParams()
  const experiment = experiments.find((item) => item.id === id)
  const navigate = useNavigate()
  const location = useLocation()
  const stageRef = useRef<HTMLElement>(null)
  const stateRef = useRef<Record<string, unknown>>({})
  const overlayReturnFocus = useRef<HTMLElement | null>(null)
  const [paused, setPaused] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [documentVisible, setDocumentVisible] = useState(() => !document.hidden)
  const [activeOverlay, setActiveOverlay] = useState<Overlay | null>(null)
  const [interfaceVisible, setInterfaceVisible] = useState(true)
  const [isFavorite, setIsFavorite] = useState(() => experiment ? getFavorites().includes(experiment.id) : false)
  const [fullscreen, setFullscreen] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (experiment) {
      rememberVisit(experiment.id)
      setIsFavorite(getFavorites().includes(experiment.id))
      setPaused(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      setActiveOverlay(null)
      setInterfaceVisible(true)
      stateRef.current = {}
      updateMetadata(`${experiment.title} — Armsteel Experiments`, `${experiment.description} Explore ${experiment.method} in an interactive, full-screen study.`)
    }
  }, [experiment?.id])

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
    const frame = requestAnimationFrame(() => document.getElementById(panelId)?.querySelector<HTMLElement>('button, input, select, [tabindex="0"]')?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
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

  if (!experiment) return <Navigate to="/" replace />

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
  const visit = (targetId: string) => { setActiveOverlay(null); navigate('/exhibits/' + targetId) }
  const move = (delta: number) => {
    const index = experiments.findIndex((item) => item.id === experiment.id)
    visit(experiments[(index + delta + experiments.length) % experiments.length].id)
  }
  const random = () => {
    const recentIds = getRecent()
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
          <Component paused={paused || !documentVisible} controlsVisible={activeOverlay === 'controls'} stateFromUrl={decodeState(location.search)} onShareState={(state) => { stateRef.current = state }} onCloseControls={closeOverlay} />
        </Suspense>
      </ExperimentBoundary>
    </div>

    {activeOverlay === 'info' && <section id="experiment-information" className="info-panel floating-panel glass-material" role="region" aria-labelledby="experiment-info-title">
      <button className="panel-close" onClick={closeOverlay} aria-label="Close information" title="Close information"><Icon name="close" /></button>
      <span className="info-category">{experiment.category} <i>·</i> {experiment.number} / {String(experiments.length).padStart(2, '0')}</span>
      <h1 id="experiment-info-title">{experiment.title}</h1>
      <p>{experiment.description}</p>
      <details className="info-reading"><summary>Read the underlying idea</summary><p>{experiment.about}</p></details>
      <div className="info-method"><span>UNDERLYING IDEA</span><strong>{experiment.method}</strong></div>
      <div className="info-actions">
        <button onClick={() => setIsFavorite(toggleFavorite(experiment.id).includes(experiment.id))} aria-pressed={isFavorite}><Icon name="heart" />{isFavorite ? 'Saved to exhibition' : 'Save to exhibition'}</button>
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

export default function App() {
  const location = useLocation()
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }) }, [location.pathname])
  return <Routes>
    <Route path="/" element={<Exhibition />} />
    <Route path="/exhibits/:id" element={<ExhibitPage />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
}
