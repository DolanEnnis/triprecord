import { AfterViewInit, Component, computed, effect, inject, OnInit, signal, ViewChild, WritableSignal } from '@angular/core';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { DataService } from '../services/core/data.service';
import { CommonModule } from '@angular/common';
import { AuthService } from '../auth/auth';
import {  UnifiedTrip } from '../models';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ConfirmationDialogComponent } from '../shared/confirmation-dialog/confirmation-dialog.component';
import { CreateChargeDialogComponent } from '../create-charge-dialog/create-charge-dialog.component';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatNativeDateModule } from '@angular/material/core';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatPaginatorModule } from '@angular/material/paginator';
import { DataQualityService, TripWithWarnings } from '../services/utilities/data-quality.service';
import { CsvExportService } from '../services/utilities/csv-export.service';
import { HelpPopupComponent } from '../help-popup/help-popup.component';



@Component({
  selector: 'app-trip-confirmation',
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSortModule,
    MatProgressSpinnerModule,
    MatButtonModule,
    MatIconModule,
    MatNativeDateModule,
    MatButtonToggleModule,
    MatTooltipModule,
    MatPaginatorModule,
    HelpPopupComponent,
    MatSnackBarModule,
  ],
  templateUrl: './trip-confirmation.component.html',
  styleUrl: './trip-confirmation.component.css',
})
export class TripConfirmationComponent implements OnInit, AfterViewInit {
  private readonly dataService = inject(DataService);
  private readonly dialog = inject(MatDialog);
  private readonly authService = inject(AuthService);
  private readonly dataQualityService = inject(DataQualityService);
  private readonly csvExportService = inject(CsvExportService);
  private readonly snackBar = inject(MatSnackBar);

  displayedColumns: string[] = ['ship', 'gt', 'boarding', 'typeTrip', 'port', 'extra', 'pilotNo', 'monthNo', 'pilot', 'sailingNote', 'metadata'];
  dataSource = new MatTableDataSource<TripWithWarnings>();

  // Source signal for all trips from the service
  allTrips: WritableSignal<UnifiedTrip[]> = signal([]);

  // A computed signal that applies data quality checks to the raw trip data
  tripsWithWarnings = computed(() => {
    return this.dataQualityService.applyDataQualityChecks(this.allTrips());
  });

  // Signals for filtering criteria
  directionFilter = signal<'All' | 'In' | 'Out'>('All');
  pilotFilter = signal<'All' | 'My'>('My');
  textFilter = signal<string>('');
  showHelpPopup = signal(false);
  isLoading = signal(true); // To track loading state, used by the template

  // A computed signal for the user's name. Defaults to 'My' if not available.
  // This reactively updates if the logged-in user changes.
  userName = computed(() => {
    const name = this.authService.currentUserSig()?.displayName;
    if (name) {
      // If a name exists, make it possessive.
      return `${name}'s`;
    }
    return 'My'; // Otherwise, fall back to 'My' for the button text.
  });

  // A computed signal that automatically filters the trips whenever a dependency changes
  filteredTrips = computed(() => {
    const trips = this.tripsWithWarnings();
    const direction = this.directionFilter();
    const pilotSelection = this.pilotFilter();
    const currentUser = this.authService.currentUserSig();
    const text = this.textFilter().toLowerCase();

    // 1. Filter by direction
    let filtered = trips.filter(trip => {
      if (direction === 'All') return true;
      return trip.typeTrip === direction;
    });

    // 2. Filter by pilot
    if (pilotSelection === 'My' && currentUser) {
      // A trip is considered "My" if it's assigned to the current user OR if it has no pilot assigned yet.
      // The `!trip.pilot` check handles cases where the pilot is null, undefined, or an empty string.
      filtered = filtered.filter(trip => trip.pilot === currentUser.displayName || !trip.pilot);
    }

    // 3. Filter by text
    if (!text) {
      return filtered;
    }
    return filtered.filter(trip => {
      const searchStr = `${trip.ship} ${trip.gt} ${trip.port} ${trip.pilot} ${trip.sailingNote} ${trip.extra} ${trip.updatedBy}`.toLowerCase();
      return searchStr.includes(text);
    });
  });

