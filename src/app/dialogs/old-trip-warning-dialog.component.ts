import { Component, inject } from '@angular/core';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { CommonModule } from '@angular/common';

/**
 * Dialog to warn users when they attempt to edit trips older than 60 days.
 * 
 * LEARNING: WHEN TO USE DIALOGS FOR WARNINGS
 * - Critical actions that could cause confusion or workflow issues
 * - Need to interrupt the user's flow with important information
 * - Require explicit user acknowledgment before proceeding
 * 
 * This dialog helps prevent accidental edits to historical data while still
 * allowing authorized edits when necessary.
 */
@Component({
  selector: 'app-old-trip-warning-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <h2 mat-dialog-title>
      <mat-icon color="warn">warning</mat-icon>
      Editing Old Trip
    </h2>
    
    <mat-dialog-content>
      <p><strong>This trip is {{ data.tripAgeDays }} days old.</strong></p>
      
      <p>Editing trips older than 60 days is generally discouraged because:</p>
      <ul>
        <li>Historical records should remain unchanged for accuracy</li>
        <li>Changes may affect past reports or reconciliations</li>
        <li>The data may be part of completed billing cycles</li>
      </ul>
      
      <p>If you only wanted to view this trip, please use the <strong>Cancel</strong> button instead of saving.</p>
      
      <p><em>Are you sure you want to save changes to this old trip?</em></p>
    </mat-dialog-content>
    
    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">
        Cancel
      </button>
      <button mat-raised-button color="warn" (click)="onConfirm()">
        <mat-icon>edit</mat-icon>
        Edit Anyway
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    h2 {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    mat-dialog-content {
      min-width: 400px;
    }
    
    mat-dialog-content p {
      margin: 12px 0;
    }
    
    mat-dialog-content ul {
      margin: 8px 0;
      padding-left: 24px;
    }
    
    mat-dialog-content li {
      margin: 4px 0;
    }
    
    mat-dialog-actions {
      padding: 16px 24px;
    }
  `]
})
export class OldTripWarningDialogComponent {
  dialogRef = inject(MatDialogRef<OldTripWarningDialogComponent>);
  data = inject<{ tripAgeDays: number }>(MAT_DIALOG_DATA);

  onCancel(): void {
    this.dialogRef.close(false);
  }

  onConfirm(): void {
    this.dialogRef.close(true);
  }
}
