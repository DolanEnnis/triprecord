import { Component, inject, Inject, OnInit, Optional } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { DataService } from '../services/data.service';
import { AuthService } from '../auth/auth';
import { Charge, ChargeableEvent } from '../models/trip.model';
import { Port, TripType } from '../models/data.model';
import { CommonModule } from '@angular/common';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { DateAdapter, MatNativeDateModule } from '@angular/material/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Observable, of } from 'rxjs';
import { debounceTime, distinctUntilChanged, startWith, switchMap, tap } from 'rxjs/operators';
import { ConfirmationDialogComponent } from '../shared/confirmation-dialog/confirmation-dialog.component';

export type ChargeDialogData = { mode: 'fromVisit', event: ChargeableEvent } | { mode: 'editCharge', charge: Charge } | null;

@Component({
  selector: 'app-create-charge-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatProgressSpinnerModule,
    MatAutocompleteModule,
    MatSnackBarModule,
    MatSelectModule,
  ],
  templateUrl: './create-charge-dialog.html',
  styleUrl: './create-charge-dialog.css',
})
export class CreateChargeDialogComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly dataService = inject(DataService);
  private readonly authService = inject(AuthService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialogRef = inject(MatDialogRef<CreateChargeDialogComponent>);
  private readonly dialog = inject(MatDialog);

  readonly mode: 'fromVisit' | 'editCharge' | 'new';
  private readonly eventToProcess: ChargeableEvent | null = null;
  private readonly chargeToEdit: Charge | null = null;
  readonly title: string;

  isSaving = false;
  filteredShips$!: Observable<{ ship: string, gt: number }[]>;

  readonly maxDate = new Date();

  // 🚀 FIX 3: Define the constant arrays using the imported types for the template
  readonly tripTypes: TripType[] = ['In', 'Out', 'Anchorage', 'Shift', 'BerthToBerth', 'Other'];
  readonly ports: Port[] = ['Anchorage', 'Cappa', 'Moneypoint', 'Tarbert', 'Foynes', 'Aughinish', 'Shannon', 'Limerick'];

  // Form is initialized in the constructor to ensure all properties are available.
  readonly form: FormGroup = this.fb.group({
    ship: ['', Validators.required],
    gt: [null as number | null, Validators.required],
    boarding: [new Date(), Validators.required],
    port: [null as Port | null, Validators.required],
    pilot: ['', Validators.required],
    typeTrip: ['', Validators.required],
    sailingNote: [''],
    extra: [''],
  });

  constructor(
    @Optional() @Inject(MAT_DIALOG_DATA) readonly dialogData: ChargeDialogData,
    private _adapter: DateAdapter<any>
  ) {
    this.mode = dialogData?.mode || 'new';

    if (dialogData && dialogData.mode === 'fromVisit') {
      this.eventToProcess = dialogData.event;
      this.title = `Create Charge for ${this.eventToProcess.ship}`;
    } else if (dialogData && dialogData.mode === 'editCharge') {
      this.chargeToEdit = dialogData.charge;
      this.title = `Edit Charge for ${this.chargeToEdit.ship}`;
    } else {
      this.title = 'Create New Trip';
    }

    // Force the date adapter to use the British English locale for dd/MM/yyyy format.
    this._adapter.setLocale('en-GB');
  }

  ngOnInit(): void {
    const currentUser = this.authService.currentUserSig();
    const initialData = this.chargeToEdit || this.eventToProcess;

    // Set form values based on dialog data
    this.form.patchValue({
      ...initialData,
      pilot: initialData?.pilot || currentUser?.displayName || '',
    });

    this.filteredShips$ = this.form.get('ship')!.valueChanges.pipe(
      startWith(''),
      debounceTime(300), // Wait for 300 ms of silence before querying
      distinctUntilChanged(), // Only query if the value has changed
      switchMap(value => { // `value` can be a string or a ship object
        const searchTerm = typeof value === 'string' ? value : value?.ship;
        if (typeof searchTerm === 'string' && searchTerm.length > 1) {
          return this.dataService.getShipSuggestions(searchTerm);
        } else {
          return of([]);
        }
      })
    );
  }

  async onSave() {
    if (this.form.invalid || this.isSaving) {
      return;
    }
    this.isSaving = true;

    if (this.mode === 'editCharge') {
      await this.updateExistingCharge();
    } else if (this.mode === 'fromVisit') {
      await this.saveChargeFromVisit();
    } else {
      // For a new standalone charge, we now directly create the underlying visit/trip.
      await this.saveStandaloneCharge();
    }
  }

  private warnAndSave(): void {
    const snackBarRef = this.snackBar.open(
      'A similar charge for this ship on this day already exists.',
      'Add Anyway',
      { duration: 7000 }
    );

    snackBarRef.onAction().subscribe(() => {
      this.saveStandaloneCharge();
    });

    snackBarRef.afterDismissed().subscribe(({ dismissedByAction }) => {
      if (!dismissedByAction) {
        this.isSaving = false;
      }
    });
  }

  private async saveStandaloneCharge(): Promise<void> {
    try {
      await this.dataService.createStandaloneCharge(this.form.value); // This now creates a Visit and Trip
      this.dialogRef.close('success');
    } catch (error: any) {
      console.error('Error creating standalone charge:', error);
      this.snackBar.open(`Error: ${error.message || 'Could not create trip.'}`, 'Close', { duration: 7000 });
      this.isSaving = false;
    }
  }

  private async saveChargeFromVisit(): Promise<void> {
    try {
      // The eventToProcess.tripId is the ID of the document in the /trips collection.
      if (!this.eventToProcess?.tripId || !this.eventToProcess?.visitId) {
        throw new Error('Cannot save charge: Trip or Visit ID is missing. This might be an old record.');
      }

      await this.dataService.confirmTripAndCreateCharge(
        this.form.value,
        this.eventToProcess.tripId,
        this.eventToProcess.visitId // Pass the required visitId
      );
      this.dialogRef.close('success');
    } catch (error: any) {
      console.error('Error creating charge from visit:', error);
      this.snackBar.open(`Error: ${error.message || 'Could not create trip from visit.'}`, 'Close', { duration: 7000 });
      this.isSaving = false;
    }
  }

  private async updateExistingCharge(): Promise<void> {
    try {
      // Ensure ship details are up-to-date when editing an existing charge.
      // This is now only needed here, as the create flow handles it.
      const { ship, gt } = this.form.value;
      if (ship && gt) {
        this.dataService.ensureShipDetails(ship, gt); // Fire-and-forget is fine here.
      }

      await this.dataService.updateCharge(this.chargeToEdit!.id!, this.form.value);
      this.dialogRef.close('success');
    } catch (error: any) {
      console.error('Error updating charge:', error);
      this.snackBar.open(`Error: ${error.message || 'Could not update trip.'}`, 'Close', { duration: 7000 });
      this.isSaving = false;
    }
  }

  onCancel(): void {
    this.dialogRef.close();
  }

  // This function is required by MatAutocomplete to display the correct value in the input field.
  displayShip(ship: { ship: string, gt: number }): string {
    return ship?.ship || '';
  }

  onShipSelected(event: MatAutocompleteSelectedEvent): void {
    // The `event.option.value` is now the complete ship object.
    const selectedShip: { ship: string, gt: number } = event.option.value;

    // When using [displayWith], the form control's value is the full object.
    // We need to explicitly patch the form to use the string for the 'ship' control
    // and the number for the 'gt' control to ensure the form values are correct for submission.
    this.form.patchValue({
      ship: selectedShip.ship,
      gt: selectedShip.gt
    });
  }

  async onDelete(): Promise<void> {
    if (!this.chargeToEdit?.id) {
      return;
    }

    const confirmDialogRef = this.dialog.open(ConfirmationDialogComponent, {
      data: {
        title: 'Confirm Deletion',
        message: 'Are you sure you want to permanently delete this charge? This action cannot be undone.'
      }
    });

    confirmDialogRef.afterClosed().subscribe(async (confirmed) => {
      if (confirmed) {
        this.isSaving = true;
        try {
          // 🛑 FIXED: Uses the cleaned facade method: deleteCharge
          await this.dataService.deleteCharge(this.chargeToEdit!.id!);
          this.dialogRef.close('deleted');
        } catch (error: any) {
          console.error('Error deleting charge:', error);
          this.snackBar.open(`Error: ${error.message || 'Could not delete trip.'}`, 'Close', { duration: 7000 });
          this.isSaving = false;
        }
      }
    });
  }
}