  @ViewChild(MatSort) set sort(sort: MatSort) {
    // This setter is called when the matSort directive is available.
    this.dataSource.sort = sort;
  }

  constructor() {
    // When the filteredTrips signal changes, update the table's data source
    effect(() => {
      this.dataSource.data = this.filteredTrips();
    });
  }

  ngOnInit(): void {
    this.loadTrips();
    if (typeof localStorage !== 'undefined' && !localStorage.getItem('hasSeenHelpPopup')) {
      this.showHelp();
      localStorage.setItem('hasSeenHelpPopup', 'true');
    }
  }

  ngAfterViewInit(): void {
    // Custom sorting for the 'Note' column which is a composite of warnings and the note itself.
    this.dataSource.sortingDataAccessor = (item: TripWithWarnings, property: string) => {
      switch (property) {
        case 'sailingNote': {
          let noteWithWarnings = item.sailingNote || '';
          if (item.dataWarnings && item.dataWarnings.length > 0) {
            const warningsText = `[${item.dataWarnings.join('; ')}] `;
            noteWithWarnings = `${warningsText}${noteWithWarnings}`.trim();
          }
          return noteWithWarnings;
        }
        case 'boarding':
          return item.boarding ? new Date(item.boarding).getTime() : 0;
        default:
          return (item as any)[property];
      }
    };

    // Store the original sortData function and bind it to the dataSource to preserve context
    const defaultSortData = this.dataSource.sortData.bind(this.dataSource);
    
    // Override sortData to implement "My Trips First" logic
    // Override sortData to implement "My Trips First" logic AND "Pending Trips Last"
    this.dataSource.sortData = (data: TripWithWarnings[], sort: MatSort) => {
      // 1. Separate Pending Trips (No Date) from Dated Trips
      // User Req: "These should be at the very bottom"
      const pendingTrips = data.filter(t => !t.boarding);
      const datedTrips = data.filter(t => !!t.boarding);

      // 2. Sort the dated trips using the default sorter (column sorting)
      const activeSortData = defaultSortData(datedTrips, sort);

      // 3. Apply "My Trips" filter to the dated trips
      // If the 'My' filter is active, we validly assume the user wants to see their trips first.
      let finalDatedTrips = activeSortData;
      if (this.pilotFilter() === 'My') {
        finalDatedTrips = activeSortData.sort((a, b) => {
          const aIsMine = this.isOwnTrip(a);
          const bIsMine = this.isOwnTrip(b);

          if (aIsMine && !bIsMine) return -1; // a comes first
          if (!aIsMine && bIsMine) return 1;  // b comes first
          return 0; // maintain relative order from default sort
        });
      }

      // 4. Combine: Date-Sorted Trips + Pending Trips at the bottom
      return [...finalDatedTrips, ...pendingTrips];
    };
  }

  showHelp(): void {
    this.showHelpPopup.set(true);
  }

  closeHelp(): void {
    this.showHelpPopup.set(false);
  }

  loadTrips(): void {
    this.isLoading.set(true);
    this.dataService.getUnifiedTripLog().subscribe({
      next: (trips) => {
        this.allTrips.set(trips);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Failed to load trips', err);
        this.isLoading.set(false); // Ensure spinner is turned off on error
      }
    });
  }

  applyFilter(event: Event) {
    const filterValue = (event.target as HTMLInputElement).value;
    this.textFilter.set(filterValue.trim());
  }

  onRowClicked(trip: TripWithWarnings) {
    // If the trip is actionable, open the dialog to create a charge from the visit.
    if (trip.isActionable && trip.chargeableEvent) {
      this.openCreateFromVisitDialog(trip);
      return;
    }

    // If the trip is NOT actionable (it's a confirmed charge), check if the user can edit it.
    if (!trip.isActionable && this.isOwnTrip(trip)) {
      this.handleEditConfirmedTrip(trip);
    }
  }

