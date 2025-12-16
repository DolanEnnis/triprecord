import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ShipPasteParserService, ParsedShipData } from '../services/ship-paste-parser.service';
import { ShipRepository } from '../services/ship.repository';
import { VisitRepository } from '../services/visit.repository';
import { DataService } from '../services/data.service';
import { Ship, Visit } from '../models/data.model';
import { Timestamp, serverTimestamp } from '@angular/fire/firestore';

interface ComparisonResult {
  existingShip?: Ship;
  existingVisit?: Visit;
  isNewShip: boolean;
  isNewVisit: boolean;
  hasChanges: boolean;
  changes: string[];
}

@Component({
  selector: 'app-quick-add-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatCardModule,
    MatIconModule,
    MatProgressSpinnerModule
  ],
  template: `
    <h2 mat-dialog-title>Quick Add Ship from Port Report</h2>
    
    <mat-dialog-content>
      @if (!parsedData()) {
        <!-- Paste Input -->
        <mat-form-field class="full-width">
          <mat-label>Paste ship data from port report</mat-label>
          <textarea 
            matInput 
            [(ngModel)]="pastedText"
            rows="3"
            placeholder="Example: S Breeze ARGO TT T 52454 30046 189.99 32.26 10.93 Trombets Eta 08/1800 A01 Bauxite Imports">
          </textarea>
          <mat-hint>Format: ShipName AGENT DWT GT LOA BEAM DRAFT LastPort Eta DD/HHMM BERTH</mat-hint>
        </mat-form-field>

        @if (parseError()) {
          <div class="error-message">
            <mat-icon color="warn">error</mat-icon>
            <p>{{ parseError() }}</p>
          </div>
        }
      } @else {
        <!-- Parsed Data Display -->
        <div class="parsed-data">
          <h3>Parsed Information</h3>
          <mat-card appearance="outlined">
            <mat-card-content>
              <div class="data-row">
                <strong>Ship Name:</strong>
                <span>{{ parsedData()!.shipName }}</span>
              </div>
              <div class="data-row">
                <strong>Gross Tonnage:</strong>
                <span>{{ parsedData()!.grossTonnage }}</span>
              </div>
              <div class="data-row">
                <strong>ETA:</strong>
                <span>{{ parsedData()!.eta | date:'EEE dd MMM yyyy HH:mm' }}</span>
              </div>
              <div class="data-row">
                <strong>Berth:</strong>
                <span>{{ parsedData()!.berthPort }}</span>
              </div>
            </mat-card-content>
          </mat-card>

          <!-- Comparison Results -->
          @if (loading()) {
            <div class="loading-container">
              <mat-spinner diameter="40"></mat-spinner>
              <p>Checking existing data...</p>
            </div>
          }

          @if (comparison()) {
            <div class="comparison-results">
              <h3>Comparison with Existing Data</h3>
              
              @if (comparison()!.isNewShip) {
                <div class="status-card new">
                  <mat-icon>add_circle</mat-icon>
                  <p><strong>New Ship:</strong> This ship is not in the system</p>
                </div>
              } @else {
                <div class="status-card existing">
                  <mat-icon>check_circle</mat-icon>
                  <p><strong>Existing Ship:</strong> Found in database</p>
                </div>
              }

              @if (comparison()!.isNewVisit) {
                <div class="status-card new">
                  <mat-icon>add_circle</mat-icon>
                  <p><strong>New Visit:</strong> No active visit for this ship</p>
                </div>
              } @else {
                <div class="status-card existing">
                  <mat-icon>check_circle</mat-icon>
                  <p><strong>Existing Visit:</strong> Active visit found</p>
                  
                  @if (comparison()!.hasChanges) {
                    <div class="changes-list">
                      <p><strong>Detected changes:</strong></p>
                      <ul>
                        @for (change of comparison()!.changes; track change) {
                          <li>{{ change }}</li>
                        }
                      </ul>
                    </div>
                  } @else {
                    <p class="no-changes">No changes detected</p>
                  }
                </div>
              }
            </div>
          }
        </div>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button (click)="cancel()">Cancel</button>
      
      @if (!parsedData()) {
        <button mat-raised-button color="primary" (click)="parse()" [disabled]="!pastedText.trim()">
          Parse
        </button>
      } @else if (comparison()) {
        @if (comparison()!.isNewShip || comparison()!.isNewVisit) {
          <button mat-raised-button color="primary" (click)="addToFirebase()" [disabled]="saving()">
            @if (saving()) {
              <mat-spinner diameter="20"></mat-spinner>
            }
            Add to Firebase
          </button>
        }
        @if (!comparison()!.isNewVisit && comparison()!.hasChanges) {
          <button mat-raised-button color="accent" (click)="updateFirebase()" [disabled]="saving()">
            @if (saving()) {
              <mat-spinner diameter="20"></mat-spinner>
            }
            Update Existing
          </button>
        }
        <button mat-button (click)="reset()">Parse Another</button>
      }
    </mat-dialog-actions>
  `,
  styles: [`
    .full-width {
      width: 100%;
      margin-bottom: 16px;
    }

    .error-message {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px;
      background-color: #ffebee;
      border-radius: 4px;
      color: #c62828;
    }

    .parsed-data h3 {
      margin-top: 0;
      color: #1976d2;
    }

    .data-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #eee;
    }

    .data-row:last-child {
      border-bottom: none;
    }

    .loading-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 24px;
      gap: 12px;
    }

    .comparison-results {
      margin-top: 24px;
    }

    .status-card {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 16px;
      margin: 12px 0;
      border-radius: 8px;
      border-left: 4px solid;
    }

    .status-card.new {
      background-color: #e8f5e9;
      border-left-color: #4caf50;
    }

    .status-card.new mat-icon {
      color: #4caf50;
    }

    .status-card.existing {
      background-color: #e3f2fd;
      border-left-color: #2196f3;
    }

    .status-card.existing mat-icon {
      color: #2196f3;
    }

    .changes-list {
      margin-top: 12px;
      padding-left: 36px;
    }

    .changes-list ul {
      margin: 8px 0;
      padding-left: 20px;
    }

    .changes-list li {
      margin: 4px 0;
      color: #e65100;
    }

    .no-changes {
      color: #4caf50;
      font-style: italic;
      margin-left: 36px;
    }

    mat-dialog-actions button {
      margin-left: 8px;
    }
  `]
})
export class QuickAddDialogComponent {
  private dialogRef = inject(MatDialogRef<QuickAddDialogComponent>);
  private parser = inject(ShipPasteParserService);
  private shipRepository = inject(ShipRepository);
  private visitRepository = inject(VisitRepository);
  private dataService = inject(DataService);

