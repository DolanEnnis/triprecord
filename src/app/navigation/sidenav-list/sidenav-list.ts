import { Component, EventEmitter, Output, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../auth/auth';

@Component({
  selector: 'app-sidenav-list',
  standalone: true,
  imports: [
    RouterLink,
    MatListModule,
    MatIconModule,
  ],
  templateUrl: './sidenav-list.html',
  styleUrls: ['./sidenav-list.css'],
})
export class SidenavListComponent {
  // This event will be caught by app.html to close the drawer
  @Output() sidenavClose = new EventEmitter<void>();

  // Inject our auth service to get user status
  readonly authService = inject(AuthService);

  onClose(): void {
    this.sidenavClose.emit();
  }

  onLogout(): void {
    this.onClose(); // Close the drawer
    this.authService.logout(); // Then log out
  }
}
