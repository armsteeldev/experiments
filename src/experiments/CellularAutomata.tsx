import { useEffect, useRef, useState } from 'react'
import type { ExperimentControls } from '../types'
import { ActionRow, ControlPanel, RangeControl, SelectControl } from '../components/Controls'
import { patterns, placePattern, stepAutomaton, type AutomatonRule } from '../simulations/automata'
import './ExpandedExhibits.css'

type PaintMode = 'paint' | 'erase' | 'pan'
type RenderMode = 'age' | 'mono' | 'ember'
const ruleOptions: [AutomatonRule, string][] = [['life','Conway · B3/S23'],['highlife','HighLife · B36/S23'],['seeds','Seeds · B2/S'],['brian',"Brian's Brain"]]
const patternOptions: [string,string][] = [...Object.entries(patterns).map(([key, value]) => [key, value.name] as [string,string]), ['random','Random field'], ['empty','Empty board'], ['custom','Your drawing']]
const hues = ['#92d9bd','#98d8e9','#a89be2','#f0bc88','#e7968b','#d3df9c']
const seededField = (length: number, initialSeed: number) => {
  let state = initialSeed >>> 0
  const cells = new Uint8Array(length)
  for (let i = 0; i < length; i++) {
    state = (state * 1664525 + 1013904223) >>> 0
    cells[i] = state / 4294967296 < .24 ? 1 : 0
  }
  return cells
}
const cellPattern = (key: string) => {
  const pattern = patterns[key]
  if (!pattern?.cells.length) return null
  const xs = pattern.cells.map(([x]) => x), ys = pattern.cells.map(([, y]) => y)
  return { pattern, width: Math.max(...xs) - Math.min(...xs) + 1, height: Math.max(...ys) - Math.min(...ys) + 1, minX: Math.min(...xs), minY: Math.min(...ys) }
}

