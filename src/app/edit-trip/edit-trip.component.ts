import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, FormGroup, FormArray, ReactiveFormsModule, Validators, ValidatorFn, AbstractControl, ValidationErrors } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatNativeDateModule } from '@angular/material/core';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatTooltipModule } from '@angular/material/tooltip';
import { VisitRepository } from '../services/visit.repository';
import { TripRepository } from '../services/trip.repository';
import { ShipRepository } from '../services/ship.repository';
import { PilotService } from '../services/pilot.service';
import { ShipIntelligenceService } from '../services/ship-intelligence.service';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { ShipIntelligenceDialogComponent } from '../dialogs/ship-intelligence-dialog.component';
import { Trip, Visit, Ship, Port, VisitStatus, TripType, Source } from '../models/data.model';
import { combineLatest, filter, map, switchMap, of, forkJoin, catchError, tap, take, Observable } from 'rxjs';
import { Timestamp } from '@angular/fire/firestore';
import { DateTimePickerComponent } from '../date-time-picker/date-time-picker.component';
import { IFormComponent } from '../guards/form-component.interface';

/**
 * Custom validator to ensure the selected pilot is from the valid pilot list.
 * 
 * WHY A VALIDATOR FACTORY?
 * - We need to pass the PilotService to the validator
 * - Angular validators are just functions, so we use a factory pattern
 * - This returns a ValidatorFn that has access to pilotService via closure
 * 
 * @param pilotService - The injected PilotService to validate against
 * @returns A ValidatorFn that checks if the pilot name is valid
 */
