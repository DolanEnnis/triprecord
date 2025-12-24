import { Component, inject, DestroyRef, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../auth';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';

import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
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
    MatIconModule,
    MatProgressSpinnerModule,
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
  private readonly destroyRef = inject(DestroyRef);

  // UX state signals
  readonly isLoading = signal(false);
  readonly hidePassword = signal(true);

  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
    displayName: ['', [Validators.required]]
  });

  onSubmit(): void {
    if (this.form.invalid) {
      return;
    }

    const formData = this.form.getRawValue();
    
    // Type guard: Even though form validation ensures these fields exist,
    // TypeScript doesn't know that. This explicit check satisfies the type checker.
    if (!formData.email || !formData.password || !formData.displayName) {
      console.error('Form data unexpectedly incomplete despite validation');
      return;
    }
    
    const { email, password, displayName } = formData;
    
    this.isLoading.set(true);
    
    // First attempt to register the user
    this.authService.register(email, password, displayName)
      .pipe(
        finalize(() => this.isLoading.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
      next: () => {
        this.router.navigate(['/']);
      },
      error: (err) => {
        // Forgiving authentication: If the email is already in use, check if they meant to login
        if (err.code === 'auth/email-already-in-use') {
          // Attempt to login with the provided credentials
          this.isLoading.set(true);
          this.authService.login(email, password)
            .pipe(
              finalize(() => this.isLoading.set(false)),
              takeUntilDestroyed(this.destroyRef)
            )
            .subscribe({
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
