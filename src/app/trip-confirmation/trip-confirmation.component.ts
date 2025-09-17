import { AfterViewInit, Component, computed, effect, inject, OnInit, signal, ViewChild, WritableSignal } from '@angular/core';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { DataService } from '../services/data.service';
import { CommonModule } from '@angular/common';
import { AuthService } from '../auth/auth';
import {  UnifiedTrip } from '../models/trip.model';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
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
import { DataQualityService, TripWithWarnings } from '../services/data-quality';
import { CsvExportService } from '../services/csv-export';
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

  displayedColumns: string[] = ['ship', 'gt', 'boarding', 'typeTrip', 'port', 'extra', 'pilot', 'sailingNote', 'metadata'];
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
        default:
          return (item as any)[property];
      }
    };
  }

  showHelp(): void {
    this.showHelpPopup.set(true);
  }

  closeHelp(): void {
    this.showHelpPopup.set(false);
  }

  loadTrips(): void {
    this.dataService.getUnifiedTripLog().subscribe((trips) => {
      this.allTrips.set(trips);
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
    return !!currentUser && currentUser.displayName === trip.pilot;
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
    // Opening the dialog without data tells it to be in "create" mode.
    const dialogRef = this.dialog.open(CreateChargeDialogComponent, {
      width: 'clamp(300px, 80vw, 600px)',
      data: null,
    });

    dialogRef.afterClosed().subscribe(result => {
      // If the dialog returns 'success', it means a standalone charge was created.
      if (result === 'success') {
        this.loadTrips();
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
      alert('There are no confirmed trips to export with the current filters.');
      return;
    }

    this.csvExportService.exportConfirmedTrips(confirmedTrips);
  }
}
