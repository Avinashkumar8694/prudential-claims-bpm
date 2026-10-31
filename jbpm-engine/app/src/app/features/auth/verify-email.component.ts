import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthApiService } from '../../core/auth/auth-api.service';
import { IconComponent } from '../../shared/icon.component';

@Component({
  selector: 'app-verify-email',
  standalone: true,
  imports: [RouterLink, IconComponent],
  template: `
    <div class="auth-wrap"><div class="card auth-card">
      <div class="auth-logo"><app-icon name="zap" [size]="22" /></div>
      @if (state() === 'working') { <p class="auth-sub">Confirming your email…</p> }
      @else {
        <h1 class="auth-title">Link expired</h1>
        <p class="auth-sub">This confirmation link is invalid, has expired, or was already used. Sign in and request a new one.</p>
        <a class="btn primary" routerLink="/login">Go to sign in</a>
      }
    </div></div>
  `,
})
export class VerifyEmailComponent implements OnInit {
  private api = inject(AuthApiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  state = signal<'working' | 'failed'>('working');
  ngOnInit() {
    const token = this.route.snapshot.queryParamMap.get('token') || '';
    if (!token) { this.state.set('failed'); return; }
    this.api.verifyEmail(token).subscribe({
      next: () => this.router.navigate(['/login'], { queryParams: { verified: 1 }, replaceUrl: true }),
      error: () => this.state.set('failed'),
    });
  }
}
