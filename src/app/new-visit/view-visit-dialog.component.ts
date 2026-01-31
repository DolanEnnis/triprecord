
import { Component, Inject, signal, WritableSignal, inject, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCardModule } from '@angular/material/card';
import { VisitRepository } from '../services/repositories/visit.repository';
import { ShipRepository } from '../services/repositories/ship.repository';
import { TripRepository } from '../services/repositories/trip.repository';
import { Visit, Ship, Trip } from '../models';
import { forkJoin, of, catchError, from } from 'rxjs';
import { take, defaultIfEmpty } from 'rxjs/operators';
import { Timestamp } from '@angular/fire/firestore';

interface VisitDialogData {
  visitId: string;
}

interface VisitDetails {
  visit: Visit;
  ship: Ship | undefined;
  inwardTrip: Trip | undefined;
  outwardTrip: Trip | undefined;
}

@Component({
  selector: 'app-view-visit-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatCardModule
  ],
  template: `
    <div class="dialog-container">
      <div class="dialog-header">
        <h2 mat-dialog-title>
          <mat-icon>directions_boat</mat-icon>
          {{ visitDetails()?.ship?.shipName || 'Visit Details' }}
        </h2>
        <button mat-icon-button mat-dialog-close>
          <mat-icon>close</mat-icon>
        </button>
      </div>

      @if (loading()) {
        <div class="loading-container">
          <mat-progress-spinner mode="indeterminate" diameter="40"></mat-progress-spinner>
          <p>Loading visit details...</p>
        </div>
      } @else if (visitDetails()) {
        <mat-dialog-content>
          <!-- Visit Details -->
          <div class="section">
            <h3><mat-icon>event</mat-icon> Visit Information</h3>
            <div class="data-grid">
              <div class="data-item">
                <span class="label">Status:</span>
                <span class="value status-badge" [class]="'status-' + visitDetails()!.visit.currentStatus.toLowerCase().replace(' ', '-')">
                  {{ visitDetails()!.visit.currentStatus }}
                </span>
              </div>
              <div class="data-item">
                <span class="label">Initial ETA:</span>
                <span class="value">{{ formatDate(visitDetails()!.visit.initialEta) }}</span>
              </div>
              <div class="data-item">
                <span class="label">Berth:</span>
                <span class="value">{{ visitDetails()!.visit.berthPort || 'N/A' }}</span>
              </div>
              <div class="data-item">
                <span class="label">Source:</span>
                <span class="value">{{ visitDetails()!.visit.source || 'N/A' }}</span>
              </div>
              @if (visitDetails()!.visit.visitNotes) {
                <div class="data-item full-width">
                  <span class="label">Visit Notes:</span>
                  <span class="value">{{ visitDetails()!.visit.visitNotes }}</span>
                </div>
              }
            </div>
          </div>

          <!-- Inward Trip -->
          @if (visitDetails()!.inwardTrip) {
            <div class="section">
              <h3><mat-icon>arrow_downward</mat-icon> Inward Trip</h3>
              <div class="data-grid">
              @if (visitDetails()!.inwardTrip!.isConfirmed) {
                 <div class="data-item full-width">
                   <span class="value confirmed-badge">Confirmed</span>
                 </div>
              }
              <div class="data-item">
                <span class="label">Pilot:</span>
                <span class="value">{{ visitDetails()!.inwardTrip!.pilot || 'Unassigned' }}</span>
              </div>
              <div class="data-item">
                <span class="label">Boarding Time:</span>
                <span class="value">{{ formatDate(visitDetails()!.inwardTrip!.boarding) }}</span>
              </div>
              @if (visitDetails()!.inwardTrip!.pilotNo) {
                  <div class="data-item">
                    <span class="label">Pilot No:</span>
                    <span class="value">{{ visitDetails()!.inwardTrip!.pilotNo }}</span>
                  </div>
              }
              @if (visitDetails()!.inwardTrip!.monthNo) {
                  <div class="data-item">
                    <span class="label">Month No:</span>
                    <span class="value">{{ visitDetails()!.inwardTrip!.monthNo }}</span>
                  </div>
              }
              @if (visitDetails()!.inwardTrip!.car) {
                  <div class="data-item">
                    <span class="label">Car:</span>
                    <span class="value">{{ visitDetails()!.inwardTrip!.car }}</span>
                  </div>
              }
              @if (visitDetails()!.inwardTrip!.good) {
                  <div class="data-item">
                    <span class="label">Good:</span>
                    <span class="value">{{ visitDetails()!.inwardTrip!.good }}</span>
                  </div>
              }
              @if (visitDetails()!.inwardTrip!.extraChargesNotes) {
                <div class="data-item full-width">
                  <span class="label">Extra Charges:</span>
                  <span class="value">{{ visitDetails()!.inwardTrip!.extraChargesNotes }}</span>
                </div>
              }
              @if (visitDetails()!.inwardTrip!.ownNote) {
                <div class="data-item full-width">
                  <span class="label">Own Note:</span>
                  <span class="value">{{ visitDetails()!.inwardTrip!.ownNote }}</span>
                </div>
              }
              @if (visitDetails()!.inwardTrip!.pilotNotes) {
                <div class="data-item full-width">
                  <span class="label">Pilot Notes:</span>
                  <span class="value">{{ visitDetails()!.inwardTrip!.pilotNotes }}</span>
                </div>
              }
            </div>
            </div>
          } @else {
            <div class="section">
              <h3><mat-icon>arrow_downward</mat-icon> Inward Trip</h3>
              <p class="no-data">No inward trip recorded</p>
            </div>
          }

          <!-- Outward Trip -->
          @if (visitDetails()!.outwardTrip) {
            <div class="section">
              <h3><mat-icon>arrow_upward</mat-icon> Outward Trip</h3>
              <div class="data-grid">
              @if (visitDetails()!.outwardTrip!.isConfirmed) {
                 <div class="data-item full-width">
                   <span class="value confirmed-badge">Confirmed</span>
                 </div>
              }
              <div class="data-item">
                <span class="label">Pilot:</span>
                <span class="value">{{ visitDetails()!.outwardTrip!.pilot || 'Unassigned' }}</span>
              </div>
              <div class="data-item">
                <span class="label">Boarding Time:</span>
                <span class="value">{{ formatDate(visitDetails()!.outwardTrip!.boarding) }}</span>
              </div>
              @if (visitDetails()!.outwardTrip!.pilotNo) {
                  <div class="data-item">
                    <span class="label">Pilot No:</span>
                    <span class="value">{{ visitDetails()!.outwardTrip!.pilotNo }}</span>
                  </div>
              }
              @if (visitDetails()!.outwardTrip!.monthNo) {
                  <div class="data-item">
                    <span class="label">Month No:</span>
                    <span class="value">{{ visitDetails()!.outwardTrip!.monthNo }}</span>
                  </div>
              }
              @if (visitDetails()!.outwardTrip!.car) {
                  <div class="data-item">
                    <span class="label">Car:</span>
                    <span class="value">{{ visitDetails()!.outwardTrip!.car }}</span>
                  </div>
              }
              @if (visitDetails()!.outwardTrip!.good) {
                  <div class="data-item">
                    <span class="label">Good:</span>
                    <span class="value">{{ visitDetails()!.outwardTrip!.good }}</span>
                  </div>
              }
              @if (visitDetails()!.outwardTrip!.extraChargesNotes) {
                <div class="data-item full-width">
                  <span class="label">Extra Charges:</span>
                  <span class="value">{{ visitDetails()!.outwardTrip!.extraChargesNotes }}</span>
                </div>
              }
              @if (visitDetails()!.outwardTrip!.ownNote) {
                <div class="data-item full-width">
                  <span class="label">Own Note:</span>
                  <span class="value">{{ visitDetails()!.outwardTrip!.ownNote }}</span>
                </div>
              }
              @if (visitDetails()!.outwardTrip!.pilotNotes) {
                <div class="data-item full-width">
                  <span class="label">Pilot Notes:</span>
                  <span class="value">{{ visitDetails()!.outwardTrip!.pilotNotes }}</span>
                </div>
              }
            </div>
            </div>
          } @else {
            <div class="section">
              <h3><mat-icon>arrow_upward</mat-icon> Outward Trip</h3>
              <p class="no-data">No outward trip recorded</p>
            </div>
          }
        </mat-dialog-content>

        <mat-dialog-actions align="end">
          <button mat-button mat-dialog-close>Close</button>
          <button mat-raised-button color="primary" (click)="openFullEdit()">
            <mat-icon>edit</mat-icon> Edit This Visit
          </button>
        </mat-dialog-actions>
      } @else {
        <div class="error-container">
          <mat-icon color="warn">error</mat-icon>
          <p>Failed to load visit details</p>
          <button mat-button mat-dialog-close>Close</button>
        </div>
      }
    </div>
  `,
  styles: [`
    .dialog-container {
      max-width: 800px;
      min-width: 600px;
    }

    .dialog-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0 0 16px 0;
      border-bottom: 2px solid #e0e0e0;
    }

    .dialog-header h2 {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
      font-size: 1.5rem;
      color: #3f51b5;
    }

    .loading-container,
    .error-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px;
      gap: 16px;
    }

    .section {
      margin-bottom: 24px;
    }

    .section h3 {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 1.1rem;
      color: #3f51b5;
      margin: 0 0 12px 0;
      padding-bottom: 8px;
      border-bottom: 1px solid #e0e0e0;
    }

    .data-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px 24px;
    }

    .data-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .data-item.full-width {
      grid-column: 1 / -1;
    }

    .label {
      font-size: 0.85rem;
      color: #666;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .value {
      font-size: 1rem;
      color: #333;
      word-break: break-word;
    }

    .value-link {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: #1976d2;
      text-decoration: none;
      font-size: 1rem;
    }

    .value-link:hover {
      text-decoration: underline;
    }

    .value-link mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      font-weight: 500;
      font-size: 0.9rem;
    }

    .status-due {
      background-color: #e3f2fd;
      color: #1565c0;
    }

    .status-awaiting-berth {
      background-color: #fff3e0;
      color: #e65100;
    }

    .status-alongside {
      background-color: #e8f5e9;
      color: #2e7d32;
    }

    .status-sailed {
      background-color: #f5f5f5;
      color: #616161;
    }

    .status-cancelled {
      background-color: #ffebee;
      color: #c62828;
    }

    .confirmed-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      font-weight: 500;
      font-size: 0.9rem;
      background-color: #e8f5e9;
      color: #2e7d32;
      border: 1px solid #c8e6c9;
      width: fit-content;
    }

    mat-dialog-actions {
      padding: 16px 0 0 0;
      border-top: 1px solid #e0e0e0;
    }

    .no-data {
      color: #999;
      font-style: italic;
      margin: 8px 0;
    }

    @media (max-width: 700px) {
      .dialog-container {
        min-width: unset;
        width: 100%;
      }

      .data-grid {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class ViewVisitDialogComponent implements OnInit {
  private dialogRef = inject(MatDialogRef<ViewVisitDialogComponent>);
  private data = inject<VisitDialogData>(MAT_DIALOG_DATA);
  private visitRepo = inject(VisitRepository);
  private tripRepo = inject(TripRepository);
  private shipRepo = inject(ShipRepository);

  loading = signal(true);
  visitDetails = signal<VisitDetails | null>(null);

  ngOnInit() {
    this.loadVisitDetails();
  }

  private loadVisitDetails() {
    this.visitRepo.getVisitById(this.data.visitId).pipe(
      take(1)
    ).subscribe({
      next: (visit) => {
        if (!visit) {
          this.loading.set(false);
          console.error('[ViewVisitDialog] Visit not found');
          return;
        }

        // Use defaultIfEmpty to ensure forkJoin completes even if ship/trips are missing/empty
        forkJoin({
          visit: of(visit),
          ship: this.shipRepo.getShipById(visit.shipId).pipe(
            take(1),
            defaultIfEmpty(undefined),
            catchError(err => {
              console.error('Error loading ship:', err);
              return of(undefined);
            })
          ),
          trips: from(this.tripRepo.getTripsByVisitIdOnce(this.data.visitId)).pipe(
            catchError(err => {
              console.error('Error loading trips:', err);
              return of([]);
            })
          )
        }).subscribe({
          next: ({ visit, ship, trips }: { visit: Visit, ship: Ship | undefined, trips: Trip[] }) => {
            const inwardTrip = trips.find((t: Trip) => t.typeTrip === 'In');
            const outwardTrip = trips.find((t: Trip) => t.typeTrip === 'Out');

            this.visitDetails.set({
              visit,
              ship,
              inwardTrip,
              outwardTrip
            });
            this.loading.set(false);
          },
          error: (err) => {
            console.error('[ViewVisitDialog] Error loading details:', err);
            this.loading.set(false);
          }
        });
      },
      error: (err) => {
        console.error('Error loading visit:', err);
        this.loading.set(false);
      }
    });
  }

  formatDate(date: Date | Timestamp | null | undefined): string {
    if (!date) return 'N/A';
    const d = date instanceof Timestamp ? date.toDate() : date;
    return d.toLocaleString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  openFullEdit() {
    // Open edit page in new tab
    window.open(`/edit/${this.data.visitId}`, '_blank');
    this.dialogRef.close();
  }
}
