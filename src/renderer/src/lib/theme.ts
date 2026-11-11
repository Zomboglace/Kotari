import { loadPref, savePref } from './hooks'

export type ThemeMode = 'light' | 'dark' | 'system'

export interface ThemeSettings {
  mode: ThemeMode
  /** Identifiant d'une palette, ou 'custom'. */
  palette: string
  custom: string
}

export const PALETTES: { id: string; name: string; light: string; dark: string }[] = [
  { id: 'cuir', name: 'Cuir', light: '#8a4b2a', dark: '#d08a5c' },
  { id: 'foret', name: 'Forêt', light: '#2f6b3f', dark: '#6fbf84' },
  { id: 'ocean', name: 'Océan', light: '#245d8f', dark: '#6aa8de' },
  { id: 'amethyste', name: 'Améthyste', light: '#6b3fa0', dark: '#b28ae6' },
  { id: 'braise', name: 'Braise', light: '#a3312a', dark: '#ec7a6e' },
  { id: 'ardoise', name: 'Ardoise', light: '#475569', dark: '#a3b1c6' }
]

const KEY = 'kotari.theme'
export const DEFAULT_THEME: ThemeSettings = { mode: 'system', palette: 'cuir', custom: '#8a4b2a' }

export function loadTheme(): ThemeSettings {
  return { ...DEFAULT_THEME, ...loadPref<Partial<ThemeSettings>>(KEY, {}) }
}

const media = window.matchMedia('(prefers-color-scheme: dark)')

export function isDark(t: ThemeSettings): boolean {
  return t.mode === 'dark' || (t.mode === 'system' && media.matches)
}

export function accentOf(t: ThemeSettings): string {
  if (t.palette === 'custom') return t.custom
  const p = PALETTES.find((x) => x.id === t.palette) ?? PALETTES[0]
  return isDark(t) ? p.dark : p.light
}

export function applyTheme(t: ThemeSettings) {
  const root = document.documentElement
  root.dataset.theme = isDark(t) ? 'dark' : 'light'
  root.style.setProperty('--accent', accentOf(t))
}

export function saveTheme(t: ThemeSettings) {
  savePref(KEY, t)
  applyTheme(t)
}

/** Suit le thème du système quand le mode est « Système ». */
export function watchSystemTheme(get: () => ThemeSettings): () => void {
  const h = () => applyTheme(get())
  media.addEventListener('change', h)
  return () => media.removeEventListener('change', h)
}
