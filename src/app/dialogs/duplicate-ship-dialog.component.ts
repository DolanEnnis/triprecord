import { Component, inject } from '@angular/core';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { CommonModule } from '@angular/common';

/**
 * Dialog shown when user tries to create a new ship with a name that already exists.
 * 
 * LEARNING: WHY THIS DIALOG EXISTS
 * - Ships can share names (e.g., "ATLANTIC TRADER" could be multiple vessels)
 * - We need to warn the user that a ship with this name exists
 * - They can choose to use the existing ship or create a new separate record
 * 
 * This prevents accidental duplicate entries while allowing intentional ones.
 */
@Component({
  selector: 'app-duplicate-ship-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <h2 mat-dialog-title class="warning-header">
      <mat-icon color="warn">warning</mat-icon>
      Ship Already Exists
    </h2>
    
    <mat-dialog-content>
      <p>A ship with a similar name already exists in the system:</p>
      
      <!-- Display existing ships that match -->
      <div class="existing-ships">
        @for (ship of data.existingShips; track ship.id) {
          <div class="ship-card">
            <strong>{{ ship.ship }}</strong>
            <span class="gt-badge">{{ ship.gt | number }} GT</span>
          </div>
        }
      </div>
      
      <p class="warning-text">
        <mat-icon>info</mat-icon>
        Creating a new ship will add a <strong>separate record</strong> with the same name.
        Only do this if you are sure it's a different vessel.
      </p>
    </mat-dialog-content>
    
    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">
        Cancel
      </button>
      <button mat-raised-button color="warn" (click)="onConfirm()">
        <mat-icon>add</mat-icon>
        Create New Ship Anyway
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .warning-header {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    mat-dialog-content {
      min-width: 400px;
      max-width: 500px;
    }
    
    .existing-ships {
      margin: 16px 0;
      padding: 12px;
      background: rgba(0, 0, 0, 0.04);
      border-radius: 8px;
    }
    
    .ship-card {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 12px;
      background: white;
      border-radius: 4px;
      margin-bottom: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    
    .ship-card:last-child {
      margin-bottom: 0;
    }
    
    .gt-badge {
      background: #e3f2fd;
      color: #1565c0;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 0.85em;
      font-weight: 500;
    }
    
    .warning-text {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 12px;
      background: #fff3e0;
      border-radius: 8px;
      color: #e65100;
      margin-top: 16px;
    }
    
    .warning-text mat-icon {
      flex-shrink: 0;
      margin-top: 2px;
    }
    
    mat-dialog-actions {
      padding: 16px 24px;
    }
  `]
})
export class DuplicateShipDialogComponent {
  dialogRef = inject(MatDialogRef<DuplicateShipDialogComponent>);
  data = inject<{ existingShips: { ship: string; gt: number; id: string }[] }>(MAT_DIALOG_DATA);

  onCancel(): void {
    // User cancels - they should select an existing ship instead
    this.dialogRef.close(false);
  }

  onConfirm(): void {
    // User confirms they want to create a new, separate ship record
    this.dialogRef.close(true);
  }
}
