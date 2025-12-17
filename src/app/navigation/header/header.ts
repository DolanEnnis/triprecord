import { Component, EventEmitter, Output, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { AuthService } from '../../auth/auth';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [
    RouterLink,
    RouterLinkActive,
    MatIconModule,
    MatToolbarModule,
    MatButtonModule,
  ],
  templateUrl: './header.html',
  styleUrls: ['./header.css'],
})
export class HeaderComponent {
  // This will emit an event up to the parent component (app.ts)
  @Output() sidenavToggle = new EventEmitter<void>();

  // Inject our signal-based auth service
  readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  onToggleSidenav(): void {
    this.sidenavToggle.emit();
  }

  onLogout(): void {
    // Subscribe to the logout observable to handle navigation after completion.
    this.authService.logout().subscribe(() => {
      this.router.navigate(['/auth/login']);
    });
  }
}
