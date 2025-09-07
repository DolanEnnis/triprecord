import { Component, inject } from '@angular/core';
import { AuthService } from '../auth/auth';
import { MatCardModule } from '@angular/material/card';

@Component({
  selector: 'app-main',
  standalone: true,
  imports: [
    MatCardModule
  ],
  templateUrl: './main.html',
  styleUrl: './main.css'
})
export class MainComponent {
  readonly authService = inject(AuthService);
}