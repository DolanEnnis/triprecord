import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../auth';

import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSnackBarModule
],
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.css']
})
export class RegisterComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);

  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
    displayName: ['', [Validators.required]]
  });

  onSubmit(): void {
    if (this.form.invalid) {
      return;
    }

    const { email, password, displayName } = this.form.getRawValue();
    
    // First attempt to register the user
    this.authService.register(email!, password!, displayName!).subscribe({
      next: () => {
        this.router.navigate(['/']);
      },
      error: (err) => {
        // Forgiving authentication: If the email is already in use, check if they meant to login
        if (err.code === 'auth/email-already-in-use') {
          // Attempt to login with the provided credentials
          this.authService.login(email!, password!).subscribe({
            next: () => {
              // Login succeeded - they provided the correct password, so log them in
              this.snackBar.open('Welcome back! You were already registered, so we logged you in.', 'Close', { 
                duration: 5000 
              });
              this.router.navigate(['/']);
            },
            error: (loginErr) => {
              // Login failed - email exists but wrong password
              this.snackBar.open(
                'This email is already registered. Please use the login page or check your password.', 
                'Close', 
                { duration: 7000 }
              );
            }
          });
        } else {
          // Other registration errors (weak password, invalid email, etc.)
          this.snackBar.open(err.message, 'Close', { duration: 5000 });
        }
      }
    });
  }
}
