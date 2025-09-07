import { Component, inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { DataService } from '../services/data.service';
import { ChargeableEvent } from '../models/trip.model';
import { CommonModule } from '@angular/common';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
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
  private readonly dialogRef = inject(MatDialogRef<CreateChargeDialogComponent>);
  readonly data: ChargeableEvent = inject(MAT_DIALOG_DATA);

  form!: FormGroup;
  isSaving = false;

  ngOnInit(): void {
    // Initialize the form with the data passed into the dialog
    this.form = this.fb.group({
      ship: [this.data.ship, Validators.required],
      gt: [this.data.gt, Validators.required],
      boarding: [this.data.boarding, Validators.required],
      port: [this.data.port, Validators.required],
      pilot: [this.data.pilot, Validators.required],
      typeTrip: [this.data.typeTrip, Validators.required],
      note: [this.data.note],
      extra: [this.data.extra],
    });
  }

  async onSave() {
    if (this.form.invalid || this.isSaving) {
      return;
    }
    this.isSaving = true;

    try {
      // Call the data service to create the charge and update the visit
      await this.dataService.createChargeAndUpdateVisit(
        this.form.value,
        this.data.visitDocId,
        this.data.tripDirection
      );
      this.dialogRef.close('success'); // Close the dialog and signal success
    } catch (error) {
      console.error('Error creating charge:', error);
      // Optionally, show an error message to the user here
      this.isSaving = false;
    }
  }

  onCancel(): void {
    this.dialogRef.close();
  }
}
