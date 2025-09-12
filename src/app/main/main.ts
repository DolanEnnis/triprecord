import { AfterViewInit, Component, computed, effect, inject, OnInit, signal, ViewChild, WritableSignal } from '@angular/core';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { DataService } from '../services/data.service';
import { Router } from '@angular/router';
import { AuthService } from '../auth/auth';
import { UnifiedTrip } from '../models/trip.model';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { CreateChargeDialogComponent } from '../create-charge-dialog/create-charge-dialog.component';
import { CommonModule } from '@angular/common';
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
})
export class MainComponent implements OnInit, AfterViewInit {
  private readonly dataService = inject(DataService);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);

  displayedColumns: string[] = ['boarding', 'ship', 'pilot', 'typeTrip', 'port', 'metadata'];
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

  onRowClicked(row: UnifiedTrip) {
    // Do nothing if the trip is not actionable (i.e., it's a charge or already confirmed)
    if (!row.isActionable || !row.chargeableEvent) {
      return;
    }

    const dialogRef = this.dialog.open(CreateChargeDialogComponent, {
      width: 'clamp(300px, 80vw, 600px)',
      data: {
        mode: 'fromVisit',
        event: row.chargeableEvent
      },
    });

    dialogRef.afterClosed().subscribe((result) => {
      // If the dialog returns 'success', it means a charge was created, so we refresh the table
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
        this.router.navigate(['/charges']);
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