function pilotValidator(pilotService: PilotService): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value;
    
    // Allow empty values (handled by required validator if needed)
    if (!value || value.trim() === '') {
      return null;
    }
    
    // Check if the pilot name is valid using the service
    // This demonstrates DEPENDENCY INJECTION in validators
    if (!pilotService.isPilotValid(value)) {
      return { invalidPilot: { value } };
    }
    
    return null;
  };
}

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
    MatAutocompleteModule,
    MatTooltipModule,
    DateTimePickerComponent
  ],
  templateUrl: './edit-trip.component.html',
  styleUrls: ['./edit-trip.component.css']
})
export class EditTripComponent implements OnInit, IFormComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private fb = inject(FormBuilder);
  private visitRepo = inject(VisitRepository);
  private tripRepo = inject(TripRepository);
  private shipRepo = inject(ShipRepository);
  private snackBar = inject(MatSnackBar);
  private shipIntelligence = inject(ShipIntelligenceService);
  private dialog = inject(MatDialog);
  pilotService = inject(PilotService); // Public so template can access pilotService.pilotNames()

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
  additionalTripIds: (string | null)[] = []; // Track IDs for additional trips (null = new trip)
  
  /**
   * Track IDs of trips that were deleted from the form.
   * These need to be deleted from Firestore on save.
   * 
   * WHY WE NEED THIS:
   * - When user clicks delete, trip is removed from FormArray
   * - But the trip still exists in the database
   * - We need to track which IDs to delete when save() is called
   */
  private deletedTripIds: string[] = [];

  // Additional trip types available for selection
  additionalTripTypes: TripType[] = ['Anchorage', 'Shift', 'BerthToBerth', 'Other'];

  // Autocomplete filtering
  // These Signals hold the current input value to filter the pilot list
  inwardPilotFilter = signal<string>('');
  outwardPilotFilter = signal<string>('');

  // Computed Signals that automatically filter pilots based on input
  // This demonstrates FUNCTIONAL REACTIVE PROGRAMMING:
  // - filteredInwardPilots automatically recalculates when pilotService.pilotNames() or inwardPilotFilter() changes
  // - No manual subscription management needed!
  filteredInwardPilots = computed(() => {
    const filterValue = this.inwardPilotFilter().toLowerCase();
    const pilots = this.pilotService.pilotNames();
    
    if (!filterValue) {
      return ['Unassigned', ...pilots]; // Show all if no filter
    }
    
    // Filter pilots that include the search term
    const filtered = pilots.filter(name => name.toLowerCase().includes(filterValue));
    return ['Unassigned', ...filtered];
  });

  filteredOutwardPilots = computed(() => {
    const filterValue = this.outwardPilotFilter().toLowerCase();
    const pilots = this.pilotService.pilotNames();
    
    if (!filterValue) {
      return ['Unassigned', ...pilots];
    }
    
    const filtered = pilots.filter(name => name.toLowerCase().includes(filterValue));
    return ['Unassigned', ...filtered];
  });

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
        pilot: ['', pilotValidator(this.pilotService)], // Add custom validator
        boarding: [null],
        port: [null],
        pilotNotes: ['']
      }),
      outwardTrip: this.fb.group({
        pilot: ['', pilotValidator(this.pilotService)], // Add custom validator
        boarding: [null],
        port: [null],
        pilotNotes: ['']
      }),
      additionalTrips: this.fb.array([]) // FormArray for dynamic additional trips
    });
  }

  /**
   * Getter for easier access to the additionalTrips FormArray in the template
   */
  get additionalTripsArray(): FormArray {
    return this.form.get('additionalTrips') as FormArray;
  }

  /**
   * Creates a FormGroup for a single trip (used for additional trips)
   * @param trip - Optional trip data to populate the form
   * @returns FormGroup with trip fields
   */
  createTripFormGroup(trip?: Trip): FormGroup {
    return this.fb.group({
      typeTrip: [trip?.typeTrip || 'Anchorage', Validators.required],
      pilot: [trip?.pilot || '', [Validators.required, pilotValidator(this.pilotService)]],
      boarding: [trip?.boarding ? (trip.boarding instanceof Timestamp ? trip.boarding.toDate() : trip.boarding) : null, Validators.required],
      port: [trip?.port || null],
      pilotNotes: [trip?.pilotNotes || '']
    });
  }

  /**
   * Adds a new empty trip to the additional trips array.
   * 
   * UX PATTERN: PREVENT ACCIDENTAL DOUBLE-ADDS
   * - After adding a trip, the button is disabled (see hasUnsavedAdditionalTrip)
   * - User must save first before adding another trip
   * - This prevents accidental double-clicks and keeps workflow clear
   */
  addTrip(): void {
    this.additionalTripsArray.push(this.createTripFormGroup());
    this.additionalTripIds.push(null); // null = new trip (not yet saved)
    
    // Mark that we have an unsaved additional trip
    // This will disable the "Add Trip" button until save() is called
    this.hasUnsavedAdditionalTrip = true;
  }

  /**
   * Removes a trip from the additional trips array.
   * If the trip exists in the database, mark it for deletion.
   * 
   * @param index - Index of the trip to remove
   */
  removeTrip(index: number): void {
    // Get the trip ID before removing from array
    const tripId = this.additionalTripIds[index];
    
    // If this trip exists in the database (has an ID), mark it for deletion
    if (tripId) {
      this.deletedTripIds.push(tripId);
    }
    
    // Remove from FormArray and IDs array
    this.additionalTripsArray.removeAt(index);
    this.additionalTripIds.splice(index, 1);
  }

  /**
   * Called when user types in the inward pilot autocomplete.
   * Updates the filter Signal, which triggers filteredInwardPilots to recalculate.
   */
  onInwardPilotInput(value: string): void {
    this.inwardPilotFilter.set(value);
  }

  /**
   * Called when user types in the outward pilot autocomplete.
   * Updates the filter Signal, which triggers filteredOutwardPilots to recalculate.
   */
  onOutwardPilotInput(value: string): void {
    this.outwardPilotFilter.set(value);
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

        // Handle Additional Trips (anything that's not 'In' or 'Out')
        const additionalTrips = trips.filter((t: Trip) => 
          t.typeTrip !== 'In' && t.typeTrip !== 'Out'
        );

        // Clear existing additional trips
        this.additionalTripsArray.clear();
        this.additionalTripIds = [];

        // Add each additional trip to the FormArray
        additionalTrips.forEach((trip: Trip) => {
          this.additionalTripsArray.push(this.createTripFormGroup(trip));
          this.additionalTripIds.push(trip.id || null);
        });

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
  
  /**
   * Tracks whether the form has been successfully submitted.
   * This prevents the unsaved changes warning after a successful save.
   * 
   * WHY WE NEED THIS:
   * - form.pristine only checks if form was touched, not if it was saved
   * - After save(), form is still dirty, but data IS saved
   * - This flag tells the guard: "data was saved, safe to navigate"
   */
  private formSubmitted = false;
  
  /**
   * Tracks if there's an unsaved additional trip.
   * Used to disable "Add Trip" button until user saves.
   * 
   * UX REASONING:
   * - Prevents accidental double-clicks on "Add Trip"
   * - Enforces clear workflow: Add → Fill → Save → Add Another
   * - Uncommon to need multiple additional trips at once
   */
  hasUnsavedAdditionalTrip = false;

  async save() {
    // If form is invalid, mark all fields as touched to show validation errors
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      
      // Collect all validation errors
      const errors: string[] = [];
      
      // Check ship errors
      const shipGroup = this.form.get('ship');
      if (shipGroup?.invalid) {
        if (shipGroup.get('shipName')?.hasError('required')) errors.push('Ship name is required');
        if (shipGroup.get('grossTonnage')?.hasError('required')) errors.push('Gross tonnage is required');
        if (shipGroup.get('grossTonnage')?.hasError('min')) errors.push('Gross tonnage must be at least 50');
        if (shipGroup.get('grossTonnage')?.hasError('max')) errors.push('Gross tonnage cannot exceed 200,000');
      }

      // Check visit errors
      const visitGroup = this.form.get('visit');
      if (visitGroup?.invalid) {
        if (visitGroup.get('initialEta')?.hasError('required')) errors.push('Initial ETA is required');
        if (visitGroup.get('currentStatus')?.hasError('required')) errors.push('Visit status is required');
      }

      // Check additional trips errors
      const additionalTrips = this.additionalTripsArray;
      additionalTrips.controls.forEach((trip, index) => {
        if (trip.invalid) {
          if (trip.get('typeTrip')?.hasError('required')) errors.push(`Trip ${index + 1}: Type is required`);
          if (trip.get('pilot')?.hasError('required')) errors.push(`Trip ${index + 1}: Pilot is required`);
          if (trip.get('pilot')?.hasError('invalidPilot')) errors.push(`Trip ${index + 1}: Invalid pilot selected`);
          if (trip.get('boarding')?.hasError('required')) errors.push(`Trip ${index + 1}: Boarding time is required`);
        }
      });

      // Show snackbar with errors
      const errorMessage = errors.length > 0 
        ? `Please fix the following:\n• ${errors.join('\n• ')}`
        : 'Please fix the validation errors highlighted in red';
      
      this.snackBar.open(errorMessage, 'Close', { 
        duration: 8000,
        panelClass: 'error-snackbar'
      });
      
      return;
    }

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

      // 3. Update or Create Trips
      // Inward Trip: Update if exists, CREATE if doesn't exist
      if (this.inwardTripId) {
        // Update existing inward trip
        await this.tripRepo.updateTrip(this.inwardTripId, {
          pilot: formVal.inwardTrip.pilot ?? null,
          boarding: (formVal.inwardTrip.boarding ? Timestamp.fromDate(formVal.inwardTrip.boarding) : null) as any,
          port: formVal.inwardTrip.port ?? null,
          pilotNotes: formVal.inwardTrip.pilotNotes ?? null
        });
      } else if (formVal.inwardTrip.pilot || formVal.inwardTrip.boarding) {
        // Create new inward trip if user has entered data but trip doesn't exist
        const newInwardTrip: Omit<Trip, 'id'> = {
          visitId: this.visitId!,
          shipId: this.shipId!,
          typeTrip: 'In',
          pilot: formVal.inwardTrip.pilot ?? '',
          boarding: formVal.inwardTrip.boarding ? Timestamp.fromDate(formVal.inwardTrip.boarding) : null,
          port: formVal.inwardTrip.port ?? null,
          pilotNotes: formVal.inwardTrip.pilotNotes ?? '',
          extraChargesNotes: '',
          isConfirmed: false,
          recordedBy: 'Admin', // TODO: Real user
          recordedAt: Timestamp.now(),
          ownNote: null,
          pilotNo: null,
          monthNo: null,
          car: null,
          timeOff: null,
          good: null
        };
        this.inwardTripId = await this.tripRepo.addTrip(newInwardTrip as any);
        console.log('Created new inward trip with ID:', this.inwardTripId);
      }

      // Outward Trip: Update if exists, CREATE if doesn't exist
      // CRITICAL FIX: Previously only updated, never created
      if (this.outwardTripId) {
        // Update existing outward trip
        await this.tripRepo.updateTrip(this.outwardTripId, {
          pilot: formVal.outwardTrip.pilot ?? null,
          boarding: (formVal.outwardTrip.boarding ? Timestamp.fromDate(formVal.outwardTrip.boarding) : null) as any,
          port: formVal.outwardTrip.port ?? null,
          pilotNotes: formVal.outwardTrip.pilotNotes ?? null
        });
      } else if (formVal.outwardTrip.pilot || formVal.outwardTrip.boarding) {
        // Create new outward trip if user has entered data but trip doesn't exist
        // This handles cases where the visit was created without an outward trip
        const newOutwardTrip: Omit<Trip, 'id'> = {
          visitId: this.visitId!,
          shipId: this.shipId!,
          typeTrip: 'Out',
          pilot: formVal.outwardTrip.pilot ?? '',
          boarding: formVal.outwardTrip.boarding ? Timestamp.fromDate(formVal.outwardTrip.boarding) : null,
          port: formVal.outwardTrip.port ?? null,
          pilotNotes: formVal.outwardTrip.pilotNotes ?? '',
          extraChargesNotes: '',
          isConfirmed: false,
          recordedBy: 'Admin', // TODO: Real user
          recordedAt: Timestamp.now(),
          ownNote: null,
          pilotNo: null,
          monthNo: null,
          car: null,
          timeOff: null,
          good: null
        };
        this.outwardTripId = await this.tripRepo.addTrip(newOutwardTrip as any);
        console.log('Created new outward trip with ID:', this.outwardTripId);
      }

      // 4. Delete any trips that were removed from the form
      // CRITICAL: Do this BEFORE updating remaining trips to avoid race conditions
      for (const tripId of this.deletedTripIds) {
        await this.tripRepo.deleteTrip(tripId);
      }
      // Clear the deletion tracking array after processing
      this.deletedTripIds = [];

      // 5. Handle Additional Trips (Update or Create)
      const additionalTripsData = formVal.additionalTrips as any[];
      for (let i = 0; i < additionalTripsData.length; i++) {
        const tripData = additionalTripsData[i];
        const tripId = this.additionalTripIds[i];

        const tripPayload = {
          typeTrip: tripData.typeTrip,
          pilot: tripData.pilot ?? '',
          boarding: tripData.boarding ? Timestamp.fromDate(tripData.boarding) : null,
          port: tripData.port ?? null,
          pilotNotes: tripData.pilotNotes ?? ''
        };

        if (tripId) {
          // Update existing trip
          await this.tripRepo.updateTrip(tripId, tripPayload as any);
        } else {
          // Create new trip
          await this.tripRepo.addTrip({
            ...tripPayload,
            visitId: this.visitId!,
            shipId: this.shipId!,
            isConfirmed: false,
            recordedBy: 'Admin', // TODO: Real user
            recordedAt: Timestamp.now()
          } as any);
        }
      }

      // Mark form as submitted to prevent unsaved changes warning
      this.formSubmitted = true;
      
      // Re-enable "Add Trip" button now that save is complete
      this.hasUnsavedAdditionalTrip = false;
      
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

  /**
   * Implementation of IFormComponent interface.
   * Called by the CanDeactivate guard before navigation.
   * 
   * GUARD LOGIC:
   * - Return true = safe to navigate (no warning)
   * - Return false = show warning dialog
   * 
   * We allow navigation if:
   * 1. Form is pristine (user hasn't touched it)
   * 2. OR form was successfully submitted (data is saved)
   * 
   * @returns true if safe to navigate, false to show warning
   */
  canDeactivate(): boolean {
    return this.form.pristine || this.formSubmitted;
  }
}
