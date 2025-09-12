import { Component, inject, Inject, OnInit, Optional } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { DataService } from '../services/data.service';
import { AuthService } from '../auth/auth';
import { ChargeableEvent, Port } from '../models/trip.model';
import { CommonModule } from '@angular/common';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatNativeDateModule } from '@angular/material/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MAT_DATE_LOCALE } from '@angular/material/core';

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
    MatSnackBarModule,
    MatSelectModule,
  ],
  templateUrl: './create-charge-dialog.html',
  styleUrl: './create-charge-dialog.css',
  providers: [
    { provide: MAT_DATE_LOCALE, useValue: 'en-GB' },
  ]
})
export class CreateChargeDialogComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly dataService = inject(DataService);
  private readonly authService = inject(AuthService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialogRef = inject(MatDialogRef<CreateChargeDialogComponent>);

  // data can be null when creating a new charge from scratch
  readonly isEditMode: boolean;
  readonly title: string;

  form!: FormGroup;
  isSaving = false;

  readonly tripTypes = ['In', 'Out', 'Anchorage', 'Shift', 'Other'];
  readonly ports: Port[] = ['Anchorage', 'Cappa', 'Moneypoint', 'Tarbert', 'Foynes', 'Aughinish', 'Shannon', 'Limerick'];

  constructor(@Optional() @Inject(MAT_DIALOG_DATA) readonly data: ChargeableEvent | null) {
    this.isEditMode = !!this.data;
    this.title = this.isEditMode ? `Create Charge for ${this.data!.ship}` : 'Create New Trip';
  }

  ngOnInit(): void {
    const currentUser = this.authService.currentUserSig();

    // Initialize the form with the data passed into the dialog
    this.form = this.fb.group({
      ship: [this.data?.ship || '', Validators.required],
      gt: [this.data?.gt || null, Validators.required],
      boarding: [this.data?.boarding || new Date(), Validators.required],
      port: [this.data?.port || null, Validators.required],
      pilot: [this.data?.pilot || currentUser?.displayName || '', Validators.required],
      typeTrip: [this.data?.typeTrip || '', Validators.required],
      note: [this.data?.note || ''],
      extra: [this.data?.extra || ''],
    });
  }

  async onSave() {
    if (this.form.invalid || this.isSaving) {
      return;
    }
    this.isSaving = true;

    if (this.isEditMode) {
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
      await this.dataService.createChargeAndUpdateVisit(this.form.value, this.data!.visitDocId, this.data!.tripDirection);
      this.dialogRef.close('success');
    } catch (error) {
      console.error('Error creating charge from visit:', error);
      this.isSaving = false;
    }
  }

  onCancel(): void {
    this.dialogRef.close();
  }
}
