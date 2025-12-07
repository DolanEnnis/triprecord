import { Component, Inject, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ShipIntelligenceData } from '../services/ship-intelligence.service';

export interface ShipIntelligenceDialogData {
  currentData: any;
  fetchedData: ShipIntelligenceData;
}

@Component({
  selector: 'app-ship-intelligence-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <h2 mat-dialog-title>Ship Intelligence Report</h2>
    <mat-dialog-content>
      <div class="comparison-grid">
        <div class="column">
          <h3>Current Data</h3>
          <div class="field">
            <label>Name</label>
            <div>{{ data.currentData.shipName || '-' }}</div>
          </div>
          <div class="field">
            <label>GT</label>
            <div>{{ data.currentData.grossTonnage || '-' }}</div>
          </div>
          <div class="field">
            <label>DWT</label>
            <div>{{ '-' }}</div> <!-- Not currently in form model explicitly as DWT -->
          </div>
          <div class="field">
            <label>Manager</label>
            <div>{{ '-' }}</div> <!-- Not currently in form model -->
          </div>
        </div>

        <div class="column highlight">
          <h3>AI Intelligence</h3>
          <div class="field">
            <label>Name</label>
            <div>{{ data.fetchedData.shipName }}</div>
          </div>
          <div class="field">
            <label>GT</label>
            <div>{{ data.fetchedData.grossTonnage }}</div>
          </div>
          <div class="field">
            <label>DWT</label>
            <div>{{ data.fetchedData.deadweightTonnage }}</div>
          </div>
          <div class="field">
            <label>Manager</label>
            <div>{{ data.fetchedData.manager }}</div>
          </div>
        </div>
      </div>

      <div class="full-width-section" *ngIf="data.fetchedData.news">
        <h3>⚠️ News & Incidents</h3>
        <p class="news-alert">{{ data.fetchedData.news }}</p>
      </div>

      <div class="full-width-section">
        <h3>History</h3>
        <p><strong>Former Names:</strong> {{ data.fetchedData.formerNames.join(', ') || 'None' }}</p>
        <p><strong>Last Ports:</strong> {{ data.fetchedData.last4Ports.join(' → ') }}</p>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-raised-button color="primary" [mat-dialog-close]="data.fetchedData">
        <mat-icon>check</mat-icon> Accept & Fill
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .comparison-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 20px;
    }
    .column {
      padding: 15px;
      background: #f5f5f5;
      border-radius: 8px;
    }
    .column.highlight {
      background: #e3f2fd;
      border: 1px solid #2196f3;
    }
    .field {
      margin-bottom: 10px;
    }
    .field label {
      display: block;
      font-size: 0.8em;
      color: #666;
      font-weight: bold;
    }
    .news-alert {
      background: #fff3e0;
      color: #e65100;
      padding: 10px;
      border-radius: 4px;
      border-left: 4px solid #ff9800;
    }
    h3 { margin-top: 0; }
  `]
})
export class ShipIntelligenceDialogComponent {
  constructor(@Inject(MAT_DIALOG_DATA) public data: ShipIntelligenceDialogData) {}
}
