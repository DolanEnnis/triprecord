import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { ShipPasteParserService, ParsedShipData } from '../services/ship-paste-parser.service';
import { ShipRepository } from '../services/ship.repository';
import { VisitRepository } from '../services/visit.repository';
import { DataService } from '../services/data.service';
import { Ship, Visit } from '../models/data.model';
import { Timestamp, serverTimestamp } from '@angular/fire/firestore';

@Component({
  selector: 'app-port-reconciliation',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatIconModule
  ],
  templateUrl: './port-reconciliation.html',
  styleUrls: ['./port-reconciliation.css']
})
export class PortReconciliationComponent {
  private parser = inject(ShipPasteParserService);
  private shipRepository = inject(ShipRepository);
  private visitRepository = inject(VisitRepository);
  private dataService = inject(DataService);

  pastedText = signal('');
  parsedData = signal<ParsedShipData | null>(null);
  parseError = signal<string | null>(null);
  loading = signal(false);
  saving = signal(false);
  comparison = signal<ComparisonResult | null>(null);

  parse(): void {
    this.parseError.set(null);
    const parsed = this.parser.parseShipData(this.pastedText());
    
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
          s.shipName.trim().toLowerCase() === data.shipName.trim().toLowerCase()
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
        visitNotes: null,
        source: 'Sheet',
        pilot: undefined
      });

      this.reset();
      this.saving.set(false);
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
        updatedBy: 'Port Report'
      });

      this.reset();
      this.saving.set(false);
    } catch (error) {
      console.error('Error updating Firebase:', error);
      this.parseError.set('Failed to update Firebase. Please try again.');
      this.saving.set(false);
    }
  }

  reset(): void {
    this.pastedText.set('');
    this.parsedData.set(null);
    this.parseError.set(null);
    this.comparison.set(null);
  }
}

interface ComparisonResult {
  existingShip?: Ship;
  existingVisit?: Visit;
  isNewShip: boolean;
  isNewVisit: boolean;
  hasChanges: boolean;
  changes: string[];
}
