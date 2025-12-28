import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CommonModule, DatePipe } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatSortModule } from '@angular/material/sort';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { Router } from '@angular/router';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { RiverStateService } from '../services/river-state.service';
import { TimeAgoPipe } from '../shared/pipes/time-ago.pipe';
import { Visit, VisitStatus } from '../models';
import { StatusListRow } from '../models';
import { Timestamp} from '@angular/fire/firestore';
import { UpdateEtaDialogComponent } from '../dialogs/update-eta-dialog/update-eta-dialog.component';
import { AuthService } from '../auth/auth';
import { VisitRepository } from '../services/visit.repository';
import { TripRepository } from '../services/trip.repository';
import { PilotService } from '../services/pilot.service';
import { PortFilter, isValidPortFilter } from '../models';


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
    MatMenuModule,
    MatSelectModule,
    MatDialogModule,
    MatSnackBarModule,
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
  private readonly snackBar = inject(MatSnackBar);
  private readonly authService = inject(AuthService);
  private readonly visitRepository = inject(VisitRepository);
  private readonly tripRepository = inject(TripRepository);
  readonly pilotService = inject(PilotService);

  // Filter Signal - Persisted in localStorage with type-safe validation
  readonly portFilter = signal<PortFilter>(
    (() => {
      const stored = localStorage.getItem('statusListPortFilter');
      return isValidPortFilter(stored) ? stored : 'All';
    })()
  );

  // Data Signals (using toSignal to convert Observables to Signals)
  readonly dueShips = toSignal(this.visitRepository.getVisitsWithTripDetails('Due'), { initialValue: [] });
  readonly awaitingBerthShips = toSignal(this.visitRepository.getVisitsWithTripDetails('Awaiting Berth'), { initialValue: [] });
  readonly alongsideShips = toSignal(this.visitRepository.getVisitsWithTripDetails('Alongside'), { initialValue: [] });

  // Computed Filtered Signals (filtering logic remains the same)
  readonly filteredDueShips = computed(() => this.filterShips(this.dueShips()));
  readonly filteredAwaitingBerthShips = computed(() => this.filterShips(this.awaitingBerthShips()));
  readonly filteredAlongsideShips = computed(() => this.filterShips(this.alongsideShips()));

  // Sections array - drives the template with a single *ngFor loop instead of 3 duplicate tables
  // This reduces code duplication and makes it easier to add/modify columns in one place
  readonly sections = computed(() => [
    {
      title: 'Due',
      data: this.filteredDueShips(),
      timeLabel: 'ETA', // Column header for the time field
      portFilterName: this.getFilteredPortName(),
    },
    {
      title: 'Awaiting Berth',
      data: this.filteredAwaitingBerthShips(),
      timeLabel: 'ETB',
      portFilterName: this.getFilteredPortName(),
    },
    {
      title: 'Alongside',
      data: this.filteredAlongsideShips(),
      timeLabel: 'ETS',
      portFilterName: this.getFilteredPortName(),
    }
  ]);

  // Columns: Ship, Date (ETA/ETD), Port, Note, Pilot, Updated, Actions
  displayedColumns: string[] = ['ship', 'officeTime', 'port', 'note', 'pilot', 'updated', 'actions'];

  editTrip(row: StatusListRow) {
    if (row.visitId) {
      this.router.navigate(['/edit', row.visitId]);
    }
  }

  openEtaDialog(row: StatusListRow) {
    const dialogRef = this.dialog.open(UpdateEtaDialogComponent, {
      data: { 
        shipName: row.shipName, 
        currentEta: row.date,
        status: row.status // Pass status to determine correct label
      }
    });

    dialogRef.afterClosed().subscribe(async (newDate: Date | undefined) => {
      if (newDate) {
        const currentUser = this.authService.currentUserSig()?.displayName || 'Unknown';
        try {
          // StatusListRow now has properly typed status field (VisitStatus)
          await this.visitRepository.updateVisitDate(
            row.visitId,
            row.tripId,
            row.status, // No cast needed - status is already VisitStatus
            newDate,
            currentUser
          );
          
          // Show success message to user
          this.snackBar.open(
            `✓ ${row.shipName} time updated successfully - display will refresh automatically`,
            'Close',
            {
              duration: 4000, // Show a bit longer so users see it
              horizontalPosition: 'center',
              verticalPosition: 'bottom',
              panelClass: ['success-snackbar']
            }
          );
        } catch (error) {
          console.error('Failed to update ETA:', error);
          
          // Show error message to user with more detailed feedback
          this.snackBar.open(
            `✗ Failed to update ${row.shipName} time. Please try again.`,
            'Close',
            {
              duration: 5000, // Show errors a bit longer
              horizontalPosition: 'center',
              verticalPosition: 'bottom',
              panelClass: ['error-snackbar']
            }
          );
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

  onPortFilterChange(newFilter: PortFilter) {
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

  // Get the next valid statuses based on current status (state machine)
  getNextStatuses(currentStatus: VisitStatus): VisitStatus[] {
    switch (currentStatus) {
      case 'Due':
        return ['Awaiting Berth', 'Cancelled'];
      case 'Awaiting Berth':
        return ['Alongside', 'Cancelled'];
      case 'Alongside':
        return ['Sailed', 'Cancelled'];
      case 'Sailed':
        return ['Cancelled']; // Can mark as cancelled if there was an error
      case 'Cancelled':
        return []; // No transitions from cancelled
      default:
        return [];
    }
  }

  // Change the status of a visit
  async changeStatus(row: StatusListRow, newStatus: VisitStatus): Promise<void> {
    const currentUser = this.authService.currentUserSig()?.displayName || 'Unknown';
    try {
      await this.visitRepository.updateVisitStatus(
        row.visitId,
        newStatus,
        currentUser
      );

      // Show success message
      this.snackBar.open(
        `✓ ${row.shipName} status changed to ${newStatus}`,
        'Close',
        {
          duration: 3000,
          horizontalPosition: 'center',
          verticalPosition: 'bottom',
          panelClass: ['success-snackbar']
        }
      );
    } catch (error) {
      console.error('Failed to update status:', error);
      this.snackBar.open(
        `✗ Failed to change status. Please try again.`,
        'Close',
        {
          duration: 5000,
          horizontalPosition: 'center',
          verticalPosition: 'bottom',
          panelClass: ['error-snackbar']
        }
      );
    }
  }

  // Update pilot assignment
  async updatePilot(row: StatusListRow, newPilot: string): Promise<void> {
    // Need to update the trip's pilot field
    if (!row.tripId) {
      this.snackBar.open(
        `✗ Cannot update pilot: Trip not found`,
        'Close',
        {
          duration: 5000,
          horizontalPosition: 'center',
          verticalPosition: 'bottom',
          panelClass: ['error-snackbar']
        }
      );
      return;
    }

    try {
      await this.tripRepository.updateTrip(row.tripId, { pilot: newPilot });

      // Show success message
      this.snackBar.open(
        `✓ Pilot updated to ${newPilot || 'Unassigned'}`,
        'Close',
        {
          duration: 3000,
          horizontalPosition: 'center',
          verticalPosition: 'bottom',
          panelClass: ['success-snackbar']
        }
      );
    } catch (error) {
      console.error('Failed to update pilot:', error);
      this.snackBar.open(
        `✗ Failed to update pilot. Please try again.`,
        'Close',
        {
          duration: 5000,
          horizontalPosition: 'center',
          verticalPosition: 'bottom',
          panelClass: ['error-snackbar']
        }
      );
    }
  }
}
