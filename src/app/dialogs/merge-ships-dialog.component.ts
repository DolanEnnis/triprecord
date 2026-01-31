import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatRadioModule } from '@angular/material/radio';
import { Ship } from '../models';
import { ShipMergeService, MergeShipData } from '../services/workflows/ship-merge.service';

/**
 * Data passed to the MergeShipsDialog.
 */
export interface MergeShipsDialogData {
  /** Ships that need to be merged */
  ships: Ship[];
  /** Type of duplicate match - 'imo' or 'name' */
  matchType: 'imo' | 'name';
  /** The IMO number these ships share (only for IMO matches) */
  imoNumber?: number;
  /** The ship name these ships share (only for name matches) */
  shipName?: string;
}

/**
 * Dialog for confirming ship merge operation.
 * 
 * LEARNING: WHY USE A DIALOG FOR MERGE?
 * - Merge is an irreversible, destructive operation
 * - Admin needs to see both ships side-by-side to make informed decision
 * - Explicit confirmation prevents accidental data loss
 * - Dialog isolates the decision-making from the list view
 * 
 * The dialog shows:
 * 1. Both ship records with their details
 * 2. Radio buttons to select which ship to KEEP
 * 3. GT selector if ships have different GT values
 * 4. MarineTraffic ID warning if they differ
 * 5. Clear warning about the irreversibility
 */