  isOwnTrip(trip: TripWithWarnings): boolean {
    const currentUser = this.authService.currentUserSig();
    const isAdmin = this.authService.isAdmin();
    return (!!currentUser && currentUser.displayName === trip.pilot) || isAdmin;
  }

  private openCreateFromVisitDialog(trip: TripWithWarnings): void {
    const dialogRef = this.dialog.open(CreateChargeDialogComponent, {
      width: 'clamp(300px, 80vw, 600px)',
      data: {
        mode: 'fromVisit',
        event: trip.chargeableEvent
      },
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result === 'success') {
        this.loadTrips();
      }
    });
  }

  private handleEditConfirmedTrip(trip: TripWithWarnings): void {
    const confirmDialogRef = this.dialog.open(ConfirmationDialogComponent, {
      data: {
        title: 'Confirm Edit',
        message: 'Are you sure you want to edit this confirmed trip? This will overwrite the existing record.'
      }
    });

    confirmDialogRef.afterClosed().subscribe(confirmed => {
      if (confirmed) {
        this.openEditTripDialog(trip);
      }
    });
  }

  private openEditTripDialog(trip: TripWithWarnings): void {
    const editDialogRef = this.dialog.open(CreateChargeDialogComponent, {
      width: 'clamp(300px, 80vw, 600px)',
      data: {
        mode: 'editCharge',
        charge: trip // The dialog is configured to accept this structure for editing
      }
    });

    editDialogRef.afterClosed().subscribe(result => {
      if (result === 'success' || result === 'deleted') {
        this.loadTrips();
      }
    });
  }

  openNewChargeDialog(): void {
    const confirmDialogRef = this.dialog.open(ConfirmationDialogComponent, {
      data: {
        title: 'Check for Existing Trip',
        message: 'Have you checked the list for an existing trip? Creating a new record when one exists causes data duplication. Please search thoroughly before proceeding.',
        confirmText: 'Create New Trip',
        cancelText: 'Cancel'
      }
    });

    confirmDialogRef.afterClosed().subscribe(confirmed => {
      if (confirmed) {
        // Extract unique active ship names for the warning check
        const activeShips = Array.from(new Set(this.allTrips().map(t => t.ship).filter(s => !!s)));

        // Opening the dialog without data tells it to be in "create" mode.
        const dialogRef = this.dialog.open(CreateChargeDialogComponent, {
          width: 'clamp(300px, 80vw, 600px)',
          data: { activeShips }, // Pass the list of active ships
        });

        dialogRef.afterClosed().subscribe(result => {
          // If the dialog returns 'success', it means a standalone charge was created.
          if (result === 'success') {
            this.loadTrips();
          }
        });
      }
    });
  }

  onDirectionChange(newDirection: 'All' | 'In' | 'Out') {
    this.directionFilter.set(newDirection);
  }

  onPilotFilterChange(newFilter: 'All' | 'My') {
    this.pilotFilter.set(newFilter);
  }

  exportConfirmedTripsToCsv(): void {
    // Get trips from the computed signal (respects all active filters)
    const currentTrips = this.filteredTrips();

    // Filter this list further to get only confirmed trips (!isActionable)
    const confirmedTrips = currentTrips.filter(trip => !trip.isActionable);

    if (confirmedTrips.length === 0) {
      // Show info message using MatSnackBar - auto-dismisses after 5 seconds
      this.snackBar.open('There are no confirmed trips to export with the current filters.', 'Close', { duration: 5000 });
      return;
    }

    this.csvExportService.exportConfirmedTrips(confirmedTrips);
  }

  repairLegacyData(): void {
    if (!confirm('Run legacy data repair? This will check last 3 months of unconfirmed trips and backfill missing ship details.')) return;
    
    this.isLoading.set(true);
    this.dataService.repairRecentTrips().then((count: number) => {
      this.snackBar.open(`Repair complete. Fixed ${count} trips.`, 'Close', { duration: 5000 });
      this.loadTrips();
    }).catch((err: any) => {
      console.error('Repair failed', err);
      this.snackBar.open('Repair failed. Check console.', 'Close', { duration: 5000 });
      this.isLoading.set(false);
    });
  }
}
