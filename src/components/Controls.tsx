import type { ReactNode } from 'react'
import { Icon } from './Icon'

export function ControlPanel({ title, note, visible, children, footer, onClose }: { title: string; note?: string; visible: boolean; children: ReactNode; footer?: ReactNode; onClose: () => void }) {
  return <aside id="experiment-controls" className={'control-panel floating-panel glass-material' + (visible ? ' is-open' : '')} aria-label={title + ' controls'} aria-hidden={!visible} inert={!visible}>
    <div className="panel-heading"><div><span>EXPERIMENT CONTROLS</span><strong>{title}</strong></div>{note && <small>{note}</small>}<button className="panel-close" onClick={onClose} aria-label="Close controls" title="Close controls"><Icon name="close" /></button></div>
    <div className="panel-content">{children}</div>
    {footer && <div className="panel-footer">{footer}</div>}
  </aside>
}

export function RangeControl({ label, value, min, max, step, onChange, format }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void; format?: (value: number) => string }) {
  return <label className="range-control"><span>{label}<b>{format ? format(value) : value}</b></span><input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} /></label>
}

export function SelectControl({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (value: string) => void }) {
  return <label className="select-control"><span>{label}</span><select value={value} onChange={(e) => onChange(e.target.value)}>{options.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
}

export function Segmented({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (value: string) => void }) {
  return <div className="segmented-control" role="group" aria-label={label}><span>{label}</span><div>{options.map(([key, name]) => <button key={key} className={value === key ? 'chosen' : ''} aria-pressed={value === key} onClick={() => onChange(key)}>{name}</button>)}</div></div>
}

export function ActionRow({ children }: { children: ReactNode }) {
  return <div className="action-row">{children}</div>
}
