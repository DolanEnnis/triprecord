import { Component, inject, Input, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ShipRepository } from '../services/ship.repository';
import { Ship } from '../models/data.model';

/**
 * LEARNING: REUSABLE COMPONENT PATTERN
 * 
 * This component demonstrates a common Angular pattern: creating a reusable card
 * that can display and edit entity data. Key design decisions:
 * 
 * 1. **@Input() for Data**: Accepts a shipId instead of the full ship object.
 *    This keeps the component flexible and allows it to fetch its own data.
 * 
 * 2. **Reactive Forms**: Uses FormGroup for structured data handling and validation.
 * 
 * 3. **Signals for State**: Uses Angular Signals for reactive loading/error states.
 *    This is the modern Angular approach replacing BehaviorSubject for simple state.
 * 
 * 4. **Repository Pattern**: Delegates data operations to ShipRepository,
 *    keeping the component focused on presentation logic.
 */
@Component({
  selector: 'app-ship-details-card',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule
  ],
  templateUrl: './ship-details-card.html',
  styleUrl: './ship-details-card.css',
})
export class ShipDetailsCard implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly shipRepository = inject(ShipRepository);
  private readonly snackBar = inject(MatSnackBar);

  // The ship ID to load and display
  @Input({ required: true }) shipId!: string;

  // Reactive form for ship data
  // Each field maps to a Ship model property
  shipForm!: FormGroup;

  // Signals for reactive state management
  loading = signal(false);
  saving = signal(false);

  ngOnInit(): void {
    // Initialize form with validation rules
    // These validators match the database constraints
    this.shipForm = this.fb.group({
      shipName: ['', Validators.required],
      grossTonnage: [null, [Validators.required, Validators.min(50), Validators.max(200000)]],
      imoNumber: [null, [Validators.min(1000000), Validators.max(9999999)]], // 7 digits
      marineTrafficLink: [''],
      shipNotes: ['']
    });

    // Load ship data immediately
    this.loadShipData();
  }

  /**
   * Fetches ship data from Firestore and populates the form.
   * Uses signals to track loading state for the UI.
   */
  private loadShipData(): void {
    this.loading.set(true);
    
    this.shipRepository.getShipById(this.shipId).subscribe({
      next: (ship) => {
        if (ship) {
          // Populate form with ship data using patchValue
          // patchValue allows partial updates (unlike setValue which requires all fields)
          this.shipForm.patchValue({
            shipName: ship.shipName,
            grossTonnage: ship.grossTonnage,
            imoNumber: ship.imoNumber,
            marineTrafficLink: ship.marineTrafficLink,
            shipNotes: ship.shipNotes
          });
        } else {
          this.snackBar.open('Ship not found', 'Close', { duration: 3000 });
        }
        this.loading.set(false);
      },
      error: (error) => {
        console.error('Failed to load ship data:', error);
        this.snackBar.open('Failed to load ship data', 'Close', { duration: 5000 });
        this.loading.set(false);
      }
    });
  }

  /**
   * LEARNING: FORM SUBMISSION PATTERN
   * 
   * This method demonstrates the standard Angular form submission workflow:
   * 1. Validate form (prevent submission if invalid)
   * 2. Extract form values
   * 3. Call repository to update data
   * 4. Handle success/error with user feedback (SnackBar)
   * 5. Reset form dirty state on success
   */
  async save(): Promise<void> {
    if (this.shipForm.invalid) {
      this.shipForm.markAllAsTouched();
      this.snackBar.open('Please correct all validation errors', 'Close', { duration: 3000 });
      return;
    }

    this.saving.set(true);

    try {
      const formValue = this.shipForm.getRawValue();
      
      // LEARNING: Repository Method Signature
      // updateShip expects (shipId, partialData) not a full Ship object
      // This is more flexible - we only send the fields we're changing
      await this.shipRepository.updateShip(this.shipId, {
        shipName: formValue.shipName,
        grossTonnage: formValue.grossTonnage,
        imoNumber: formValue.imoNumber,
        marineTrafficLink: formValue.marineTrafficLink,
        shipNotes: formValue.shipNotes
      });

      // Mark form as pristine (not dirty) after successful save
      // This prevents "unsaved changes" warnings
      this.shipForm.markAsPristine();

      this.snackBar.open('✓ Ship details updated successfully', 'Close', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
       panelClass: ['success-snackbar']
      });
    } catch (error) {
      console.error('Failed to update ship:', error);
      this.snackBar.open('✗ Failed to update ship details', 'Close', {
        duration: 5000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
        panelClass: ['error-snackbar']
      });
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Helper to check if the form has been modified.
   * Used to conditionally show the save button.
   */
  get hasChanges(): boolean {
    return this.shipForm.dirty;
  }
}
