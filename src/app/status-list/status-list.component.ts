import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CommonModule, DatePipe } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatSortModule } from '@angular/material/sort';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { Router } from '@angular/router';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { RiverStateService } from '../services/river-state.service';
import { TimeAgoPipe } from '../shared/pipes/time-ago.pipe';
import { Visit } from '../models/data.model';
import { StatusListRow } from '../models/status-list.model';
import { Timestamp } from '@angular/fire/firestore';
import { UpdateEtaDialogComponent } from '../dialogs/update-eta-dialog/update-eta-dialog.component';
import { AuthService } from '../auth/auth';
import { VisitRepository } from '../services/visit.repository';

@Component({
  selector: 'app-status-list',
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule,
    MatSortModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatButtonToggleModule,
    MatDialogModule,
    DatePipe,
    TimeAgoPipe
  ],
  templateUrl: './status-list.component.html',
  styleUrl: './status-list.component.css'
})
export class StatusListComponent {
  private readonly riverState = inject(RiverStateService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly authService = inject(AuthService);
  private readonly visitRepository = inject(VisitRepository);

  // Filter Signal - Persisted in localStorage
  readonly portFilter = signal<'All' | 'Aughinish' | 'Foynes' | 'Limerick' | 'Other'>(
    (localStorage.getItem('statusListPortFilter') as any) || 'All'
  );

  // Data Signals (using toSignal to convert Observables to Signals)
  readonly dueShips = toSignal(this.visitRepository.getVisitsWithTripDetails('Due'), { initialValue: [] });
  readonly awaitingBerthShips = toSignal(this.visitRepository.getVisitsWithTripDetails('Awaiting Berth'), { initialValue: [] });
  readonly alongsideShips = toSignal(this.visitRepository.getVisitsWithTripDetails('Alongside'), { initialValue: [] });

  // Computed Filtered Signals (filtering logic remains the same)
  readonly filteredDueShips = computed(() => this.filterShips(this.dueShips()));
  readonly filteredAwaitingBerthShips = computed(() => this.filterShips(this.awaitingBerthShips()));
  readonly filteredAlongsideShips = computed(() => this.filterShips(this.alongsideShips()));

  // Columns: Ship, Date (ETA/ETD), Port, Note, Pilot, Updated, Actions
  displayedColumns: string[] = ['ship', 'officeTime', 'port', 'note', 'pilot', 'updated', 'actions'];

  editTrip(row: StatusListRow) {
    if (row.visitId) {
      this.router.navigate(['/edit', row.visitId]);
    }
  }

  openEtaDialog(row: StatusListRow) {
    const dialogRef = this.dialog.open(UpdateEtaDialogComponent, {
      data: { shipName: row.shipName, currentEta: row.date }
    });

    dialogRef.afterClosed().subscribe(async (newDate: Date | undefined) => {
      if (newDate) {
        const currentUser = this.authService.currentUserSig()?.displayName || 'Unknown';
        try {
          // StatusListRow now has tripId (optional) and visitId
          await this.visitRepository.updateVisitDate(
            row.visitId,
            row.tripId,
            row.status as any, // Cast to VisitStatus if needed
            newDate,
            currentUser
          );
        } catch (error) {
          console.error('Failed to update ETA:', error);
          // Ideally show a snackbar here
        }
      }
    });
  }

  // Helper to filter a list of visits based on the current port filter
  private filterShips(ships: StatusListRow[]): StatusListRow[] {
    const filter = this.portFilter();
    if (filter === 'All') {
      return ships;
    }

    return ships.filter(ship => {
      // Use 'port' field from StatusListRow which is already flattened
      const port = ship.port || '';
      if (filter === 'Other') {
        // Show if it's NOT one of the main named ports
        return !['aughinish', 'foynes', 'limerick'].includes(port.toLowerCase());
      }
      // Exact match (case-insensitive)
      return port.toLowerCase() === filter.toLowerCase();
    });
  }

  onPortFilterChange(newFilter: 'All' | 'Aughinish' | 'Foynes' | 'Limerick' | 'Other') {
    this.portFilter.set(newFilter);
    // Persist the filter selection to localStorage
    localStorage.setItem('statusListPortFilter', newFilter);
  }

  // Get a user-friendly name for the current filter
  getFilteredPortName(): string {
    const filter = this.portFilter();
    if (filter === 'Other') {
      return 'other ports (Shannon, Moneypoint, Tarbert, Cappa)';
    }
    return filter;
  }

  // Get the source text, defaulting to 'Sheet' if unknown or inferred from updatedBy
  getSource(row: StatusListRow): string {
    if (row.source) {
      return row.source;
    }
    // Fallback logic
    const updatedBy = (row.updatedBy || '').toLowerCase();
    if (updatedBy.includes('ais')) return 'AIS';
    if (updatedBy.includes('sheet')) return 'Sheet';
    return 'Sheet'; // Default assumption for manual updates
  }

  // Get the CSS class for the source badge
  getSourceClass(row: StatusListRow): string {
    const source = this.getSource(row).toLowerCase();
    if (source.includes('sheet')) return 'source-sheet';
    if (source.includes('ais')) return 'source-ais';
    return 'source-other';
  }

  // Helper to get Date object from Timestamp or Date
  getDate(val: Timestamp | Date | any): Date {
    if (val instanceof Timestamp) return val.toDate();
    if (val instanceof Date) return val;
    return new Date();
  }

  // Helper to check if date is in the past (for red color logic on overdue times)
  isPastDue(date: Date): boolean {
    const now = new Date();
    return date < now;
  }
}
