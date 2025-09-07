import { AfterViewInit, Component, computed, effect, inject, OnInit, signal, ViewChild, WritableSignal } from '@angular/core';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { DataService } from '../services/data.service';
import { AuthService } from '../auth/auth';
import { ChargeableEvent } from '../models/trip.model';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { CreateChargeDialogComponent } from '../create-charge-dialog/create-charge-dialog';
import { CommonModule } from '@angular/common';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatNativeDateModule } from '@angular/material/core';
import { MatButtonToggleModule } from '@angular/material/button-toggle';

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
    MatIconModule,
    MatNativeDateModule,
    MatButtonToggleModule,
  ],
  templateUrl: './main.html',
  styleUrl: './main.css',
})
export class MainComponent implements OnInit, AfterViewInit {
  private readonly dataService = inject(DataService);
  private readonly dialog = inject(MatDialog);
  private readonly authService = inject(AuthService);

  displayedColumns: string[] = ['boarding', 'ship', 'gt', 'port', 'pilot', 'typeTrip', 'note', 'extra'];
  dataSource = new MatTableDataSource<ChargeableEvent>();

  // Source signal for all trips from the service
  allTrips: WritableSignal<ChargeableEvent[]> = signal([]);

  // Signals for filtering criteria
  directionFilter = signal<'All' | 'In' | 'Out'>('All');
  pilotFilter = signal<'All' | 'My'>('All');
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
      const searchStr = `${trip.ship} ${trip.gt} ${trip.port} ${trip.pilot} ${trip.note} ${trip.extra}`.toLowerCase();
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
    this.dataService.getRecentTrips().subscribe((trips) => {
      this.allTrips.set(trips);
    });
  }

  applyFilter(event: Event) {
    const filterValue = (event.target as HTMLInputElement).value;
    this.textFilter.set(filterValue.trim());
  }

  onRowClicked(row: ChargeableEvent) {
    // Do nothing if the trip is already confirmed
    if (row.isConfirmed) {
      return;
    }

    const dialogRef = this.dialog.open(CreateChargeDialogComponent, {
      width: 'clamp(300px, 80vw, 600px)',
      data: row, // Pass the clicked trip's data to the dialog
    });

    dialogRef.afterClosed().subscribe((result) => {
      // If the dialog returns 'success', it means a charge was created, so we refresh the table
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
}
