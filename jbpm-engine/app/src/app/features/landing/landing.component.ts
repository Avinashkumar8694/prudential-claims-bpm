import {
  Component,
  HostListener,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AuthConfigService } from '../../core/auth/auth-config.service';
import {
  CHIPS,
  DEMOS,
  FAQ,
  FALLBACK_PLANS,
  FEATURES,
  ICON,
  STANDARDS,
  STEPS,
  TOUR,
  TRUST,
  trialFaq,
  type PublicPlan,
} from './content';

import {
  APP_NAME,
  APP_INITIALS,
  DOMAIN,
  API_BASE,
  CONTACT_EMAIL,
  DOCS_URL,
} from '../../core/config';

const THEME_KEY = 'fabpay-theme';

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './landing.component.html',
  styleUrls: ['./landing.css'],
})
export class LandingComponent implements OnInit {
  private http = inject(HttpClient);
  authCfg = inject(AuthConfigService);

  appName = APP_NAME;
  appInitials = APP_INITIALS;
  domain = DOMAIN;
  apiBase = API_BASE;
  contactEmail = CONTACT_EMAIL;
  docsUrl = DOCS_URL;

  ICON = ICON;
  chips = CHIPS;
  standards = STANDARDS;
  features = FEATURES;
  tour = TOUR;
  demos = DEMOS;
  steps = STEPS;
  trust = TRUST;
  currentYear = new Date().getFullYear();

  theme = signal<'dark' | 'light'>('dark');
  scrolled = signal(false);
  activeTab = signal(0);
  demoIndex = signal(0);

  plans = signal<PublicPlan[]>(FALLBACK_PLANS);

  flatDemos = DEMOS.flatMap((group) => group.items);

  currentDemo = computed(() => this.flatDemos[this.demoIndex()]);

  defaultPlan = computed(() => {
    return this.plans().find((p) => p.isDefault) ?? this.plans()[0];
  });

  trialDays = computed(() => {
    return this.defaultPlan()?.trialDays ?? null;
  });

  faq = computed(() => {
    return [
      ...FAQ.slice(0, 2),
      trialFaq(this.defaultPlan()),
      ...FAQ.slice(2),
    ];
  });

  ngOnInit(): void {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === 'light' || saved === 'dark') {
        this.theme.set(saved);
      } else if (window.matchMedia?.('(prefers-color-scheme: light)').matches) {
        this.theme.set('light');
      }
    } catch {}

    // Fetch public plans from API
    this.http
      .get<{ success: boolean; data?: PublicPlan[] }>('/api/public/plans')
      .subscribe({
        next: (body) => {
          if (Array.isArray(body?.data) && body.data.length > 0) {
            const sorted = [...body.data].sort((a, b) => {
              if (a.isDefault) return -1;
              if (b.isDefault) return 1;
              if (a.isCustom) return 1;
              if (b.isCustom) return -1;
              return 0;
            });
            this.plans.set(sorted);
          }
        },
        error: () => {},
      });
  }

  toggleTheme(): void {
    const next = this.theme() === 'light' ? 'dark' : 'light';
    this.theme.set(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {}
  }

  @HostListener('window:scroll')
  onScroll(): void {
    this.scrolled.set(window.scrollY > 8);
  }

  scrollTo(targetId: string, event?: Event): void {
    if (event) event.preventDefault();
    const el = document.querySelector(targetId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  prevDemo(): void {
    this.demoIndex.set(Math.max(0, this.demoIndex() - 1));
  }

  nextDemo(): void {
    this.demoIndex.set(Math.min(this.flatDemos.length - 1, this.demoIndex() + 1));
  }

  getDemoGlobalIndex(key: string): number {
    return this.flatDemos.findIndex((d) => d.key === key);
  }

  setDemoByKey(key: string): void {
    const idx = this.getDemoGlobalIndex(key);
    if (idx >= 0) this.demoIndex.set(idx);
  }
}
