import { Injectable, effect, signal } from '@angular/core';

const STORAGE_KEY = 'jbpm.theme';
type Theme = 'light' | 'dark';

function initialTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// Signal-based, matching the rest of the app's no-NgRx style. Stamps data-theme on <html> so
// styles.css's `:root[data-theme="dark"]` block takes over — one source of truth, no per-component
// theme logic.
@Injectable({ providedIn: 'root' })
export class ThemeService {
  theme = signal<Theme>(initialTheme());

  constructor() {
    effect(() => {
      const t = this.theme();
      document.documentElement.setAttribute('data-theme', t);
      localStorage.setItem(STORAGE_KEY, t);
    });
  }

  toggle() { this.theme.set(this.theme() === 'dark' ? 'light' : 'dark'); }
}
