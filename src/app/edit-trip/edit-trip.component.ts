import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatNativeDateModule } from '@angular/material/core';
import { VisitRepository } from '../services/visit.repository';
import { TripRepository } from '../services/trip.repository';
import { ShipRepository } from '../services/ship.repository';
import { ShipIntelligenceService } from '../services/ship-intelligence.service';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { ShipIntelligenceDialogComponent } from '../dialogs/ship-intelligence-dialog.component';
import { Trip, Visit, Ship, Port, VisitStatus, TripType, Source } from '../models/data.model';
import { combineLatest, filter, map, switchMap, of, forkJoin, catchError, tap, take, Observable } from 'rxjs';
import { Timestamp } from '@angular/fire/firestore';
import { DateTimePickerComponent } from '../date-time-picker/date-time-picker.component';

@Component({
  selector: 'app-edit-trip',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatSnackBarModule,
    MatSnackBarModule,
    MatNativeDateModule,
    MatDialogModule,
    DateTimePickerComponent
  ],
  templateUrl: './edit-trip.component.html',
  styleUrls: ['./edit-trip.component.css']
})
export class EditTripComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private fb = inject(FormBuilder);
  private visitRepo = inject(VisitRepository);
  private tripRepo = inject(TripRepository);
  private shipRepo = inject(ShipRepository);
  private snackBar = inject(MatSnackBar);
  private shipIntelligence = inject(ShipIntelligenceService);
  private dialog = inject(MatDialog);

  visitId: string | null = null;
  form!: FormGroup;
  loading = signal(true);
  
  // Enums/Options for template
  ports: Port[] = ['Anchorage', 'Cappa', 'Moneypoint', 'Tarbert', 'Foynes', 'Aughinish', 'Shannon', 'Limerick'];
  visitStatuses: VisitStatus[] = ['Due', 'Awaiting Berth', 'Alongside', 'Sailed', 'Cancelled'];
  sources: Source[] = ['Sheet', 'AIS', 'Good Guess', 'Agent', 'Pilot', 'Other'];

  // IDs to track for updates
  shipId: string | null = null;
  inwardTripId: string | null = null;
  outwardTripId: string | null = null;

  ngOnInit() {
    this.initForm();
    this.visitId = this.route.snapshot.paramMap.get('id');

    if (this.visitId) {
      this.loadData(this.visitId);
    } else {
      this.snackBar.open('No Visit ID provided', 'Close', { duration: 3000 });
      this.loading.set(false);
    }
  }

  private initForm() {
    this.form = this.fb.group({
      ship: this.fb.group({
        shipName: ['', Validators.required],
        grossTonnage: [0, [Validators.required, Validators.min(50), Validators.max(200000)]],
        imoNumber: [null, [Validators.min(1000000), Validators.max(9999999)]],
        marineTrafficLink: [''],
        shipNotes: ['']
      }),
      visit: this.fb.group({
        currentStatus: ['Due', Validators.required],
        initialEta: [null, Validators.required],
        berthPort: [null],
        visitNotes: [''],
        source: ['Sheet']
      }),
      inwardTrip: this.fb.group({
        pilot: [''],
        boarding: [null],
        port: [null],
        pilotNotes: ['']
      }),
      outwardTrip: this.fb.group({
        pilot: [''],
        boarding: [null],
        port: [null],
        pilotNotes: ['']
      })
    });
  }

  private loadData(visitId: string) {
    this.loading.set(true);

    // 1. Get Visit
    this.visitRepo.getVisitById(visitId).pipe(
      switchMap(visit => {
        if (!visit) throw new Error('Visit not found');
        this.shipId = visit.shipId;
        
        // 2. Get Ship and Trips in parallel
        return forkJoin({
          visit: of(visit),
          ship: this.shipRepo.getShipById(visit.shipId).pipe(take(1)),
          trips: this.tripRepo.getTripsByVisitId(visitId).pipe(take(1))
        }) as Observable<{ visit: Visit, ship: Ship | undefined, trips: Trip[] }>;
      })
    ).subscribe({
      next: (data: { visit: Visit, ship: Ship | undefined, trips: Trip[] }) => {
        const { visit, ship, trips } = data;
        
        // Populate Form
        if (ship) {
          this.form.patchValue({
            ship: {
              shipName: ship.shipName,
              grossTonnage: ship.grossTonnage,
              imoNumber: ship.imoNumber,
              marineTrafficLink: ship.marineTrafficLink,
              shipNotes: ship.shipNotes
            }
          });
        }

        this.form.patchValue({
          visit: {
            currentStatus: visit.currentStatus,
            initialEta: visit.initialEta instanceof Timestamp ? visit.initialEta.toDate() : visit.initialEta,
            berthPort: visit.berthPort,
            visitNotes: visit.visitNotes,
            source: visit.source
          }
        });

        // Handle Trips
        const inTrip = trips.find((t: Trip) => t.typeTrip === 'In');
        const outTrip = trips.find((t: Trip) => t.typeTrip === 'Out');

        if (inTrip) {
          this.inwardTripId = inTrip.id!;
          this.form.patchValue({
            inwardTrip: {
              pilot: inTrip.pilot,
              boarding: inTrip.boarding instanceof Timestamp ? inTrip.boarding.toDate() : inTrip.boarding,
              port: inTrip.port || visit.berthPort, // Default to visit berth
              pilotNotes: inTrip.pilotNotes
            }
          });
        } else {
          // No inward trip yet - set default port to berth
          this.form.patchValue({
            inwardTrip: {
              port: visit.berthPort
            }
          });
        }

        if (outTrip) {
          this.outwardTripId = outTrip.id!;
          this.form.patchValue({
            outwardTrip: {
              pilot: outTrip.pilot,
              boarding: outTrip.boarding instanceof Timestamp ? outTrip.boarding.toDate() : outTrip.boarding,
              port: outTrip.port || visit.berthPort, // Default to visit berth
              pilotNotes: outTrip.pilotNotes
            }
          });
        } else {
          // No outward trip yet - set default port to berth
          this.form.patchValue({
            outwardTrip: {
              port: visit.berthPort
            }
          });
        }

        this.loading.set(false);
      },
      error: (err) => {
        console.error('Error loading data', err);
        this.snackBar.open('Error loading data', 'Close');
        this.loading.set(false);
      }
    });
  }

  saving = signal(false);

  async save() {
    if (this.form.invalid) return;
    this.saving.set(true);

    const formVal = this.form.value;

    try {
      // 1. Update Ship
      if (this.shipId) {
        await this.shipRepo.updateShip(this.shipId, {
          shipName: formVal.ship.shipName,
          grossTonnage: formVal.ship.grossTonnage,
          imoNumber: formVal.ship.imoNumber ?? null,
          marineTrafficLink: formVal.ship.marineTrafficLink ?? null,
          shipNotes: formVal.ship.shipNotes ?? null,
          shipName_lowercase: formVal.ship.shipName.toLowerCase()
        });
      }

      // 2. Update Visit
      if (this.visitId) {
        await this.visitRepo.updateVisit(this.visitId, {
          currentStatus: formVal.visit.currentStatus,
          initialEta: Timestamp.fromDate(formVal.visit.initialEta),
          berthPort: formVal.visit.berthPort ?? null,
          visitNotes: formVal.visit.visitNotes ?? null,
          source: formVal.visit.source ?? 'Other', // Default to 'Other' if undefined
          updatedBy: 'Admin' // TODO: Real user
        });
      }

      // 3. Update Trips
      if (this.inwardTripId) {
        await this.tripRepo.updateTrip(this.inwardTripId, {
          pilot: formVal.inwardTrip.pilot ?? null,
          boarding: (formVal.inwardTrip.boarding ? Timestamp.fromDate(formVal.inwardTrip.boarding) : null) as any,
          port: formVal.inwardTrip.port ?? null,
          pilotNotes: formVal.inwardTrip.pilotNotes ?? null
        });
      }

      if (this.outwardTripId) {
        await this.tripRepo.updateTrip(this.outwardTripId, {
          pilot: formVal.outwardTrip.pilot ?? null,
          boarding: (formVal.outwardTrip.boarding ? Timestamp.fromDate(formVal.outwardTrip.boarding) : null) as any,
          port: formVal.outwardTrip.port ?? null,
          pilotNotes: formVal.outwardTrip.pilotNotes ?? null
        });
      }

      this.snackBar.open('Changes saved successfully', 'Close', { duration: 3000 });
      this.router.navigate(['/']); // Redirect to root (Status List)
    } catch (err) {
      console.error('Error saving', err);
      this.snackBar.open('Error saving changes', 'Close');
    } finally {
      this.saving.set(false);
    }
  }

  fetchLoading = signal(false);

  fetchShipInfo() {
    const imo = this.form.get('ship.imoNumber')?.value;
    if (!imo) {
      this.snackBar.open('Please enter an IMO number first', 'Close', { duration: 3000 });
      return;
    }

    this.fetchLoading.set(true);
    this.shipIntelligence.fetchShipDetails(imo).subscribe({
      next: (data) => {
        this.fetchLoading.set(false);
        const dialogRef = this.dialog.open(ShipIntelligenceDialogComponent, {
          width: '800px',
          data: {
            currentData: this.form.get('ship')?.value,
            fetchedData: data
          }
        });

        dialogRef.afterClosed().subscribe(result => {
          if (result) {
            this.form.patchValue({
              ship: {
                shipName: result.shipName,
                grossTonnage: result.grossTonnage,
                // manager: result.manager, // Not in form yet
                // formerNames: result.formerNames // Not in form yet
              }
            });
            
            // Append news to notes if exists
            if (result.news) {
              const currentNotes = this.form.get('ship.shipNotes')?.value || '';
              const newNotes = currentNotes ? `${currentNotes}\n\n[AI News]: ${result.news}` : `[AI News]: ${result.news}`;
              this.form.patchValue({ ship: { shipNotes: newNotes } });
            }
            
            this.snackBar.open('Ship data updated from AI', 'Close', { duration: 3000 });
          }
        });
      },
      error: (err) => {
        console.error('Error fetching ship info', err);
        this.fetchLoading.set(false);
        this.snackBar.open('Failed to fetch ship info. Check API Key.', 'Close');
      }
    });
  }
}