@Component({
  selector: 'app-merge-ships-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatRadioModule
  ],
  template: `
    <h2 mat-dialog-title class="merge-header">
      <mat-icon>merge_type</mat-icon>
      Merge Duplicate Ships
    </h2>
    
    <mat-dialog-content>
      <p class="subtitle">
        @if (data.matchType === 'imo') {
          These ships share IMO number <strong>{{ data.imoNumber }}</strong>:
        } @else {
          These ships share the name <strong>{{ data.shipName }}</strong>:
        }
      </p>
      
      <!-- Ship Selection -->
      <div class="ship-selection">
        <label class="section-label">Select the ship to KEEP:</label>
        
        @for (ship of data.ships; track ship.id) {
          <div 
            class="ship-option" 
            [class.selected]="selectedShipId === ship.id"
            (click)="selectShip(ship)">
            
            <div class="radio-indicator">
              <mat-icon>{{ selectedShipId === ship.id ? 'radio_button_checked' : 'radio_button_unchecked' }}</mat-icon>
            </div>
            
            <div class="ship-details">
              <div class="ship-name">{{ ship.shipName }}</div>
              <div class="ship-meta">
                <span class="gt-badge">{{ ship.grossTonnage | number }} GT</span>
                @if (ship.shipNotes) {
                  <span class="has-notes">
                    <mat-icon inline>notes</mat-icon> Has Notes
                  </span>
                }
                @if (ship.marineTrafficLink) {
                  <span class="has-link">
                    <mat-icon inline>link</mat-icon> MT Link
                  </span>
                }
              </div>
              @if (ship.shipNotes) {
                <div class="notes-preview">{{ ship.shipNotes | slice:0:100 }}...</div>
              }
            </div>
          </div>
        }
      </div>
      
      <!-- GT DIFFERENCE WARNING - Major red flag -->
      @if (hasGtDifference()) {
        <div class="danger-warning-box">
          <mat-icon>report</mat-icon>
          <div>
            <strong>⚠️ Gross Tonnage Mismatch!</strong>
            <p>
              These ships have different Gross Tonnages 
              ({{ uniqueGts[0] | number }} vs {{ uniqueGts[1] | number }} GT).
              This is a <strong>major red flag</strong> that these might be different vessels.
              Please verify this is truly the same ship before proceeding.
            </p>
          </div>
        </div>
        
        <div class="gt-selection">
          <label class="section-label">Select Gross Tonnage to use:</label>
          <div class="gt-options">
            @for (gt of uniqueGts; track gt) {
              <label class="gt-option">
                <input type="radio" name="gt" [value]="gt" [(ngModel)]="selectedGt">
                {{ gt | number }} GT
              </label>
            }
          </div>
        </div>
      }
      
      <!-- MarineTraffic Warning -->
      @if (mtComparison.match === 'different') {
        <div class="warning-box">
          <mat-icon color="warn">warning</mat-icon>
          <div>
            <strong>MarineTraffic ID Mismatch!</strong>
            <p>
              These ships have different MarineTraffic IDs 
              ({{ mtComparison.id1 }} vs {{ mtComparison.id2 }}).
              This suggests they might be different vessels. 
              Please verify before merging.
            </p>
          </div>
        </div>
      }
      
      <!-- Merge Summary -->
      @if (selectedShipId) {
        <div class="merge-summary">
          <mat-icon>info</mat-icon>
          <div>
            <strong>What will happen:</strong>
            <ul>
              <li>All visits from <em>{{ getSourceShip()?.shipName }}</em> will be moved to <em>{{ getTargetShip()?.shipName }}</em></li>
              <li>Notes from both ships will be combined</li>
              <li><em>{{ getSourceShip()?.shipName }}</em> will be permanently deleted</li>
            </ul>
          </div>
        </div>
      }
      
      <!-- Final Warning -->
      <div class="danger-box">
        <mat-icon>dangerous</mat-icon>
        <strong>This action cannot be undone!</strong>
      </div>
    </mat-dialog-content>
    
    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">Cancel</button>
      <button 
        mat-raised-button 
        color="warn" 
        [disabled]="!canMerge()"
        (click)="onMerge()">
        <mat-icon>merge_type</mat-icon>
        Merge Ships
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .merge-header {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #1976d2;
    }
    
    .subtitle {
      margin-bottom: 16px;
      color: #666;
    }
    
    .section-label {
      display: block;
      font-weight: 500;
      margin-bottom: 8px;
      color: #333;
    }
    
    .ship-selection {
      margin-bottom: 24px;
    }
    
    .ship-option {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 16px;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      margin-bottom: 12px;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    
    .ship-option:hover {
      border-color: #1976d2;
      background: #f5f9ff;
    }
    
    .ship-option.selected {
      border-color: #1976d2;
      background: #e3f2fd;
    }
    
    .radio-indicator mat-icon {
      color: #1976d2;
    }
    
    .ship-details {
      flex: 1;
    }
    
    .ship-name {
      font-size: 1.1em;
      font-weight: 600;
      margin-bottom: 4px;
    }
    
    .ship-meta {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 8px;
    }
    
    .gt-badge {
      background: #e3f2fd;
      color: #1565c0;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.85em;
      font-weight: 500;
    }
    
    .has-notes, .has-link {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 0.85em;
      color: #666;
    }
    
    .has-notes mat-icon, .has-link mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    
    .notes-preview {
      font-size: 0.85em;
      color: #888;
      font-style: italic;
    }
    
    .gt-selection {
      margin-bottom: 24px;
    }
    
    .gt-options {
      display: flex;
      gap: 16px;
    }
    
    .gt-option {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      cursor: pointer;
    }
    
    .gt-option:hover {
      background: #f5f5f5;
    }
    
    .warning-box {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 16px;
      background: #fff3e0;
      border-radius: 8px;
      margin-bottom: 16px;
    }
    
    .warning-box mat-icon {
      color: #f57c00;
      flex-shrink: 0;
    }
    
    .warning-box p {
      margin: 4px 0 0 0;
      font-size: 0.9em;
    }
    
    .merge-summary {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 16px;
      background: #e3f2fd;
      border-radius: 8px;
      margin-bottom: 16px;
    }
    
    .merge-summary mat-icon {
      color: #1976d2;
      flex-shrink: 0;
    }
    
    .merge-summary ul {
      margin: 8px 0 0 0;
      padding-left: 20px;
    }
    
    .merge-summary li {
      margin-bottom: 4px;
    }
    
    .danger-warning-box {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 16px;
      background: #ffebee;
      border: 2px solid #c62828;
      border-radius: 8px;
      margin-bottom: 16px;
      color: #b71c1c;
    }
    
    .danger-warning-box mat-icon {
      color: #c62828;
      flex-shrink: 0;
      font-size: 28px;
      width: 28px;
      height: 28px;
    }
    
    .danger-warning-box p {
      margin: 4px 0 0 0;
      font-size: 0.9em;
    }
    
    .danger-box {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      background: #ffebee;
      border-radius: 8px;
      color: #c62828;
    }
    
    mat-dialog-content {
      min-width: 450px;
      max-width: 600px;
    }
    
    mat-dialog-actions {
      padding: 16px 24px;
    }
  `]
})
export class MergeShipsDialogComponent {
  dialogRef = inject(MatDialogRef<MergeShipsDialogComponent>);
  data = inject<MergeShipsDialogData>(MAT_DIALOG_DATA);
  private mergeService = inject(ShipMergeService);
  
