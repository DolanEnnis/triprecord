import { Component, inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../auth';
import { catchError, EMPTY, finalize, tap } from 'rxjs';
import { ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

// A simple custom validator to check if two fields match.
function passwordMatchValidator(form: FormGroup) {
  const password = form.get('password');
  const confirmPassword = form.get('confirmPassword');
  return password && confirmPassword && password.value === confirmPassword.value ? null : { mismatch: true };
}

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './register.component.html',
  styleUrl: './register.component.css'
})
export class RegisterComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  registerForm!: FormGroup;
  errorMessage: string | null = null;
  successMessage: string | null = null;
  isLoading = false;

  ngOnInit(): void {
    this.registerForm = this.fb.group({
      displayName: ['', [Validators.required, Validators.minLength(3)]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', [Validators.required]]
    }, { validators: passwordMatchValidator });
  }

  // Form control getters for easier access in the template
  get displayName() { return this.registerForm.get('displayName'); }
  get email() { return this.registerForm.get('email'); }
  get password() { return this.registerForm.get('password'); }
  get confirmPassword() { return this.registerForm.get('confirmPassword'); }

  onRegister(): void {
    if (this.registerForm.invalid) {
      this.registerForm.markAllAsTouched(); // Trigger validation messages
      return;
    }

    this.isLoading = true;
    this.errorMessage = null;

    const { displayName, email, password } = this.registerForm.value;

    this.authService.register(email, password, displayName).pipe(
      tap(() => {
        // This is the "happy path" side-effect
        this.successMessage = 'Registration successful! You can now log in using the link below.';
        this.registerForm.disable(); // Prevent re-submission
      }),
      catchError((err) => {
        // Map common Firebase auth errors to user-friendly messages
        this.errorMessage = (() => {
          switch (err.code) {
            case 'auth/email-already-in-use': return 'This email address is already in use.';
            case 'auth/invalid-email': return 'The email address is not valid.';
            case 'auth/weak-password': return 'The password is not strong enough.';
            default: return 'An unexpected error occurred. Please try again.';
          }
        })();
        console.error('Registration failed:', err);
        return EMPTY; // Gracefully complete the stream on error without propagating it.
      }),
      finalize(() => {
        // This block runs on success OR failure, ensuring cleanup always happens.
        this.isLoading = false;
      })
    ).subscribe(); // The subscription is now empty. Its only job is to "activate" the pipeline.
  }
}