export default function CellularAutomata({ paused, controlsVisible, stateFromUrl, onShareState, onCloseControls }: ExperimentControls) {
  const initialRule = ruleOptions.some(([key]) => key === stateFromUrl?.rule) ? stateFromUrl?.rule as AutomatonRule : 'life'
  const savedPattern = String(stateFromUrl?.pattern ?? '')
  const initialPattern = patterns[savedPattern] || ['random','empty','custom'].includes(savedPattern) ? savedPattern : 'pulsarGarden'
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [rule, setRule] = useState<AutomatonRule>(initialRule)
  const [pattern, setPattern] = useState(initialPattern)
  const [speed, setSpeed] = useState(() => Number.isInteger(Number(stateFromUrl?.speed)) && Number(stateFromUrl?.speed) >= 1 && Number(stateFromUrl?.speed) <= 18 ? Number(stateFromUrl?.speed) : 8)
  const [renderMode, setRenderMode] = useState<RenderMode>(() => ['age','mono','ember'].includes(String(stateFromUrl?.renderMode)) ? stateFromUrl?.renderMode as RenderMode : 'age')
  const [seed, setSeed] = useState(() => Number.isInteger(Number(stateFromUrl?.seed)) && Number(stateFromUrl?.seed) >= 0 ? Number(stateFromUrl?.seed) >>> 0 : 919)
  const [mode, setMode] = useState<PaintMode>('paint')
  const [running, setRunning] = useState(true)
  const [generation, setGeneration] = useState(0)
  const [alive, setAlive] = useState(0)
  const model = useRef({ width: 180, height: 112, cells: new Uint8Array(180 * 112), age: new Uint8Array(180 * 112), trail: new Uint8Array(180 * 112), generation: 0, zoom: window.matchMedia('(max-width: 720px)').matches ? 3.1 : 2.1, panX: 0, panY: 0, geometry: null as null | { width:number;height:number;cellSize:number;offsetX:number;offsetY:number }, pointer: null as null | { id: number; mode: PaintMode; x: number; y: number; last: number } })
  const parameters = useRef({ paused, running, speed, rule, renderMode, mode }); parameters.current = { paused, running, speed, rule, renderMode, mode }
  useEffect(() => { onShareState({ pattern, rule, speed, renderMode, seed }); }, [pattern, rule, speed, renderMode, seed, onShareState])
  useEffect(() => {
    const m = model.current
    if (initialPattern === 'empty') { setAlive(0); return }
    if (initialPattern === 'random') { m.cells = seededField(m.cells.length, seed); m.cells.forEach((cell,index) => { if (cell) m.age[index]=1 }); setAlive(m.cells.reduce((sum,value)=>sum+(value===1?1:0),0)); return }
    const shape = cellPattern(initialPattern)
    if (shape) placePattern(m.cells, m.width, m.height, shape.pattern, Math.floor((m.width-shape.width)/2)-shape.minX, Math.floor((m.height-shape.height)/2)-shape.minY, true)
    m.cells.forEach((cell,index) => { if (cell) m.age[index]=1 })
    setAlive(m.cells.reduce((sum,value)=>sum+(value===1?1:0),0))
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current, ctx = canvas?.getContext('2d', { alpha: false })
    if (!canvas || !ctx) return
    const m = model.current; let width = 0, height = 0, dpr = 1, raf = 0, last = 0, accumulator = 0, lastRender = 0, lastCount = 0
    const resize = () => { const rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return; width=rect.width;height=rect.height;dpr=Math.min(devicePixelRatio||1,1.5,Math.sqrt(2_300_000/(width*height)));canvas.width=Math.floor(width*dpr);canvas.height=Math.floor(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0) }
    const advance = () => { const next=stepAutomaton(m.cells,m.width,m.height,parameters.current.rule); for(let i=0;i<next.length;i++){const old=m.cells[i];m.age[i]=next[i]===1?(old===1?Math.min(255,m.age[i]+1):1):0;m.trail[i]=old===1&&next[i]===0?28:Math.max(0,m.trail[i]-1)};m.cells=next;m.generation++ }
    const frame = (now: number) => {
      raf=requestAnimationFrame(frame)
      if(document.hidden||!width||now-lastRender<31)return
      const q=parameters.current, elapsed=Math.min(90,last?now-last:16.67)
      const cellSize=Math.min(width/m.width,height/m.height)*.82*m.zoom,offsetX=(width-m.width*cellSize)/2+m.panX,offsetY=(height-m.height*cellSize)/2+m.panY
      m.geometry={width,height,cellSize,offsetX,offsetY}
      if(q.running&&!q.paused){accumulator+=elapsed* q.speed/1000;let count=0;while(accumulator>=1&&count++<4){advance();accumulator-=1}if(m.generation-lastCount>=4){setGeneration(m.generation);setAlive(m.cells.reduce((sum,value)=>sum+(value===1?1:0),0));lastCount=m.generation}}
      ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#070d12';ctx.fillRect(0,0,width,height)
      const field=ctx.createRadialGradient(width*.51,height*.52,0,width*.51,height*.52,Math.max(width,height)*.76);field.addColorStop(0,'rgba(34,61,65,.22)');field.addColorStop(1,'rgba(4,8,12,0)');ctx.fillStyle=field;ctx.fillRect(0,0,width,height)
      if(cellSize>5){ctx.strokeStyle='rgba(185,212,206,.045)';ctx.lineWidth=.5;ctx.beginPath();for(let x=0;x<=m.width;x++){const sx=offsetX+x*cellSize;ctx.moveTo(sx,offsetY);ctx.lineTo(sx,offsetY+m.height*cellSize)}for(let y=0;y<=m.height;y++){const sy=offsetY+y*cellSize;ctx.moveTo(offsetX,sy);ctx.lineTo(offsetX+m.width*cellSize,sy)}ctx.stroke()}
      for(let i=0;i<m.cells.length;i++){
        const value=m.cells[i], age=m.age[i], trail=m.trail[i];if(!value&&!trail)continue
        const x=i%m.width,y=Math.floor(i/m.width),sx=offsetX+x*cellSize,sy=offsetY+y*cellSize,pad=Math.max(.7,cellSize*.105)
        let color='#8bd8c7'
        if(q.renderMode==='mono')color='#c5ded8'
        else if(q.renderMode==='ember')color=value?(age>16?'#ffe2a0':age>5?'#efa273':'#c77670'):'#7c9d9b'
        else color=hues[(Math.floor(age/11)+x+y)%hues.length]
        if(value){if(value===2)color='#8589b0';ctx.globalAlpha=value===2?.56:q.renderMode==='age'?.56+Math.min(.42,age/90):.88;ctx.shadowColor=color;ctx.shadowBlur=cellSize>7?Math.min(14,age*.22):3;ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(sx+pad,sy+pad,Math.max(1,cellSize-pad*2),Math.max(1,cellSize-pad*2),Math.min(2,cellSize*.2));ctx.fill();ctx.shadowBlur=0}
        else if(trail){ctx.globalAlpha=trail/105;ctx.fillStyle=q.renderMode==='ember'?'#b47c65':'#8aaea8';ctx.fillRect(sx+pad,sy+pad,Math.max(1,cellSize-pad*2),Math.max(1,cellSize-pad*2))}
      }
      ctx.globalAlpha=1
      ctx.fillStyle='#879a9b';ctx.font='9px monospace';ctx.fillText(`${m.width} × ${m.height} · WRAP BOUNDARY`,18,height-21)
      last=now;lastRender=now
    }
    const observer=new ResizeObserver(resize);observer.observe(canvas);resize();raf=requestAnimationFrame(frame)
    return()=>{cancelAnimationFrame(raf);observer.disconnect()}
  },[])

  const gridAt = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect=event.currentTarget.getBoundingClientRect(), m=model.current, g=m.geometry
    if(!g)return -1
    const x=Math.floor((event.clientX-rect.left-g.offsetX)/g.cellSize),y=Math.floor((event.clientY-rect.top-g.offsetY)/g.cellSize)
    return x>=0&&x<m.width&&y>=0&&y<m.height?y*m.width+x:-1
  }
  const applyBrush = (index: number, mode: PaintMode) => {
    if(index<0||mode==='pan')return
    const m=model.current, previous=m.cells[index]===1, value=mode==='paint'
    if(previous===value)return
    if(value)m.age[index]=1
    m.cells[index]=value?1:0;m.trail[index]=0
    setAlive((count)=>count+(value?1:-1));setPattern('custom')
  }
  const pointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {const m=model.current,index=gridAt(event);m.pointer={id:event.pointerId,mode,x:event.clientX,y:event.clientY,last:index};event.currentTarget.setPointerCapture(event.pointerId);if(mode!=='pan')applyBrush(index,mode)}
  const pointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {const m=model.current,p=m.pointer;if(!p||p.id!==event.pointerId)return;if(p.mode==='pan'){const dx=event.clientX-p.x,dy=event.clientY-p.y;m.panX+=dx;m.panY+=dy;if(m.geometry){m.geometry.offsetX+=dx;m.geometry.offsetY+=dy}p.x=event.clientX;p.y=event.clientY}else{const index=gridAt(event);if(index>=0&&index!==p.last){applyBrush(index,p.mode);p.last=index}}}
  const pointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {const m=model.current,p=m.pointer;if(!p||p.id!==event.pointerId)return;m.pointer=null}
  const wheel = (event: WheelEvent) => {event.preventDefault();const canvas=canvasRef.current;if(!canvas)return;const m=model.current,g=m.geometry;if(!g)return;const rect=canvas.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top,beforeX=(x-g.offsetX)/g.cellSize,beforeY=(y-g.offsetY)/g.cellSize;m.zoom=Math.max(.45,Math.min(5,m.zoom*Math.exp(-event.deltaY*.001)));g.cellSize=Math.min(g.width/m.width,g.height/m.height)*.82*m.zoom;g.offsetX=x-beforeX*g.cellSize;g.offsetY=y-beforeY*g.cellSize;m.panX=g.offsetX-(g.width-m.width*g.cellSize)/2;m.panY=g.offsetY-(g.height-m.height*g.cellSize)/2;}
  useEffect(()=>{const canvas=canvasRef.current;if(!canvas)return;canvas.addEventListener('wheel',wheel,{passive:false});return()=>canvas.removeEventListener('wheel',wheel)},[])
  const loadPattern=(key:string)=>{const m=model.current; if(key==='empty'){m.cells.fill(0);m.age.fill(0);m.trail.fill(0);m.generation=0;setGeneration(0);setAlive(0);setPattern('empty');return} if(key==='random'){randomize();return} if(key==='custom')return;const shape=cellPattern(key);if(!shape)return;placePattern(m.cells,m.width,m.height,shape.pattern,Math.floor((m.width-shape.width)/2)-shape.minX,Math.floor((m.height-shape.height)/2)-shape.minY,true);m.age.fill(0);m.trail.fill(0);m.cells.forEach((value,index)=>{if(value)m.age[index]=1});m.generation=0;setGeneration(0);setAlive(shape.pattern.cells.length);setPattern(key)}
  const randomize=()=>{const m=model.current,nextSeed=(seed*1664525+1013904223)>>>0;m.cells=seededField(m.cells.length,nextSeed);m.age=m.cells.map(value=>value?1:0);m.trail.fill(0);m.generation=0;setSeed(nextSeed);setGeneration(0);setAlive(m.cells.reduce((sum,value)=>sum+value,0));setPattern('random')}
  const step=()=>{const m=model.current;const next=stepAutomaton(m.cells,m.width,m.height,rule);for(let i=0;i<next.length;i++){const old=m.cells[i];m.age[i]=next[i]===1?(old===1?Math.min(255,m.age[i]+1):1):0;m.trail[i]=old===1&&next[i]===0?28:Math.max(0,m.trail[i]-1)}m.cells=next;m.generation++;setGeneration(m.generation);setAlive(m.cells.reduce((sum,value)=>sum+(value===1?1:0),0))}

  return <section className="experiment-surface automata-surface" aria-label="Cellular automata playground">
    <canvas ref={canvasRef} className={'experiment-canvas automata-canvas tool-'+mode} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} />
    <div className="automata-heading"><span className="exp-eyebrow">EMERGENT SYSTEMS <i /></span><h2>A world from <em>one rule.</em></h2><p>{ruleOptions.find(([key])=>key===rule)?.[1]} · every cell sees only its eight neighbours.</p></div>
    <div className="automata-stats"><div><span>GENERATION</span><strong>{generation.toString().padStart(5,'0')}</strong></div><div><span>ALIVE NOW</span><strong>{alive.toString().padStart(4,'0')}</strong></div><button onClick={()=>setRunning(value=>!value)}>{running?'Ⅱ PAUSE':'▶ RESUME'}</button><button onClick={step}>STEP →</button></div>
    <div className="automata-tools"><span>TOOL</span>{(['paint','erase','pan'] as PaintMode[]).map((item)=><button key={item} className={mode===item?'tool-active':''} onClick={()=>setMode(item)}>{item.toUpperCase()}</button>)}<span className="automata-key">DRAG TO PAINT · SCROLL TO ZOOM</span></div>
    <ControlPanel title="Cellular Automata" note="Discrete local rules · wrap boundary" visible={controlsVisible} onClose={onCloseControls}>
      <SelectControl label="Rule system" value={rule} options={ruleOptions} onChange={(value)=>setRule(value as AutomatonRule)} />
      <SelectControl label="Starting pattern" value={pattern} options={patternOptions} onChange={(value)=>value==='random'?randomize():loadPattern(value)} />
      <RangeControl label="Generation rate" value={speed} min={1} max={18} step={1} format={(value)=>`${value} gen/s`} onChange={setSpeed} />
      <SelectControl label="Rendering" value={renderMode} options={[["age","Age spectrum"],["mono","Porcelain"],["ember","Ember" ]]} onChange={(value)=>setRenderMode(value as RenderMode)} />
      <ActionRow><button className="small-action" onClick={step}>Step once</button><button className="small-action" onClick={()=>setRunning(value=>!value)}>{running?'Pause':'Resume'}</button><button className="small-action" onClick={randomize}>Randomize</button><button className="small-action" onClick={()=>{const m=model.current;m.cells.fill(0);m.age.fill(0);m.trail.fill(0);m.generation=0;setGeneration(0);setAlive(0);setPattern('empty')}}>Clear cells</button></ActionRow>
      <p className="control-note">Life and HighLife use B/S birth and survival counts. Seeds uses B2/S. Brian’s Brain cycles firing → refractory → ready; all rules wrap at the edge.</p>
    </ControlPanel>
  </section>
}