  selectedShipId: string | null = null;
  selectedGt: number | null = null;
  uniqueGts: number[] = [];
  
  mtComparison: { match: 'same' | 'different' | 'unknown'; id1: string | null; id2: string | null };
  
  constructor() {
    // Calculate unique GTs for selection
    this.uniqueGts = [...new Set(this.data.ships.map(s => s.grossTonnage))];
    
    // Default to first ship's GT
    if (this.uniqueGts.length > 0) {
      this.selectedGt = this.uniqueGts[0];
    }
    
    // Compare MarineTraffic links
    if (this.data.ships.length === 2) {
      this.mtComparison = this.mergeService.compareMarineTrafficLinks(
        this.data.ships[0],
        this.data.ships[1]
      );
    } else {
      this.mtComparison = { match: 'unknown', id1: null, id2: null };
    }
    
    // SMART AUTO-SELECTION: Pre-select the "better" ship to reduce admin effort
    // Priority: Ship with IMO > Ship with MarineTraffic link > No auto-selection
    this.autoSelectBestShip();
  }
  
  /**
   * Auto-selects the best ship candidate based on data quality.
   * 
   * LEARNING: WHY AUTO-SELECT?
   * - Reduces admin clicks for obvious choices
   * - IMO is a unique vessel identifier - if one ship has it, it's clearly the better record
   * - MarineTraffic link indicates the ship has been properly linked
   * - Admin still must click "Merge" to confirm (nothing is automatic)
   */
  private autoSelectBestShip(): void {
    if (this.data.ships.length !== 2) {
      // Only auto-select for 2-ship groups (most common case)
      return;
    }
    
    const [ship1, ship2] = this.data.ships;
    
    // Priority 1: If only one ship has an IMO number, select it
    const ship1HasImo = !!ship1.imoNumber && ship1.imoNumber >= 1000000;
    const ship2HasImo = !!ship2.imoNumber && ship2.imoNumber >= 1000000;
    
    if (ship1HasImo && !ship2HasImo) {
      this.selectShip(ship1);
      return;
    }
    if (ship2HasImo && !ship1HasImo) {
      this.selectShip(ship2);
      return;
    }
    
    // Priority 2: If only one ship has a MarineTraffic link, select it
    const ship1HasMT = !!ship1.marineTrafficLink;
    const ship2HasMT = !!ship2.marineTrafficLink;
    
    if (ship1HasMT && !ship2HasMT) {
      this.selectShip(ship1);
      return;
    }
    if (ship2HasMT && !ship1HasMT) {
      this.selectShip(ship2);
      return;
    }
    
    // No clear winner - leave unselected for admin to choose
  }
  
  selectShip(ship: Ship): void {
    this.selectedShipId = ship.id!;
    // Default GT to selected ship's GT
    this.selectedGt = ship.grossTonnage;
  }
  
  hasGtDifference(): boolean {
    return this.uniqueGts.length > 1;
  }
  
  getTargetShip(): Ship | undefined {
    return this.data.ships.find(s => s.id === this.selectedShipId);
  }
  
  getSourceShip(): Ship | undefined {
    return this.data.ships.find(s => s.id !== this.selectedShipId);
  }
  
  canMerge(): boolean {
    return this.selectedShipId !== null && this.selectedGt !== null;
  }
  
  onCancel(): void {
    this.dialogRef.close(null);
  }
  
  onMerge(): void {
    const targetShip = this.getTargetShip();
    const sourceShip = this.getSourceShip();
    
    if (!targetShip || !sourceShip || !this.selectedGt) {
      return;
    }
    
    // Return the merge data for the caller to execute
    const mergeData: MergeShipData = {
      targetShip,
      sourceShip,
      selectedGrossTonnage: this.selectedGt,
      mergeNotes: true  // Always merge notes per user's decision
    };
    
    this.dialogRef.close(mergeData);
  }
}