  pastedText = '';
  parsedData = signal<ParsedShipData | null>(null);
  parseError = signal<string | null>(null);
  loading = signal(false);
  saving = signal(false);
  comparison = signal<ComparisonResult | null>(null);

  parse(): void {
    this.parseError.set(null);
    const parsed = this.parser.parseShipData(this.pastedText);
    
    if (!parsed) {
      this.parseError.set('Could not parse the pasted text. Please check the format.');
      return;
    }

    this.parsedData.set(parsed);
    this.compareWithExisting(parsed);
  }

  private compareWithExisting(data: ParsedShipData): void {
    this.loading.set(true);

    // Check if ship exists
    this.shipRepository.searchShipsByName(data.shipName).subscribe({
      next: (ships: Ship[]) => {
        const existingShip = ships.find((s: Ship) => 
          s.shipName.toLowerCase() === data.shipName.toLowerCase()
        );

        if (existingShip) {
          // Ship exists, check for active visit
          this.checkActiveVisit(existingShip, data);
        } else {
          // New ship
          this.comparison.set({
            isNewShip: true,
            isNewVisit: true,
            hasChanges: false,
            changes: []
          });
          this.loading.set(false);
        }
      },
      error: (err: any) => {
        console.error('Error checking ship:', err);
        this.loading.set(false);
      }
    });
  }

  private checkActiveVisit(ship: Ship, data: ParsedShipData): void {
    this.visitRepository.getActiveVisits().subscribe({
      next: (visits) => {
        const existingVisit = visits.find(v => v.shipId === ship.id);
        
        const changes: string[] = [];
        
        // Check for GT mismatch
        if (ship.grossTonnage !== data.grossTonnage) {
          changes.push(`GT: ${ship.grossTonnage} → ${data.grossTonnage}`);
        }

        if (existingVisit) {
          // Compare ETA
          const existingEta = existingVisit.initialEta instanceof Timestamp 
            ? existingVisit.initialEta.toDate()
            : existingVisit.initialEta;
          
          if (Math.abs(existingEta.getTime() - data.eta.getTime()) > 60000) {
            changes.push(`ETA: ${existingEta.toLocaleString()} → ${data.eta.toLocaleString()}`);
          }

          // Compare berth
          if (existingVisit.berthPort !== data.berthPort) {
            changes.push(`Berth: ${existingVisit.berthPort} → ${data.berthPort}`);
          }
        }

        this.comparison.set({
          existingShip: ship,
          existingVisit,
          isNewShip: false,
          isNewVisit: !existingVisit,
          hasChanges: changes.length > 0,
          changes
        });
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Error checking visit:', err);
        this.loading.set(false);
      }
    });
  }

  async addToFirebase(): Promise<void> {
    const data = this.parsedData();
    if (!data) return;

    this.saving.set(true);

    try {
      await this.dataService.addNewVisitFromPaste({
        shipName: data.shipName,
        grossTonnage: data.grossTonnage,
        imoNumber: null,
        marineTrafficLink: null,
        shipNotes: null,
        initialEta: data.eta,
        berthPort: data.berthPort,
        visitNotes: `Added from port report paste`,
        source: 'Sheet',
        pilot: undefined
      });

      this.dialogRef.close({ success: true, action: 'added' });
    } catch (error) {
      console.error('Error adding to Firebase:', error);
      this.parseError.set('Failed to add to Firebase. Please try again.');
      this.saving.set(false);
    }
  }

  async updateFirebase(): Promise<void> {
    const data = this.parsedData();
    const comp = this.comparison();
    if (!data || !comp || !comp.existingVisit) return;

    this.saving.set(true);

    try {
      // Update ship GT if changed
      if (comp.existingShip && comp.existingShip.grossTonnage !== data.grossTonnage) {
        await this.shipRepository.updateShip(comp.existingShip.id!, {
          grossTonnage: data.grossTonnage,
          updatedAt: serverTimestamp()
        });
      }

      // Update visit
      await this.visitRepository.updateVisit(comp.existingVisit.id!, {
        initialEta: Timestamp.fromDate(data.eta),
        berthPort: data.berthPort,
        updatedBy: 'Port Report Update'
      });

      this.dialogRef.close({ success: true, action: 'updated' });
    } catch (error) {
      console.error('Error updating Firebase:', error);
      this.parseError.set('Failed to update Firebase. Please try again.');
      this.saving.set(false);
    }
  }

  reset(): void {
    this.pastedText = '';
    this.parsedData.set(null);
    this.parseError.set(null);
    this.comparison.set(null);
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
