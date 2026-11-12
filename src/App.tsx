import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import AmbientField from './components/AmbientField'
import ArtworkPreview from './components/ArtworkPreview'
import { Icon } from './components/Icon'
import { categories, experiments, type Filter } from './registry'
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

function Exhibition() {
  const [filter, setFilter] = useState<Filter>('All works')
  const [query, setQuery] = useState('')
  const [favorites, setFavorites] = useState<string[]>(getFavorites)
  const recent = getRecent()
  const recentArrivals = experiments.filter((item) => item.updated === 'Just added').slice(0, 3)
  const [searchOpen, setSearchOpen] = useState(false)
  const navigate = useNavigate()
  const searchRef = useRef<HTMLInputElement>(null)
  const shown = useMemo(() => experiments.filter((item) => {
    const matchesFilter = filter === 'All works' || (filter === 'Favourites' ? favorites.includes(item.id) : item.category === filter)
    const haystack = [item.title, item.category, item.description, item.subtitle].join(' ').toLowerCase()
    return matchesFilter && haystack.includes(query.toLowerCase().trim())
  }), [filter, query, favorites])
  const recentlyViewed = recent.map((id) => experiments.find((item) => item.id === id)).filter((item): item is ExperimentDefinition => !!item)

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus()
  }, [searchOpen])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearchOpen(true) }
      if (event.key === 'Escape') setSearchOpen(false)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  const discover = () => navigate('/exhibits/' + experiments[Math.floor(Math.random() * experiments.length)].id)
  const favorite = (id: string) => setFavorites(toggleFavorite(id))

  return <main className="exhibition-page">
    <AmbientField />
    <div className="ambient-grain" />
    <Header />

    <section className="hero-shell portal-hero" aria-labelledby="entrance-title">
      <div className="hero-copy">
        <h1 id="entrance-title"><span>Where rules</span><br /><span>become <em>worlds.</em></span></h1>
        <p className="hero-description">An interactive museum of computational beauty.</p>
        <a href="#collection" className="glass-cta">Explore the collection <Icon name="arrow" /></a>
      </div>
    </section>

    <section className="collection-section section-wrap" id="collection">
      <div className="section-heading collection-heading">
        <div><p className="eyebrow"><span className="eyebrow-rule" /> THE COLLECTION</p><h2>Choose a world.</h2></div>
        <div className="collection-tools">
          <button className="quiet-button" onClick={() => { setSearchOpen((value) => !value); setTimeout(() => searchRef.current?.focus(), 0) }} aria-label="Search the collection"><Icon name={searchOpen ? 'close' : 'search'} /><span>Find a study</span></button>
          <button className="quiet-button" onClick={discover}><Icon name="shuffle" /><span>Surprise me</span></button>
        </div>
      </div>
      {searchOpen && <div className="search-panel"><Icon name="search" /><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="A pattern, a feeling, a name…" aria-label="Search experiments" /><kbd>ESC</kbd></div>}
      <div className="filter-row" aria-label="Filter by category">
        {categories.map((item) => <button key={item} className={'filter-chip' + (filter === item ? ' active' : '')} onClick={() => setFilter(item)}>{item}{item === 'Favourites' && favorites.length > 0 ? <span>{favorites.length}</span> : null}</button>)}
        <span className="result-count">{shown.length.toString().padStart(2, '0')} STUDIES</span>
      </div>
      {shown.length ? <div className="gallery-grid">
        {shown.map((item, index) => <article className={'gallery-card card-' + item.id} key={item.id} style={{ '--card-index': index } as React.CSSProperties}>
          <div className="card-art">
          <Link to={'/exhibits/' + item.id} className="card-art-link" aria-label={'Enter ' + item.title + ': ' + item.description}><ArtworkPreview id={item.id} live /><span className="card-open"><Icon name="arrow" /></span></Link>
            <button className={'favorite-button' + (favorites.includes(item.id) ? ' selected' : '')} onClick={() => favorite(item.id)} aria-label={favorites.includes(item.id) ? 'Remove from favourites' : 'Add to favourites'} aria-pressed={favorites.includes(item.id)}><Icon name="heart" /></button>
          </div>
          <div className="card-meta"><span>{item.category}</span></div>
          <Link to={'/exhibits/' + item.id} className="card-title-link"><h3>{item.title}</h3></Link>
        </article>)}
      </div> : <div className="empty-state"><span className="empty-glyph">∅</span><p>No studies found in this corner of the gallery.</p><button className="text-link" onClick={() => { setFilter('All works'); setQuery('') }}>Return to all works <Icon name="arrow" /></button></div>}
      {filter === 'All works' && !query.trim() && recentArrivals.length > 0 && <div className="new-arrivals" aria-label="Recent arrivals">
        <div className="new-arrivals-heading"><h3>Recent arrivals</h3></div>
        <div className="new-arrivals-list">{recentArrivals.map((item) => <Link className="new-arrival" to={'/exhibits/' + item.id} key={item.id}><span>{item.title}</span><Icon name="arrow" /></Link>)}</div>
      </div>}
    </section>
    {recentlyViewed.length > 0 && <section className="recent-section section-wrap">
      <div className="recent-label"><p className="eyebrow"><span className="eyebrow-rule" /> RECENTLY VISITED</p></div>
      <div className="recent-list">{recentlyViewed.slice(0, 4).map((item) => <Link to={'/exhibits/' + item.id} key={item.id}><span>{item.number}</span><strong>{item.title}</strong><small>{item.category}</small><Icon name="arrow" /></Link>)}</div>
    </section>}
    <footer className="portal-footer section-wrap"><Brand /><span>Six systems. No two worlds alike.</span></footer>
  </main>
}

