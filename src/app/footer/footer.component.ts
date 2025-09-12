import { Component, inject } from '@angular/core';
import { MatToolbarModule } from '@angular/material/toolbar';
import { AuthService } from '../auth/auth';

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [
    MatToolbarModule,
  ],
  templateUrl: './footer.html',
  styleUrls: ['./footer.css']
})
export class FooterComponent {
  readonly authService = inject(AuthService);
}