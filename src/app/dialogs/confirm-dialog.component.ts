import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

export interface ConfirmDialogData {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean; // If true, confirm button is red (warn)
}

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <h1 mat-dialog-title>
      <mat-icon [class.text-warn]="data.isDestructive" class="align-middle mr-2">
        {{ data.isDestructive ? 'warning' : 'help_outline' }}
      </mat-icon>
      {{ data.title }}
    </h1>
    <div mat-dialog-content>
      <p class="text-base text-gray-700 whitespace-pre-line">{{ data.message }}</p>
    </div>
    <div mat-dialog-actions align="end">
      <button mat-button [mat-dialog-close]="false">{{ data.cancelText || 'Cancel' }}</button>
      <button mat-raised-button 
        [color]="data.isDestructive ? 'warn' : 'primary'"
        [mat-dialog-close]="true">
        {{ data.confirmText || 'Confirm' }}
      </button>
    </div>
  `,
  styles: [`
    .text-warn { color: #f44336; }
    .mr-2 { margin-right: 0.5rem; }
    .align-middle { vertical-align: middle; }
  `]
})
export class ConfirmDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<ConfirmDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ConfirmDialogData
  ) {}
}