function ExhibitPage() {
  const { id } = useParams()
  const experiment = experiments.find((item) => item.id === id)
  const navigate = useNavigate()
  const location = useLocation()
  const stageRef = useRef<HTMLElement>(null)
  const stateRef = useRef<Record<string, unknown>>({})
  const [paused, setPaused] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [activeOverlay, setActiveOverlay] = useState<'controls' | 'info' | 'selector' | null>(null)
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
    }
  }, [experiment?.id])
  useEffect(() => { if (id && !experiment) navigate('/', { replace: true }) }, [id, experiment, navigate])
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
    const update = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', update)
    return () => document.removeEventListener('fullscreenchange', update)
  }, [])
  useEffect(() => {
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && !target.closest('.experience-dock, .floating-panel')) setActiveOverlay(null)
    }
    document.addEventListener('pointerdown', dismissOutside)
    return () => document.removeEventListener('pointerdown', dismissOutside)
  }, [])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target
      const element = target instanceof Element ? target : null
      const editing = element?.closest('input, textarea, select, [contenteditable="true"], [role="slider"]')
      if (event.key === 'Escape') {
        if (activeOverlay) { setActiveOverlay(null); event.preventDefault() }
        else if (document.fullscreenElement) void document.exitFullscreen()
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
  if (!experiment) return null

  const share = async () => {
    const url = new URL(window.location.href)
    const parameters = encodeState(stateRef.current)
    if (parameters) url.searchParams.set('state', parameters)
    try { await navigator.clipboard.writeText(url.toString()); setCopied(true); window.setTimeout(() => setCopied(false), 1800) }
    catch { window.prompt('Copy this exhibit link', url.toString()) }
  }
  const Component = experiment.Component
  const visit = (targetId: string) => { setActiveOverlay(null); navigate('/exhibits/' + targetId) }
  const move = (delta: number) => {
    const index = experiments.findIndex((item) => item.id === experiment.id)
    visit(experiments[(index + delta + experiments.length) % experiments.length].id)
  }
  const random = () => {
    const choices = experiments.filter((item) => item.id !== experiment.id)
    visit(choices[Math.floor(Math.random() * choices.length)].id)
  }
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else if (stageRef.current) void stageRef.current.requestFullscreen()
  }
  const overlay = (value: 'controls' | 'info' | 'selector') => setActiveOverlay((current) => current === value ? null : value)

  return <main ref={stageRef} className={'exhibit-page environment-' + experiment.id} aria-label={experiment.title + ' immersive experiment'} onPointerMove={(event) => { if (!interfaceVisible && event.clientY > window.innerHeight - 96) setInterfaceVisible(true) }}>
    <div className="environment-aura" aria-hidden="true" />
    <div className="experiment-viewport">
      <Component paused={paused} controlsVisible={activeOverlay === 'controls'} stateFromUrl={decodeState(location.search)} onShareState={(state) => { stateRef.current = state }} onCloseControls={() => setActiveOverlay(null)} />
    </div>

    {activeOverlay === 'info' && <section className="info-panel floating-panel glass-material" aria-label={experiment.title + ' information'}>
      <button className="panel-close" onClick={() => setActiveOverlay(null)} aria-label="Close information" title="Close information"><Icon name="close" /></button>
      <span className="info-category">{experiment.category} <i>·</i> {experiment.number} / 06</span>
      <h1>{experiment.title}</h1>
      <p>{experiment.description}</p>
      <div className="info-method"><span>UNDERLYING IDEA</span><strong>{experiment.method}</strong></div>
      <div className="info-actions">
        <button onClick={() => setIsFavorite(toggleFavorite(experiment.id).includes(experiment.id))} aria-pressed={isFavorite}><Icon name="heart" />{isFavorite ? 'Saved to exhibition' : 'Save to exhibition'}</button>
        <button onClick={() => { void share() }}><Icon name="share" />{copied ? 'Link copied' : 'Share this experiment'}</button>
      </div>
    </section>}

    {activeOverlay === 'selector' && <div className="experiment-selector floating-panel glass-material" role="dialog" aria-label="Choose an experiment">
      <div className="selector-heading"><span>MOVE TO A WORLD</span><kbd>ESC</kbd></div>
      {experiments.map((item) => <button key={item.id} className={item.id === experiment.id ? 'selected' : ''} onClick={() => visit(item.id)} aria-current={item.id === experiment.id ? 'page' : undefined}>
        <span>{item.number}</span><strong>{item.title}</strong><small>{item.category}</small>{item.id === experiment.id && <i>HERE</i>}
      </button>)}
    </div>}

    <div className={'experience-chrome' + (interfaceVisible ? '' : ' chrome-hidden')}>
      <nav className="experience-dock glass-material" aria-label="Experiment navigation and controls">
        <button className="dock-button dock-home" onClick={() => navigate('/')} aria-label="Return to exhibition" title="Return to exhibition" data-tooltip="Exhibition">
          <Icon name="back" /><span className="dock-home-label">Exhibition</span>
        </button>
        <span className="dock-divider" />
        <button className="dock-button dock-step" onClick={() => move(-1)} aria-label="Previous experiment" title="Previous experiment · ←" data-tooltip="Previous"><Icon name="back" /></button>
        <button className="dock-current" onClick={() => overlay('selector')} aria-expanded={activeOverlay === 'selector'} aria-label={'Choose experiment. Current experiment: ' + experiment.title} title="Choose an experiment">
          <small>{experiment.number}</small><span>{experiment.title}</span><Icon name="chevron" />
        </button>
        <button className="dock-button dock-step" onClick={() => move(1)} aria-label="Next experiment" title="Next experiment · →" data-tooltip="Next"><Icon name="arrow" /></button>
        <button className="dock-button dock-random" onClick={random} aria-label="Random experiment" title="Surprise me" data-tooltip="Random"><Icon name="shuffle" /></button>
        <span className="dock-divider dock-actions-divider" />
        <button className={'dock-button' + (activeOverlay === 'controls' ? ' is-active' : '')} onClick={() => overlay('controls')} aria-label="Toggle experiment controls" aria-expanded={activeOverlay === 'controls'} title="Experiment controls" data-tooltip="Controls"><Icon name="sliders" /></button>
        <button className={'dock-button' + (activeOverlay === 'info' ? ' is-active' : '')} onClick={() => overlay('info')} aria-label="Toggle experiment information" aria-expanded={activeOverlay === 'info'} title="About this experiment" data-tooltip="About"><Icon name="info" /></button>
        <button className="dock-button" onClick={() => setPaused((value) => !value)} aria-label={paused ? 'Resume experiment' : 'Pause experiment'} title={paused ? 'Resume · Space' : 'Pause · Space'} data-tooltip={paused ? 'Resume' : 'Pause'}><Icon name={paused ? 'play' : 'pause'} /></button>
        <button className="dock-button" onClick={toggleFullscreen} aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} title="Fullscreen · F" data-tooltip="Fullscreen"><Icon name={fullscreen ? 'collapse' : 'expand'} /></button>
      </nav>
      <span className="keyboard-hint" aria-hidden="true">HIDE UI · H &nbsp; DRAG TO EXPLORE</span>
    </div>
  </main>
}

export default function App() {
  const location = useLocation()
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }) }, [location.pathname])
  return <Routes><Route path="/" element={<Exhibition />} /><Route path="/exhibits/:id" element={<ExhibitPage />} /><Route path="*" element={<Exhibition />} /></Routes>
}
