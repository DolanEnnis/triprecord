import { Component, EventEmitter, Output, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../auth/auth';
import { SystemSettingsRepository } from '../../services/repositories/system-settings.repository';
import { UserRepository } from '../../services/repositories/user.repository';
import { Auth, authState } from '@angular/fire/auth';
import { combineLatest, Observable, of } from 'rxjs';
import { map, catchError, switchMap } from 'rxjs/operators';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [
    CommonModule,
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
  private readonly systemSettings = inject(SystemSettingsRepository);
  private readonly userRepo = inject(UserRepository);
  private readonly auth = inject(Auth);

  /**
   * Observable that emits true when Sheet-Info has new unviewed updates.
   * Shows green when PDF has changed (update_available flag is true).
   */
  isSheetInfoNew$: Observable<boolean> = this.systemSettings.getShannonMetadata$().pipe(
    map(metadata => metadata?.update_available === true),
    catchError(() => of(false))
  );

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
