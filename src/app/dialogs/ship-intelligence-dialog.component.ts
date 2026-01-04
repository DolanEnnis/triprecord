import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ShipIntelligenceData } from '../services/ship-intelligence.service';

/**
 * Data structure for the ship information currently in the form.
 * 
 * LEARNING: WHY CREATE INTERFACES INSTEAD OF USING 'any'
 * - Type safety: Prevents typos and catches errors at compile time
 * - IntelliSense: Get autocomplete for field names
 * - Self-documenting: Anyone reading the code knows what fields exist
 * - Refactoring safety: If you rename a field, TypeScript finds all usages
 */
export interface CurrentShipData {
  shipName?: string;
  grossTonnage?: string | number;
  // Note: DWT and Manager are not currently tracked in the form,
  // so they're not included here. Add them when the form model supports them.
}

/**
 * Dialog data containing both current form data and fetched AI intelligence.
 */
export interface ShipIntelligenceDialogData {
  currentData: CurrentShipData;
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
          <!-- DWT and Manager not shown because form doesn't track them yet -->
          <!-- When adding these fields to the form, uncomment and bind to data.currentData -->
          <!--
          <div class="field">
            <label>DWT</label>
            <div>{{ data.currentData.deadweightTonnage || '-' }}</div>
          </div>
          <div class="field">
            <label>Manager</label>
            <div>{{ data.currentData.manager || '-' }}</div>
          </div>
          -->
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
  /**
   * LEARNING: MODERN ANGULAR DEPENDENCY INJECTION
   * 
   * **Old way (constructor injection):**
   * ```typescript
   * constructor(@Inject(MAT_DIALOG_DATA) public data: ShipIntelligenceDialogData) {}
   * ```
   * 
   * **Modern way (inject() function):**
   * ```typescript
   * readonly data = inject<ShipIntelligenceDialogData>(MAT_DIALOG_DATA);
   * ```
   * 
   * **Why the modern way is better:**
   * 1. More concise - less boilerplate code
   * 2. Consistent - same pattern used in other modern dialogs
   * 3. Type inference - TypeScript can often infer types automatically
   * 4. Composability - Can be used in functions, not just constructors
   * 
   * The `inject()` function was introduced in Angular 14 and is now the
   * recommended approach for dependency injection.
   */
  readonly data = inject<ShipIntelligenceDialogData>(MAT_DIALOG_DATA);
}
