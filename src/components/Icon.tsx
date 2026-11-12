import type { SVGProps } from 'react'

type Name = 'search' | 'shuffle' | 'arrow' | 'back' | 'heart' | 'share' | 'expand' | 'collapse' | 'pause' | 'play' | 'reset' | 'info' | 'close' | 'menu' | 'spark' | 'sound' | 'chevron' | 'sliders'
const paths: Record<Name, React.ReactNode> = {
  search: <><circle cx="10.8" cy="10.8" r="6.7" /><path d="m16 16 4.2 4.2" /></>,
  shuffle: <><path d="m16 3 4 4-4 4" /><path d="M4 17h2.5c4.5 0 6.5-10 11-10H20" /><path d="m16 13 4 4-4 4" /><path d="M4 7h2.5c1.5 0 2.7 1.4 3.7 3" /><path d="M13.8 14c1.1 1.6 2.2 3 3.7 3H20" /></>,
  arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
  back: <><path d="M19 12H5" /><path d="m11 18-6-6 6-6" /></>,
  heart: <path d="M20.8 8.7c0 5.2-8.8 10.1-8.8 10.1S3.2 13.9 3.2 8.7a4.5 4.5 0 0 1 8.8-1.2 4.5 4.5 0 0 1 8.8 1.2Z" />,
  share: <><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5" /></>,
  expand: <><path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5" /><path d="M3 8l6-5M21 8l-6-5M3 16l6 5m12-5-6 5" /></>,
  collapse: <><path d="M8 3v5H3m13-5v5h5M3 16h5v5m13-5h-5v5" /></>,
  pause: <><path d="M8 5v14M16 5v14" /></>,
  play: <path d="m8 5 11 7-11 7z" />,
  reset: <><path d="M3 12a9 9 0 1 0 2.6-6.4L3 8" /><path d="M3 3v5h5" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5m0-8h.01" /></>,
  close: <><path d="m18 6-12 12M6 6l12 12" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  spark: <><path d="m12 3 1.9 5.8L20 11l-6.1 2.1L12 19l-1.9-5.9L4 11l6.1-2.2L12 3Z" /><path d="m19 15 .9 2.2L22 18l-2.1.8L19 21l-.9-2.2L16 18l2.1-.8L19 15Z" /></>,
  sound: <><path d="M4 10v4h4l5 4V6l-5 4H4Z" /><path d="M17 9a5 5 0 0 1 0 6m2.5-8.5a8 8 0 0 1 0 11" /></>,
  chevron: <path d="m7 10 5 5 5-5" />,
  sliders: <><path d="M4 6h7m4 0h5M4 12h2m4 0h10M4 18h8m4 0h4" /><circle cx="13" cy="6" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="14" cy="18" r="2" /></>,
}

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: Name }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>
}
