import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SideNavComponent } from './shell/side-nav.component';
import { FooterComponent } from './shell/footer.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, SideNavComponent, FooterComponent],
  template: `
    <div class="layout">
      <app-side-nav></app-side-nav>
      <div class="main">
        <router-outlet></router-outlet>
      </div>
    </div>
    <app-footer></app-footer>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100vh; }
    .layout { flex: 1; display: flex; min-height: 0; }
    .main { flex: 1; min-width: 0; overflow: auto; }
  `],
})
export class AppComponent {}
