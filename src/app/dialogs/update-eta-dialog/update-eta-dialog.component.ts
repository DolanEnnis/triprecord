import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { DateTimePickerComponent } from '../../date-time-picker/date-time-picker.component';

@Component({
  selector: 'app-update-eta-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    DateTimePickerComponent
  ],
  template: `
    <h2 mat-dialog-title>Update ETA for {{ data.shipName }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form">
        <app-date-time-picker formControlName="newEta"></app-date-time-picker>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">Cancel</button>
      <button mat-raised-button color="primary" [disabled]="form.invalid" (click)="onSave()">Save</button>
    </mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-content {
      min-width: 300px;
      padding-top: 10px;
    }
  `]
})
export class UpdateEtaDialogComponent {
  private fb = inject(FormBuilder);
  private dialogRef = inject(MatDialogRef<UpdateEtaDialogComponent>);
  readonly data = inject<{ shipName: string, currentEta: Date }>(MAT_DIALOG_DATA);

  form = this.fb.group({
    newEta: [this.data.currentEta || new Date(), Validators.required]
  });

  onCancel(): void {
    this.dialogRef.close();
  }

  onSave(): void {
    if (this.form.valid) {
      this.dialogRef.close(this.form.value.newEta);
    }
  }
}
