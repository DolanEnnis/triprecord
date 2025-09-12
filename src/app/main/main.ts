import { AfterViewInit, Component, computed, effect, inject, OnInit, signal, ViewChild, WritableSignal } from '@angular/core';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { DataService } from '../services/data.service';
import { CommonModule, DatePipe } from '@angular/common';
import { AuthService } from '../auth/auth';
import { UnifiedTrip } from '../models/trip.model';
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
import * as Papa from 'papaparse';

@Component({
  selector: 'app-main',
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
  ],
  templateUrl: './main.html',
  styleUrl: './main.css',
  providers: [DatePipe],
})
export class MainComponent implements OnInit, AfterViewInit {
  private readonly dataService = inject(DataService);
  private readonly dialog = inject(MatDialog);
  private readonly authService = inject(AuthService);
  private readonly datePipe = inject(DatePipe);

  displayedColumns: string[] = ['ship', 'gt', 'boarding', 'typeTrip', 'port', 'extra', 'pilot', 'note', 'metadata'];
  dataSource = new MatTableDataSource<UnifiedTrip>();

  // Source signal for all trips from the service
  allTrips: WritableSignal<UnifiedTrip[]> = signal([]);

  // Signals for filtering criteria
  directionFilter = signal<'All' | 'In' | 'Out'>('All');
  pilotFilter = signal<'All' | 'My'>('My');
  textFilter = signal<string>('');

  // A computed signal that automatically filters the trips whenever a dependency changes
  filteredTrips = computed(() => {
    const trips = this.allTrips();
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
      filtered = filtered.filter(trip => trip.pilot === currentUser.displayName);
    }

    // 3. Filter by text
    if (!text) {
      return filtered;
    }
    return filtered.filter(trip => {
      const searchStr = `${trip.ship} ${trip.gt} ${trip.port} ${trip.pilot} ${trip.note} ${trip.extra} ${trip.updatedBy}`.toLowerCase();
      return searchStr.includes(text);
    });
  });

  @ViewChild(MatSort) sort!: MatSort;

  constructor() {
    // When the filteredTrips signal changes, update the table's data source
    effect(() => {
      this.dataSource.data = this.filteredTrips();
    });
  }

  ngOnInit(): void {
    this.loadTrips();
  }

  ngAfterViewInit(): void {
    this.dataSource.sort = this.sort;
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

  onRowClicked(trip: UnifiedTrip) {
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

  isOwnTrip(trip: UnifiedTrip): boolean {
    const currentUser = this.authService.currentUserSig();
    return !!currentUser && currentUser.displayName === trip.pilot;
  }

  private openCreateFromVisitDialog(trip: UnifiedTrip): void {
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

  private handleEditConfirmedTrip(trip: UnifiedTrip): void {
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

  private openEditTripDialog(trip: UnifiedTrip): void {
    const editDialogRef = this.dialog.open(CreateChargeDialogComponent, {
      width: 'clamp(300px, 80vw, 600px)',
      data: {
        mode: 'editCharge',
        charge: trip // The dialog is configured to accept this structure for editing
      }
    });

    editDialogRef.afterClosed().subscribe(result => {
      if (result === 'success') {
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

    // Map the data to a new structure with the desired headers and formatted values.
    const dataForCsv = confirmedTrips.map(trip => ({
      'Timestamp': this.datePipe.transform(trip.updateTime, 'dd-MM-yy HH:mm:ss'),
      'Ship': trip.ship,
      'GT': trip.gt,
      'Date': this.datePipe.transform(trip.boarding, 'dd/MM/yy'),
      'In / Out': trip.typeTrip,
      'To/From': trip.port,
      'Late Order / Detention /Anchoring etc': trip.extra,
      'Pilot': trip.pilot,
      'Note': trip.note,
    }));

    // Use PapaParse to convert JSON to CSV
    const csv = Papa.unparse(dataForCsv);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    const filename = `confirmed_trips_${this.datePipe.transform(new Date(), 'yyyy-MM-dd')}.csv`;
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
