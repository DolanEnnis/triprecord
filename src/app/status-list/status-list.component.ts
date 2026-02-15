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
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { RiverStateService } from '../services/state/river-state.service';
import { TimeAgoPipe } from '../shared/pipes/time-ago.pipe';
import { Visit, VisitStatus } from '../models';
import { StatusListRow } from '../models';
import { Timestamp } from '@angular/fire/firestore';
import { UpdateEtaDialogComponent } from '../dialogs/update-eta-dialog/update-eta-dialog.component';
import { AuthService } from '../auth/auth';
import { VisitRepository } from '../services/repositories/visit.repository';
import { TripRepository } from '../services/repositories/trip.repository';
import { VisitWorkflowService } from '../services/workflows/visit-workflow.service';
import { PilotService } from '../services/state/pilot.service';
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
    TimeAgoPipe,
    MatSlideToggleModule,
  ],
  templateUrl: './status-list.component.html',
  styleUrl: './status-list.component.css',
})
export class StatusListComponent {
  private readonly riverState = inject(RiverStateService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly authService = inject(AuthService);
  private readonly visitRepository = inject(VisitRepository);
  private readonly tripRepository = inject(TripRepository);
  private readonly visitWorkflowService = inject(VisitWorkflowService);
  readonly pilotService = inject(PilotService);

  // Edit Mode Signal - Defaults to false (Read-Only) for safe scrolling
  readonly isEditMode = signal(false);

  // Responsive Check for 768px Mobile Breakpoint
  private mediaQuery = window.matchMedia('(max-width: 768px)');
  readonly isMobile = signal(this.mediaQuery.matches);

  // Computed: Should we show edit controls (Inputs) or Read-Only Text?
  // Desktop: Always Show Controls (Legacy behavior)
  // Mobile: Only Show Controls if Edit Mode is Toggle ON
  readonly showEditControls = computed(() => !this.isMobile() || this.isEditMode());

  constructor() {
    // Listen for resize events
    this.mediaQuery.addEventListener('change', (e) => {
      this.isMobile.set(e.matches);
    });
  }

  // Filter Signal - Persisted in localStorage with type-safe validation
  readonly portFilter = signal<PortFilter>(
    (() => {
      const stored = localStorage.getItem('statusListPortFilter');
      return isValidPortFilter(stored) ? stored : 'All';
    })(),
  );

  // Data Signals (using toSignal to convert Observables to Signals)
  readonly dueShips = toSignal(
    this.visitRepository.getVisitsWithTripDetails('Due'),
    { initialValue: [] },
  );
  readonly awaitingBerthShips = toSignal(
    this.visitRepository.getVisitsWithTripDetails('Awaiting Berth'),
    { initialValue: [] },
  );
  readonly alongsideShips = toSignal(
    this.visitRepository.getVisitsWithTripDetails('Alongside'),
    { initialValue: [] },
  );

  // Computed Filtered Signals (filtering logic remains the same)
  readonly filteredDueShips = computed(() => this.filterShips(this.dueShips()));
  readonly filteredAwaitingBerthShips = computed(() =>
    this.filterShips(this.awaitingBerthShips()),
  );
  readonly filteredAlongsideShips = computed(() =>
    this.filterShips(this.alongsideShips()),
  );

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
    },
  ]);

  // Computed signal to check if current user is a viewer (read-only access)
  // Viewers can only see data and Marine Traffic links, but cannot edit anything
  readonly isViewer = computed(() => {
    const userType = this.authService.currentUserSig()?.userType?.toLowerCase();
    return userType === 'viewer';
  });

  // Columns: Ship, Marine Traffic link, Date (ETA/ETD), Port, Note, Pilot, Updated, Actions
  displayedColumns: string[] = [
    'ship',
    'marine-traffic',
    'officeTime',
    'port',
    'note',
    'pilot',
    'updated',
    'actions',
  ];

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
        status: row.status, // Pass status to determine correct label
      },
    });

    dialogRef.afterClosed().subscribe(async (newDate: Date | undefined) => {
      if (newDate) {
        const currentUser =
          this.authService.currentUserSig()?.displayName || 'Unknown';
        try {
          // StatusListRow now has properly typed status field (VisitStatus)
          await this.visitRepository.updateVisitDate(
            row.visitId,
            row.tripId,
            row.status, // No cast needed - status is already VisitStatus
            newDate,
            currentUser,
          );

          // Show success message to user
          this.snackBar.open(
            `✓ ${row.shipName} time updated successfully - display will refresh automatically`,
            'Close',
            {
              duration: 4000, // Show a bit longer so users see it
              horizontalPosition: 'center',
              verticalPosition: 'bottom',
              panelClass: ['success-snackbar'],
            },
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
              panelClass: ['error-snackbar'],
            },
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

    return ships.filter((ship) => {
      // Use 'port' field from StatusListRow which is already flattened
      const port = ship.port || '';
      if (filter === 'Other') {
        // Show if it's NOT one of the main named ports
        return !['aughinish', 'foynes', 'limerick'].includes(
          port.toLowerCase(),
        );
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

  toggleEditMode() {
    this.isEditMode.update((current) => !current);
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
  async changeStatus(
    row: StatusListRow,
    newStatus: VisitStatus,
  ): Promise<void> {
    const currentUser =
      this.authService.currentUserSig()?.displayName || 'Unknown';
    try {
      if (newStatus === 'Cancelled') {
        const trips = await this.tripRepository.getTripsByVisitIdOnce(row.visitId);
        
        // 1. Safety Check: Block if any confirmed trips
        if (trips.some(t => t.isConfirmed)) {
           this.snackBar.open(
            `✗ Cannot cancel: This visit has Confirmed/Billed trips. Unconfirm them first.`,
            'Close',
            { duration: 5000, panelClass: ['error-snackbar'] }
          );
          return;
        }

        // 2. Determine Warning Level
        // User Requirement: "Warning is not needed if all trips are Pending"
        const hasActiveData = trips.some(t => t.boarding !== null);
        let confirmed = false;

        if (hasActiveData) {
           confirmed = confirm(
             `WARNING: This visit has ACTIVE TRIPS with data.\n\nCancelling will DELETE all ${trips.length} associated trips and their history.\n\nAre you sure you want to proceed?`
           );
        } else {
           // Simple confirmation for pending/skeleton visits
           confirmed = confirm(`Cancel visit for ${row.shipName}?`);
        }

        if (!confirmed) return;

        // 3. Execute Cancellation
        await this.visitWorkflowService.cancelVisit(row.visitId);
        
      } else {
        // Normal status update
        await this.visitRepository.updateVisitStatus(
          row.visitId,
          newStatus,
          currentUser,
        );
      }

      // Show success message
      this.snackBar.open(
        `✓ ${row.shipName} status changed to ${newStatus}`,
        'Close',
        {
          duration: 3000,
          horizontalPosition: 'center',
          verticalPosition: 'bottom',
          panelClass: ['success-snackbar'],
        },
      );
    } catch (error: any) {
      console.error('Failed to update status:', error);
      this.snackBar.open(
        `✗ Failed to change status: ${error.message || 'Unknown error'}`,
        'Close',
        {
          duration: 5000,
          horizontalPosition: 'center',
          verticalPosition: 'bottom',
          panelClass: ['error-snackbar'],
        },
      );
    }
  }

  // Update pilot assignment
  async updatePilot(row: StatusListRow, newPilot: string): Promise<void> {
    // Need to update the trip's pilot field
    if (!row.tripId) {
      this.snackBar.open(`✗ Cannot update pilot: Trip not found`, 'Close', {
        duration: 5000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
        panelClass: ['error-snackbar'],
      });
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
          panelClass: ['success-snackbar'],
        },
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
          panelClass: ['error-snackbar'],
        },
      );
    }
  }
}
