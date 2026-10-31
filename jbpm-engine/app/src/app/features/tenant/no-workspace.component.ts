import { Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { TenantService } from '../../core/tenant/tenant.service';
import { ToastService } from '../../shared/toast.service';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

@Component({
  selector: 'app-no-workspace',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="no-workspace-page">
      <div class="workspace-card">
        <div class="workspace-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
        </div>

        <h1 class="workspace-title">No workspace yet</h1>
        <p class="workspace-subtitle">
          You are signed in
          @if (userEmail()) {
            as <strong>{{ userEmail() }}</strong>
          },
          but you do not belong to a workspace yet.
        </p>

        @if (tenant.inactiveMemberships().length > 0) {
          <div class="alert-box warning">
            <div class="alert-content">
              @for (m of tenant.inactiveMemberships(); track m.id) {
                <div><strong>{{ m.name }}</strong> is {{ m.status }}.</div>
              }
            </div>
          </div>
        }

        <section class="workspace-section">
          <h3>Ask to be invited</h3>
          <p class="workspace-hint">
            Ask a workspace owner or admin to invite <strong>{{ userEmail() || 'your email' }}</strong>. You will receive an invitation link to join.
          </p>
          <form (submit)="useInvitationLink($event)" class="workspace-inline-form">
            <input
              type="text"
              class="form-input"
              placeholder="Paste invitation link here"
              [(ngModel)]="invitationInput"
              name="invitation"
              spellcheck="false"
              autocomplete="off"
            />
            <button type="submit" class="btn btn-secondary" [disabled]="!invitationInput.trim()">
              Use link
            </button>
          </form>
        </section>

        <section class="workspace-section">
          <h3>Or create your own workspace</h3>
          @if (created()) {
            <div class="alert-box info">
              <div class="alert-content">
                <strong>{{ created()?.name }}</strong> was created successfully!
                <div style="margin-top: 12px;">
                  <button type="button" class="btn btn-primary btn-sm" (click)="checkAgain()" [disabled]="checking()">
                    {{ checking() ? 'Checking...' : "I'm ready - enter workspace" }}
                  </button>
                </div>
              </div>
            </div>
          } @else {
            <form (submit)="createWorkspace($event)">
              <div class="form-group">
                <label for="ws-name">Workspace name</label>
                <input
                  id="ws-name"
                  class="form-input"
                  [ngModel]="name"
                  (ngModelChange)="onNameChange($event)"
                  name="name"
                  placeholder="Acme Orchestrations"
                  minlength="2"
                  maxlength="100"
                  required
                />
              </div>

              <div class="form-group">
                <label for="ws-slug">Workspace address</label>
                <input
                  id="ws-slug"
                  class="form-input"
                  [ngModel]="slug"
                  (ngModelChange)="onSlugChange($event)"
                  name="slug"
                  placeholder="acme-orchestrations"
                  maxlength="50"
                  required
                />
                <small class="form-hint" [class.hint-avail]="availability() === true" [class.hint-taken]="availability() === false">
                  @if (slug && !slugValid()) {
                    Use lowercase letters, numbers, and single hyphens (2-50 characters).
                  } @else if (availability() === true) {
                    ✓ Available.
                  } @else if (availability() === false) {
                    ✕ That address is taken - try another.
                  } @else {
                    Lowercase letters, numbers, and single hyphens.
                  }
                </small>
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label for="ws-owner">Your name (optional)</label>
                  <input
                    id="ws-owner"
                    class="form-input"
                    [(ngModel)]="ownerName"
                    name="ownerName"
                    maxlength="100"
                  />
                </div>
                <div class="form-group">
                  <label for="ws-email">Owner email</label>
                  <input
                    id="ws-email"
                    type="email"
                    class="form-input"
                    [(ngModel)]="ownerEmail"
                    name="ownerEmail"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                class="btn btn-primary"
                style="width: 100%; margin-top: 8px;"
                [disabled]="creating() || !slugValid() || availability() === false || name.trim().length < 2 || !ownerEmail.trim()"
              >
                {{ creating() ? 'Creating...' : 'Create workspace' }}
              </button>
            </form>
          }
        </section>

        <div class="workspace-card-footer">
          <button type="button" class="btn btn-secondary btn-sm" (click)="checkAgain()" [disabled]="checking()">
            {{ checking() ? 'Checking...' : 'Check again' }}
          </button>
          <button type="button" class="btn btn-secondary btn-sm" (click)="signOut()">
            Sign out
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .no-workspace-page {
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      padding: 48px 16px;
      background: var(--bg);
      font-family: var(--font);
    }
    .workspace-card {
      width: 100%;
      max-width: 540px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow-card);
      padding: 36px 32px;
      text-align: left;
    }
    .workspace-icon {
      width: 48px;
      height: 48px;
      border-radius: 12px;
      background: var(--primary-50);
      color: var(--primary);
      display: grid;
      place-items: center;
      margin-bottom: 20px;
    }
    .workspace-icon svg { width: 26px; height: 26px; }
    .workspace-title {
      font-size: 24px;
      font-weight: 700;
      color: var(--text);
      margin: 0 0 8px;
      letter-spacing: -0.02em;
    }
    .workspace-subtitle {
      font-size: 14px;
      color: var(--text-secondary);
      margin: 0 0 24px;
      line-height: 1.5;
    }
    .workspace-section {
      margin-top: 24px;
      padding-top: 20px;
      border-top: 1px solid var(--border);
    }
    .workspace-section h3 {
      font-size: 16px;
      font-weight: 650;
      color: var(--text);
      margin: 0 0 8px;
    }
    .workspace-hint {
      font-size: 13.5px;
      color: var(--muted);
      margin: 0 0 16px;
      line-height: 1.5;
    }
    .workspace-inline-form {
      display: flex;
      gap: 8px;
    }
    .workspace-inline-form input { flex: 1; }
    .form-group {
      margin-bottom: 16px;
    }
    .form-group label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      color: var(--text);
      margin-bottom: 6px;
    }
    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .form-input {
      width: 100%;
      height: 38px;
      padding: 8px 12px;
      background: var(--surface-2);
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-xs);
      font-size: 14px;
      color: var(--text);
      box-sizing: border-box;
      outline: none;
      transition: border-color .15s, box-shadow .15s;
    }
    .form-input:focus {
      border-color: var(--primary);
      box-shadow: var(--shadow-focus);
    }
    .form-hint {
      display: block;
      margin-top: 5px;
      font-size: 12px;
      color: var(--muted);
    }
    .hint-avail { color: var(--green) !important; font-weight: 500; }
    .hint-taken { color: var(--red) !important; font-weight: 500; }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 9px 18px;
      border-radius: var(--radius-xs);
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid transparent;
      transition: background-color .15s, transform .1s;
      white-space: nowrap;
    }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .btn-primary { background: var(--grad-brand); color: #fff; box-shadow: var(--shadow-xs); }
    .btn-primary:hover:not(:disabled) { filter: brightness(1.06); }
    .btn-secondary { background: var(--surface-3); color: var(--text); border-color: var(--border-strong); }
    .btn-secondary:hover:not(:disabled) { background: var(--border); }
    .btn-sm { padding: 6px 12px; font-size: 12.5px; }
    .alert-box {
      padding: 12px 16px;
      border-radius: var(--radius-xs);
      margin-bottom: 20px;
      font-size: 13.5px;
      line-height: 1.5;
    }
    .alert-box.warning { background: var(--orange-bg); color: var(--orange); border: 1px solid rgba(234, 88, 12, .25); }
    .alert-box.info { background: var(--blue-bg); color: var(--blue); border: 1px solid rgba(37, 99, 235, .25); }
    .workspace-card-footer {
      display: flex;
      justify-content: center;
      gap: 12px;
      margin-top: 24px;
      padding-top: 20px;
      border-top: 1px solid var(--border);
    }
  `],
})
export class NoWorkspaceComponent {
  auth = inject(AuthService);
  tenant = inject(TenantService);
  private toast = inject(ToastService);
  private router = inject(Router);

  invitationInput = '';
  name = '';
  slug = '';
  slugTouched = false;
  ownerName = '';
  ownerEmail = '';

  userEmail = signal<string>('');
  availability = signal<boolean | null>(null);
  checking = signal(false);
  creating = signal(false);
  created = signal<{ name: string; slug: string } | null>(null);

  slugValid = signal(false);

  private debounceTimer?: any;

  constructor() {
    effect(() => {
      const u = this.auth.user();
      if (u) {
        this.userEmail.set(u.email || (u.username.includes('@') ? u.username : `${u.username}@local`));
        if (!this.ownerEmail) this.ownerEmail = this.userEmail();
        if (!this.ownerName) this.ownerName = u.name || u.username;
      }
    }, { allowSignalWrites: true });   // Angular 18 refuses signal writes in an effect unless allowed — without this it threw and the email never showed
  }

  onNameChange(val: string) {
    this.name = val;
    if (!this.slugTouched) {
      this.setSlug(slugify(val));
    }
  }

  onSlugChange(val: string) {
    this.slugTouched = true;
    this.setSlug(val.toLowerCase());
  }

  private setSlug(val: string) {
    this.slug = val;
    const valid = SLUG_PATTERN.test(val) && val.length >= 2 && val.length <= 50;
    this.slugValid.set(valid);

    clearTimeout(this.debounceTimer);
    if (!valid) {
      this.availability.set(null);
      return;
    }

    this.debounceTimer = setTimeout(async () => {
      try {
        const res = await this.tenant.checkSlug(val);
        this.availability.set(res.available);
      } catch {
        this.availability.set(null);
      }
    }, 400);
  }

  useInvitationLink(event: Event) {
    event.preventDefault();
    if (!this.invitationInput.trim()) return;
    this.toast.info('Invitation link recorded. Validating membership...');
    this.checkAgain();
  }

  async createWorkspace(event: Event) {
    event.preventDefault();
    if (!this.slugValid() || this.availability() === false) return;

    this.creating.set(true);
    try {
      const res = await this.tenant.signup({
        name: this.name.trim(),
        slug: this.slug,
        ownerEmail: this.ownerEmail.trim(),
        ownerName: this.ownerName.trim(),
      });
      this.created.set(res);
      this.toast.success(`Workspace "${res.name}" created!`);
      await this.tenant.refresh(res.id);
      this.router.navigate(['/home']);
    } catch (err: any) {
      this.toast.error(err?.error?.error?.message || err?.message || 'Failed to create workspace');
    } finally {
      this.creating.set(false);
    }
  }

  async checkAgain() {
    this.checking.set(true);
    try {
      const list = await this.tenant.refresh();
      if (list.length > 0) {
        this.toast.success('Workspace connected!');
        this.router.navigate(['/home']);
      } else {
        this.toast.info('Still no active workspace found.');
      }
    } catch (err: any) {
      this.toast.error(err?.message || 'Check failed');
    } finally {
      this.checking.set(false);
    }
  }

  signOut() {
    this.auth.signOut();
    this.router.navigate(['/login']);
  }
}
