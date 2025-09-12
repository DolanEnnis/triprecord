import { Component, inject, Inject, OnInit, Optional } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { DataService } from '../services/data.service';
import { AuthService } from '../auth/auth';
import { Charge, ChargeableEvent, Port } from '../models/trip.model';
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
import { debounceTime, distinctUntilChanged, startWith, switchMap } from 'rxjs/operators';

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

  readonly mode: 'fromVisit' | 'editCharge' | 'new';
  private readonly eventToProcess: ChargeableEvent | null = null;
  private readonly chargeToEdit: Charge | null = null;
  readonly title: string;

  form!: FormGroup;
  isSaving = false;
  filteredShips$!: Observable<{ ship: string, gt: number }[]>;

  readonly maxDate = new Date();
  readonly tripTypes = ['In', 'Out', 'Anchorage', 'Shift', 'Other'];
  readonly ports: Port[] = ['Anchorage', 'Cappa', 'Moneypoint', 'Tarbert', 'Foynes', 'Aughinish', 'Shannon', 'Limerick'];

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
    const initialData = this.eventToProcess || this.chargeToEdit;

    // Initialize the form with the data passed into the dialog
    this.form = this.fb.group({
      ship: [initialData?.ship || '', Validators.required],
      gt: [initialData?.gt || null, Validators.required],
      boarding: [initialData?.boarding || new Date(), Validators.required],
      port: [initialData?.port || null, Validators.required],
      pilot: [initialData?.pilot || currentUser?.displayName || '', Validators.required],
      typeTrip: [initialData?.typeTrip || '', Validators.required],
      note: [initialData?.note || ''],
      extra: [initialData?.extra || ''],
    });

    this.filteredShips$ = this.form.get('ship')!.valueChanges.pipe(
      startWith(''),
      debounceTime(300), // Wait for 300 ms of silence before querying
      distinctUntilChanged(), // Only query if the value has changed
      switchMap(value => {
        // We only want to search if the user has typed a string of 2+ characters.
        if (typeof value === 'string' && value.length > 1) {
          return this.dataService.getShipSuggestions(value);
        } else {
          // Otherwise, return an empty array of suggestions.
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
      const exists = await this.dataService.doesChargeExist(this.form.value);
      if (exists) {
        this.warnAndSave();
      } else {
        await this.saveStandaloneCharge();
      }
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

    // If the snackbar is dismissed without the user clicking the action,
    // we should reset the saving state.
    snackBarRef.afterDismissed().subscribe(({ dismissedByAction }) => {
      if (!dismissedByAction) {
        this.isSaving = false;
      }
    });
  }

  private async saveStandaloneCharge(): Promise<void> {
    try {
      await this.dataService.createStandaloneCharge(this.form.value);
      this.dialogRef.close('success');
    } catch (error) {
      console.error('Error creating standalone charge:', error);
      this.isSaving = false;
    }
  }

  private async saveChargeFromVisit(): Promise<void> {
    try {
      await this.dataService.createChargeAndUpdateVisit(this.form.value, this.eventToProcess!.visitDocId, this.eventToProcess!.tripDirection);
      this.dialogRef.close('success');
    } catch (error) {
      console.error('Error creating charge from visit:', error);
      this.isSaving = false;
    }
  }

  private async updateExistingCharge(): Promise<void> {
    try {
      await this.dataService.updateCharge(this.chargeToEdit!.id!, this.form.value);
      this.dialogRef.close('success');
    } catch (error) {
      console.error('Error updating charge:', error);
      this.isSaving = false;
    }
  }

  onCancel(): void {
    this.dialogRef.close();
  }

  onShipSelected(event: MatAutocompleteSelectedEvent): void {
    const selectedShip: { ship: string, gt: number } = event.option.value;
    this.form.get('ship')?.setValue(selectedShip.ship);
    this.form.get('gt')?.setValue(selectedShip.gt);
  }
}
