import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { LandingComponent } from './landing.component';

@Component({
  selector: 'app-root-gate',
  standalone: true,
  imports: [CommonModule, LandingComponent],
  template: `
    @if (!auth.isAuthenticated()) {
      <app-landing />
    }
  `,
})
export class RootGateComponent implements OnInit {
  auth = inject(AuthService);
  private router = inject(Router);

  ngOnInit(): void {
    if (this.auth.isAuthenticated()) {
      this.router.navigate(['/home'], { replaceUrl: true });
    }
  }
}
