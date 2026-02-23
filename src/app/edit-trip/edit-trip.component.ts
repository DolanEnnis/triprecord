import { Component, inject, OnInit, signal, computed, DestroyRef } from '@angular/core';
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
import { VisitRepository } from '../services/repositories/visit.repository';
import { TripRepository } from '../services/repositories/trip.repository';
import { ShipRepository } from '../services/repositories/ship.repository';
import { PilotService } from '../services/state/pilot.service';
import { ShipIntelligenceService } from '../services/integrations/ship-intelligence.service';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { ShipIntelligenceDialogComponent } from '../dialogs/ship-intelligence-dialog.component';
import { OldTripWarningDialogComponent } from '../dialogs/old-trip-warning-dialog.component';
import { ConfirmDialogComponent } from '../dialogs/confirm-dialog.component';
import { Trip, Visit, Ship, Port, VisitStatus, TripType, Source, EnrichedVisit, AuditablePayload } from '../models';
import { AuditHistoryDialogComponent } from '../dialogs/audit-history-dialog.component';
import { combineLatest, filter, map, switchMap, of, forkJoin, catchError, tap, take, Observable } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Timestamp } from '@angular/fire/firestore';
import { DateTimePickerComponent } from '../date-time-picker/date-time-picker.component';
import { PreviousVisitsListComponent } from '../previous-visits/previous-visits-list/previous-visits-list.component';
import { ViewVisitDialogComponent } from '../new-visit/view-visit-dialog.component';
import { IFormComponent } from '../guards/form-component.interface';
import { AuthService } from '../auth/auth';
import { Location } from '@angular/common';
import { TimeAgoPipe } from '../shared/pipes/time-ago.pipe';

/**
 * Custom validator to ensure the selected pilot is from the valid pilot list.
 * 
 * LEARNING: VALIDATING HISTORICAL DATA vs NEW DATA
 * - Retired pilots may not have logins but exist in historical trip data
 * - We need to accept the original pilot name even if they're retired
 * - But still validate newly selected pilots against active pilot list
 * 
 * WHY A VALIDATOR FACTORY?
 * - We need to pass the PilotService AND original pilot name to the validator
 * - Angular validators are just functions, so we use a factory pattern
 * - This returns a ValidatorFn that has access to both via closure
 * 
 * @param pilotService - The injected PilotService to validate against
 * @param originalPilotName - The pilot name loaded from the database (may be retired)
 * @returns A ValidatorFn that checks if the pilot name is valid
 */
function pilotValidator(pilotService: PilotService, originalPilotName?: string | null): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value;
    
    // Allow empty values (handled by required validator if needed)
    if (!value || value.trim() === '') {
      return null;
    }
    
    // CRITICAL FIX: Allow the original pilot name even if retired
    // This preserves historical data integrity
    if (originalPilotName && value === originalPilotName) {
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
    MatNativeDateModule,
    MatDialogModule,
    MatAutocompleteModule,
    MatTooltipModule,
    DateTimePickerComponent,
    PreviousVisitsListComponent,
    TimeAgoPipe,  // For displaying relative time in header
    // Note: Dialog components opened via MatDialog.open() (ConfirmDialogComponent,
    // AuditHistoryDialogComponent, etc.) do NOT go here — they are resolved by DI
    // at runtime, not by the template compiler. Adding them causes NG8113 warnings.
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
  private authService = inject(AuthService);
  private location = inject(Location);
  private destroyRef = inject(DestroyRef); // For automatic subscription cleanup
  pilotService = inject(PilotService); // Public so template can access pilotService.pilotNames()

  visitId: string | null = null;
  form!: FormGroup;
  loading = signal(true);
  
  // Track original pilot names for retired pilot validation
  // These capture the pilot names when the trip is loaded,
  // allowing us to save trips with retired pilots without validation errors
  originalInwardPilot = signal<string | null>(null);
  originalOutwardPilot = signal<string | null>(null);

  // Track original ship details to warn about historical data updates
  originalShipDetails = signal<{ name: string; gt: number } | null>(null);
  
  // Track original berth port to sync changes to trips
  originalBerthPort = signal<string | null>(null);
  
  // Trip age calculation for old trip warning
  initialEta = signal<Date | null>(null);
  tripAgeDays = computed(() => {
    const eta = this.initialEta();
    if (!eta) return 0;
    
    const now = new Date();
    const diffMs = now.getTime() - eta.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    return diffDays;
  });
  
  isOldTrip = computed(() => this.tripAgeDays() >= 60);
  userAcknowledgedOldTrip = signal(false);
  
  // LEARNING: TRIP HISTORY DISPLAY PATTERN
  // Store enriched visit history for the current ship to show context
  // This follows the same pattern as ships.component.ts
  // EnrichedVisit includes both In and Out trip data already joined
  shipVisits = signal<EnrichedVisit[]>([]);
  
  // LEARNING: DISPLAY-ONLY METADATA
  // These signals store read-only info about when/who last updated the visit.
  // Unlike form fields, these are NOT editable - they're set by the system on save.
  visitUpdatedAt = signal<Date | null>(null);
  visitUpdatedBy = signal<string | null>(null);
  visitSource = signal<string | null>(null);

  // COLLAPSIBLE CARDS FEATURE
  // Signals to track which sections are expanded/collapsed
  // Auto-set based on ship status in loadData(), but user can toggle manually
  shipDetailsExpanded = signal(false);   // Collapsed by default (for mobile, desktop CSS overrides)
  visitStatusExpanded = signal(true);    // Expanded by default
  inwardTripExpanded = signal(false);    // Collapsed by default
  outwardTripExpanded = signal(false);   // Collapsed by default
  additionalTripsExpanded = signal(false); // Collapsed by default
  
  // Enums/Options for template
  ports: Port[] = ['Anchorage', 'Cappa', 'Moneypoint', 'Tarbert', 'Foynes', 'Aughinish', 'Shannon', 'Limerick'];
  visitStatuses: VisitStatus[] = ['Due', 'Awaiting Berth', 'Alongside', 'Sailed', 'Undefined', 'Cancelled'];
  sources: Source[] = ['Sheet', 'Sheet-Info', 'AIS', 'Good Guess', 'Agent', 'Pilot', 'Other'];

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

  // Track if user is admin for UI permission logic
  isAdmin = signal(false);

  // Signals to track confirmation state for UI feedback
  inwardTripConfirmed = signal(false);
  outwardTripConfirmed = signal(false);

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
    
    // LEARNING: REACTING TO ROUTE PARAM CHANGES
    // Using route.snapshot.paramMap only reads params ONCE on component init.
    // If the user navigates from /edit/ABC to /edit/XYZ (clicking trip history),
    // Angular REUSES the same component instance, so ngOnInit doesn't run again.
    // 
    // Solution: Subscribe to route.paramMap to reactively reload data when visitId changes.
    // takeUntilDestroyed ensures the subscription is automatically cleaned up.
    this.route.paramMap.pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(params => {
      const visitId = params.get('id');
      
      if (visitId) {
        this.visitId = visitId;
        this.loadData(visitId);
      } else {
        this.snackBar.open('No Visit ID provided', 'Close', { duration: 3000 });
        this.loading.set(false);
      }
    });
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
        pilotNotes: [''],
        // Pilot-only fields (visible only to assigned pilot)
        extraChargesNotes: [''],
        ownNote: [''],
        pilotNo: [null],
        monthNo: [null],
        car: [''],
        timeOff: [null],
        good: [null]
      }),
      outwardTrip: this.fb.group({
        pilot: ['', pilotValidator(this.pilotService)], // Add custom validator
        boarding: [null],
        port: [null],
        pilotNotes: [''],
        // Pilot-only fields (visible only to assigned pilot)
        extraChargesNotes: [''],
        ownNote: [''],
        pilotNo: [null],
        monthNo: [null],
        car: [''],
        timeOff: [null],
        good: [null]
      }),
      additionalTrips: this.fb.array([]) // FormArray for dynamic additional trips
    });
  }

  /**
   * Getter for easier access to the additionalTrips FormArray in the template
   * 
   * LEARNING: TYPED FORM ARRAYS
   * - FormArray<FormGroup> is more specific than just FormArray
   * - This tells TypeScript that each element is a FormGroup (not just any control)
   * - Better IntelliSense and type checking in your IDE
   */
  get additionalTripsArray(): FormArray<FormGroup> {
    return this.form.get('additionalTrips') as FormArray<FormGroup>;
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
    
    // LEARNING: RESETTING FORM STATE WHEN SWITCHING VISITS
    // When navigating from one visit to another (e.g., clicking trip history),
    // the component is reused. We need to reset form and state to prevent:
    // - Old form data appearing briefly
    // - Stale validation errors
    // 
    // NOTE: We do NOT reset shipVisits here because it's loaded asynchronously.
    // Resetting it here causes a race condition where old subscriptions might
    // complete after the reset. Instead, let the new subscription naturally update it.
    this.form.reset();
    this.additionalTripsArray.clear();
    this.additionalTripIds = [];
    this.deletedTripIds = [];

    // 1. Get Visit
    // LEARNING: PREVENTING MEMORY LEAKS WITH takeUntilDestroyed
    // - If the user navigates away before data loads, the subscription would keep running
    // - takeUntilDestroyed(this.destroyRef) automatically completes the observable when component is destroyed
    // - This is the MODERN Angular 16+ pattern (replaces the old takeUntil(ngUnsubscribe$) pattern)
    // - No manual cleanup needed!
    this.visitRepo.getVisitById(visitId).pipe(
      takeUntilDestroyed(this.destroyRef),
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
        const isAdmin = this.authService.currentUserSig()?.userType === 'admin';
        this.isAdmin.set(isAdmin);

        if (ship) {
          this.originalShipDetails.set({
            name: ship.shipName,
            gt: ship.grossTonnage
          });

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
        
        // Capture update metadata for display in header (read-only info)
        // These show the user when the visit was last updated and by whom
        this.visitUpdatedAt.set(
          visit.statusLastUpdated instanceof Timestamp ? visit.statusLastUpdated.toDate() : null
        );
        this.visitUpdatedBy.set(visit.updatedBy ?? null);
        this.visitSource.set(visit.source ?? null);
        
        // Capture original berth port for sync logic
        this.originalBerthPort.set(visit.berthPort || null);
        
        // Capture initial ETA for trip age calculation
        const eta = visit.initialEta instanceof Timestamp ? visit.initialEta.toDate() : visit.initialEta;
        this.initialEta.set(eta);

        // Handle Trips
        const inTrip = trips.find((t: Trip) => t.typeTrip === 'In');
        const outTrip = trips.find((t: Trip) => t.typeTrip === 'Out');

        if (inTrip) {
          this.inwardTripId = inTrip.id!;
          // Capture original pilot name for validation
          this.originalInwardPilot.set(inTrip.pilot || null);
          
          this.form.patchValue({
            inwardTrip: {
              pilot: inTrip.pilot,
              boarding: inTrip.boarding instanceof Timestamp ? inTrip.boarding.toDate() : inTrip.boarding,
              port: inTrip.port || visit.berthPort, // Default to visit berth
              pilotNotes: inTrip.pilotNotes,
              // Pilot-only fields
              extraChargesNotes: inTrip.extraChargesNotes,
              ownNote: inTrip.ownNote,
              pilotNo: inTrip.pilotNo,
              monthNo: inTrip.monthNo,
              car: inTrip.car,
              timeOff: inTrip.timeOff instanceof Timestamp ? inTrip.timeOff.toDate() : inTrip.timeOff,
              good: inTrip.good
            }
          });
          
          // Update validator to accept the original (potentially retired) pilot name
          const inwardPilotControl = this.form.get('inwardTrip.pilot');
          inwardPilotControl?.clearValidators();
          inwardPilotControl?.setValidators(pilotValidator(this.pilotService, inTrip.pilot));
          inwardPilotControl?.updateValueAndValidity();

          // LOCK IF CONFIRMED (Step 8: Granular Locking)
          // Only lock billing-critical fields. Allow Notes editing.
          if (inTrip.isConfirmed) {
            this.inwardTripConfirmed.set(true);
            if (!isAdmin) {
              this.form.get('inwardTrip.pilot')?.disable();
              this.form.get('inwardTrip.boarding')?.disable();
              this.form.get('inwardTrip.port')?.disable();
              this.form.get('inwardTrip.extraChargesNotes')?.disable();
            }
          }
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
          // Capture original pilot name for validation
          this.originalOutwardPilot.set(outTrip.pilot || null);
          
          this.form.patchValue({
            outwardTrip: {
              pilot: outTrip.pilot,
              boarding: outTrip.boarding instanceof Timestamp ? outTrip.boarding.toDate() : outTrip.boarding,
              port: outTrip.port || visit.berthPort, // Default to visit berth
              pilotNotes: outTrip.pilotNotes,
              // Pilot-only fields
              extraChargesNotes: outTrip.extraChargesNotes,
              ownNote: outTrip.ownNote,
              pilotNo: outTrip.pilotNo,
              monthNo: outTrip.monthNo,
              car: outTrip.car,
              timeOff: outTrip.timeOff instanceof Timestamp ? outTrip.timeOff.toDate() : outTrip.timeOff,
              good: outTrip.good
            }
          });
          
          // Update validator to accept the original (potentially retired) pilot name
          const outwardPilotControl = this.form.get('outwardTrip.pilot');
          outwardPilotControl?.clearValidators();
          outwardPilotControl?.setValidators(pilotValidator(this.pilotService, outTrip.pilot));
          outwardPilotControl?.updateValueAndValidity();

          // LOCK IF CONFIRMED (Step 8: Granular Locking)
          if (outTrip.isConfirmed) {
            this.outwardTripConfirmed.set(true);
            if (!isAdmin) {
              this.form.get('outwardTrip.pilot')?.disable();
              this.form.get('outwardTrip.boarding')?.disable();
              this.form.get('outwardTrip.port')?.disable();
              this.form.get('outwardTrip.extraChargesNotes')?.disable();
            }
          }
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
          const tripGroup = this.createTripFormGroup(trip);
          
          // LOCK IF CONFIRMED (Step 8: Granular Locking)
          if (trip.isConfirmed) {
            // We need a way to track confirmation for individual additional trips
            // For now, we'll just rely on the UI visual disable state as the array is dynamic
             if (!isAdmin) {
               tripGroup.get('typeTrip')?.disable();
               tripGroup.get('pilot')?.disable();
               tripGroup.get('boarding')?.disable();
               tripGroup.get('port')?.disable();
             }
          }

          this.additionalTripsArray.push(tripGroup);
          this.additionalTripIds.push(trip.id || null);
        });

        // LEARNING: LOAD SHIP VISIT HISTORY FOR CONTEXT
        // After loading the current visit, fetch all previous visits for this ship
        // This provides helpful context when editing (e.g., seeing the ship's typical berth/pilot)
        // Uses getEnrichedVisitsByShipId which returns EnrichedVisit[] with both In/Out trip data
        if (this.shipId) {
          // LEARNING: PROMISE-BASED FETCH FOR ONE-SHOT READS
          // Previously we used collectionData().pipe(take(1)) which had a race condition:
          // - collectionData() may emit empty BEFORE real data arrives (cache miss)
          // - take(1) would complete with that empty array
          // 
          // The new getEnrichedVisitsByShipIdOnce() uses getDocs() which is Promise-based
          // and WAITS for the actual Firestore response - no race condition possible.
          this.visitRepo.getEnrichedVisitsByShipIdOnce(this.shipId)
            .then(enrichedVisits => {
              this.shipVisits.set(enrichedVisits);
            })
            .catch(err => {
              console.error('Failed to load ship visit history:', err);
              this.shipVisits.set([]);
            });
        }

        this.loading.set(false);
        
        // Initialize card expansion states based on ship status
        this.initializeCardExpansion();
        
        // UX: Show notification to confirm which visit is loaded
        // This provides clear feedback when navigating between visits via trip history
        const shipName = ship?.shipName || 'Unknown Ship';
        const statusText = visit.currentStatus;
        this.snackBar.open(`Loaded ${shipName} - ${statusText}`, 'Close', { 
          duration: 3000,
          horizontalPosition: 'center',
          verticalPosition: 'top'
        });
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
    // FEATURE: Old Trip Warning
    // Check if this is an old trip (60+ days) and user hasn't acknowledged
    if (this.isOldTrip() && !this.userAcknowledgedOldTrip()) {
      const dialogRef = this.dialog.open(OldTripWarningDialogComponent, {
        width: '500px',
        disableClose: true, // Force user to make a choice
        data: { tripAgeDays: this.tripAgeDays() }
      });
      
      const userConfirmed = await dialogRef.afterClosed().toPromise();
      
      if (!userConfirmed) {
        // User clicked "Cancel" - don't save
        return;
      }
      
      // User clicked "Edit Anyway" - remember this so we don't show again
      this.userAcknowledgedOldTrip.set(true);
    }

    // FEATURE: Ship Details Change Warning
    // Warn if Ship Name or GT has changed, as this affects historical billing/visits
    const currentShipName = this.form.get('ship.shipName')?.value;
    const currentGt = this.form.get('ship.grossTonnage')?.value;
    const original = this.originalShipDetails();

    if (original && (currentShipName !== original.name || currentGt !== original.gt)) {
      const dialogRef = this.dialog.open(ConfirmDialogComponent, {
        width: '500px',
        disableClose: true,
        data: {
          title: 'Confirm Ship Details Change',
          message: '⚠ Warning: You are changing the ship\'s Name or Gross Tonnage.\n\nThis will automatically update all visits and trips for this ship from the past 60 days to match the new details.\n\nThis ensures invoices are correct, but changes historical records. Are you sure?',
          confirmText: 'Update All',
          cancelText: 'Cancel',
          isDestructive: true
        }
      });

      const confirmed = await dialogRef.afterClosed().toPromise();
      if (!confirmed) {
        return;
      }
    }
    
    // If form is invalid, mark all fields as touched to show validation errors
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      
      // Use the extracted error collection method (DRY principle!)
      const errors = this.collectFormErrors();

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

    // Use getRawValue() to include disabled fields (Step 8)
    // verification: Firestore rules prevent changing disabled fields anyway
    const formVal = this.form.getRawValue();
    const updatedBy = this.authService.currentUserSig()?.displayName || 'Unknown';
    const now = Timestamp.now();

    // AUDIT STAMP: Attach metadata to every write so Cloud Function triggers
    // can identify WHO made the change and from WHERE without a separate lookup.
    // Using UID (not displayName) because it's guaranteed unique and can't be
    // changed by the client, making it a reliable audit key.
    const auditStamp: AuditablePayload = {
      _modifiedBy: this.authService.currentUserSig()?.uid || 'unknown',
      _modifiedFrom: this.router.url,
    };

    try {
      // 1. Update Ship
      if (this.shipId) {
        await this.shipRepo.updateShip(this.shipId, {
          shipName: formVal.ship.shipName,
          grossTonnage: formVal.ship.grossTonnage,
          imoNumber: formVal.ship.imoNumber ?? null,
          marineTrafficLink: formVal.ship.marineTrafficLink ?? null,
          shipNotes: formVal.ship.shipNotes ?? null,
          shipName_lowercase: formVal.ship.shipName.toLowerCase(),
          ...auditStamp, // Triggers onShipWritten Cloud Function
        });
      }

      // 2. Update Visit
      if (this.visitId) {
        // CRITICAL FIX: Explicitly update ship details on the visit to ensure
        // immediate consistency in the Status List (don't wait for Cloud Function)
        await this.visitRepo.updateVisit(this.visitId, {
          shipName: formVal.ship.shipName,
          grossTonnage: formVal.ship.grossTonnage,
          shipName_lowercase: formVal.ship.shipName.toLowerCase(), // Required for search
          
          currentStatus: formVal.visit.currentStatus,
          initialEta: Timestamp.fromDate(formVal.visit.initialEta),
          berthPort: formVal.visit.berthPort ?? null,
          visitNotes: formVal.visit.visitNotes ?? null,
          source: formVal.visit.source ?? 'Other', // Default to 'Other' if undefined
          updatedBy: updatedBy,
          statusLastUpdated: now,
          ...auditStamp, // Triggers onVisitWritten Cloud Function
        });
      }

      // Feature: Port Sync
      // If Berth Port changed, automatically update Trip Ports if they matched the old berth
      const currentBerthPort = formVal.visit.berthPort;
      const originalBerth = this.originalBerthPort();
      const berthChanged = currentBerthPort !== originalBerth;

      // 3. Update or Create Trips
      // Inward Trip: Update if exists, CREATE if doesn't exist
      if (this.inwardTripId) {
        
        let inwardPortToSave = formVal.inwardTrip.port;
        // Auto-sync logic: If berth changed, and trip port matches OLD berth (or is empty), update it
        if (berthChanged && (!inwardPortToSave || inwardPortToSave === originalBerth)) {
             inwardPortToSave = currentBerthPort;
        }

        // Update existing inward trip (Always update - Firestore rules filter allowed fields)
        const inwardTripUpdate: Partial<Trip> = {
          pilot: formVal.inwardTrip.pilot ?? '',
          boarding: formVal.inwardTrip.boarding ? Timestamp.fromDate(formVal.inwardTrip.boarding) : null,
          port: inwardPortToSave ?? null,
          pilotNotes: formVal.inwardTrip.pilotNotes ?? '',
          extraChargesNotes: formVal.inwardTrip.extraChargesNotes ?? '',
          ownNote: formVal.inwardTrip.ownNote ?? null,
          pilotNo: formVal.inwardTrip.pilotNo ?? null,
          monthNo: formVal.inwardTrip.monthNo ?? null,
          car: formVal.inwardTrip.car ?? null,
          timeOff: formVal.inwardTrip.timeOff ? Timestamp.fromDate(formVal.inwardTrip.timeOff) : null,
          good: formVal.inwardTrip.good ?? null,
          lastModifiedBy: updatedBy,
          lastModifiedAt: now,
          ...auditStamp, // Triggers onTripWritten Cloud Function
        };
        await this.tripRepo.updateTrip(this.inwardTripId, inwardTripUpdate);
      } else if (formVal.inwardTrip?.pilot || formVal.inwardTrip?.boarding) {
        
        // For new trips, default to current berth port if not specified
        const portToSave = formVal.inwardTrip.port || currentBerthPort || null;

        // Create new inward trip if user has entered data but trip doesn't exist
        const newInwardTrip: Omit<Trip, 'id'> = {
          visitId: this.visitId!,
          shipId: this.shipId!,
          typeTrip: 'In',
          pilot: formVal.inwardTrip.pilot ?? '',
          boarding: formVal.inwardTrip.boarding ? Timestamp.fromDate(formVal.inwardTrip.boarding) : null,
          port: portToSave,
          pilotNotes: formVal.inwardTrip.pilotNotes ?? '',
          extraChargesNotes: '',
          isConfirmed: false,
          recordedBy: this.authService.currentUserSig()?.displayName || 'Unknown',
          recordedAt: Timestamp.now(),
          ownNote: null,
          pilotNo: null,
          monthNo: null,
          car: null,
          timeOff: null,
          good: null
        };
        this.inwardTripId = await this.tripRepo.addTrip(newInwardTrip);
        console.log('Created new inward trip with ID:', this.inwardTripId);
      }

      // Outward Trip: Update if exists, CREATE if doesn't exist
      if (this.outwardTripId) {
        
        let outwardPortToSave = formVal.outwardTrip.port;
        // Auto-sync logic: If berth changed, and trip port matches OLD berth (or is empty), update it
        if (berthChanged && (!outwardPortToSave || outwardPortToSave === originalBerth)) {
             outwardPortToSave = currentBerthPort;
        }

        // Update existing outward trip
        const outwardTripUpdate: Partial<Trip> = {
          pilot: formVal.outwardTrip.pilot ?? '',
          boarding: formVal.outwardTrip.boarding ? Timestamp.fromDate(formVal.outwardTrip.boarding) : null,
          port: outwardPortToSave ?? null,
          pilotNotes: formVal.outwardTrip.pilotNotes ?? '',
          extraChargesNotes: formVal.outwardTrip.extraChargesNotes ?? '',
          ownNote: formVal.outwardTrip.ownNote ?? null,
          pilotNo: formVal.outwardTrip.pilotNo ?? null,
          monthNo: formVal.outwardTrip.monthNo ?? null,
          car: formVal.outwardTrip.car ?? null,
          timeOff: formVal.outwardTrip.timeOff ? Timestamp.fromDate(formVal.outwardTrip.timeOff) : null,
          good: formVal.outwardTrip.good ?? null,
          lastModifiedBy: updatedBy,
          lastModifiedAt: now,
          ...auditStamp, // Triggers onTripWritten Cloud Function
        };
        await this.tripRepo.updateTrip(this.outwardTripId, outwardTripUpdate);
      } else if (formVal.outwardTrip?.pilot || formVal.outwardTrip?.boarding) {
        
        // For new trips, default to current berth port if not specified
        const portToSave = formVal.outwardTrip.port || currentBerthPort || null;

        // Create new outward trip if user has entered data but trip doesn't exist
        const newOutwardTrip: Omit<Trip, 'id'> = {
          visitId: this.visitId!,
          shipId: this.shipId!,
          typeTrip: 'Out',
          pilot: formVal.outwardTrip.pilot ?? '',
          boarding: formVal.outwardTrip.boarding ? Timestamp.fromDate(formVal.outwardTrip.boarding) : null,
          port: portToSave,
          pilotNotes: formVal.outwardTrip.pilotNotes ?? '',
          extraChargesNotes: '',
          isConfirmed: false,
          recordedBy: this.authService.currentUserSig()?.displayName || 'Unknown',
          recordedAt: Timestamp.now(),
          ownNote: null,
          pilotNo: null,
          monthNo: null,
          car: null,
          timeOff: null,
          good: null
        };
        this.outwardTripId = await this.tripRepo.addTrip(newOutwardTrip);
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
      // MIGRATION FIX: Iterate FormArray Controls to safely handle disabled groups
      // using keys from this.additionalTripIds is safe because indices match FormArray
      
      const tripControls = this.additionalTripsArray.controls;
      
      for (let i = 0; i < tripControls.length; i++) {
        const tripGroup = tripControls[i];
        const tripId = this.additionalTripIds[i]; // aligned by index
        
        // Use getRawValue() for form groups within FormArray too
        const tripData = tripGroup.getRawValue(); 

        if (tripId) {
          // Update existing trip
          const updatePayload: Partial<Trip> = {
            typeTrip: tripData.typeTrip,
            pilot: tripData.pilot ?? '',
            boarding: tripData.boarding ? Timestamp.fromDate(tripData.boarding) : null,
            port: tripData.port ?? null,
            pilotNotes: tripData.pilotNotes ?? '',
            lastModifiedBy: updatedBy,
            lastModifiedAt: now,
            ...auditStamp, // Triggers onTripWritten Cloud Function
          };
          await this.tripRepo.updateTrip(tripId, updatePayload);
        } else {
          // Create new trip
          const newTrip: Omit<Trip, 'id'> = {
            visitId: this.visitId!,
            shipId: this.shipId!,
            typeTrip: tripData.typeTrip,
            pilot: tripData.pilot ?? '',
            boarding: tripData.boarding ? Timestamp.fromDate(tripData.boarding) : null,
            port: tripData.port ?? null,
            pilotNotes: tripData.pilotNotes ?? '',
            extraChargesNotes: '',
            isConfirmed: false,
            recordedBy: this.authService.currentUserSig()?.displayName || 'Unknown',
            recordedAt: Timestamp.now(),
            ownNote: null,
            pilotNo: null,
            monthNo: null,
            car: null,
            timeOff: null,
            good: null,
            ...auditStamp, // Triggers onTripWritten Cloud Function
          };
          
          await this.tripRepo.addTrip(newTrip);
        }
      }


      // Mark form as submitted to prevent unsaved changes warning
      this.formSubmitted = true;
      
      // Re-enable "Add Trip" button now that save is complete
      this.hasUnsavedAdditionalTrip = false;
      
      this.snackBar.open('Changes saved successfully', 'Close', { duration: 3000 });
      
      // LEARNING: PRESERVING NAVIGATION CONTEXT
      // Use Location.back() instead of hardcoded route to return user to their previous page.
      // This works whether they came from:
      // - Status List (/)
      // - Previous Visits (/previous)  
      // - Ships page (/ships)
      // - Any other page
      // The browser history remembers where they were, so we just go back one step.
      this.location.back();
    } catch (err) {
      console.error('Error saving', err);
      this.snackBar.open('Error saving changes', 'Close');
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Opens the Audit History dialog for the current visit or ship.
   *
   * LEARNING: GENERIC DIALOGS VIA DATA INJECTION
   * Rather than creating separate dialogs for trip history, visit history, and ship history,
   * we pass the `documentId` and `collectionName` as dialog data. The AuditHistoryDialogComponent
   * dispatches to the correct repository internally. This is the Open/Closed principle:
   * the dialog is open for extension (new collection types) without modifying existing code.
   *
   * @param type 'visit' | 'ship' — which document's history to show
   */
  openAuditHistory(type: 'visit' | 'ship'): void {
    if (type === 'visit' && this.visitId) {
      this.dialog.open(AuditHistoryDialogComponent, {
        width: '720px',
        maxHeight: '90vh',
        data: {
          documentId: this.visitId,
          collectionName: 'visits_new',
          displayLabel: this.form.get('ship.shipName')?.value ?? 'Visit',
        },
      });
    } else if (type === 'ship' && this.shipId) {
      this.dialog.open(AuditHistoryDialogComponent, {
        width: '720px',
        maxHeight: '90vh',
        data: {
          documentId: this.shipId,
          collectionName: 'ships',
          displayLabel: this.form.get('ship.shipName')?.value ?? 'Ship',
        },
      });
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
   * Determines if the Visit Status card should be highlighted.
   * Highlighted when ship is "Due" (waiting for ETA/arrival).
   * 
   * UX PATTERN: VISUAL WORKFLOW GUIDANCE
   * We guide the user's attention to the relevant section based on where
   * they are in the visit workflow: ETA → ETB → ETS
   */
  shouldHighlightVisitStatus(): boolean {
    const status = this.form.get('visit.currentStatus')?.value;
    return status === 'Due';
  }

  /**
   * Determines if the Inward Trip card should be highlighted.
   * Highlighted when ship is "Awaiting Berth" (ETA passed, waiting for ETB).
   */
  shouldHighlightInwardTrip(): boolean {
    const status = this.form.get('visit.currentStatus')?.value;
    return status === 'Awaiting Berth';
  }

  /**
   * Determines if the Outward Trip card should be highlighted.
   * Highlighted when ship is "Alongside" (ETB passed, waiting for ETS).
   * NOT highlighted for "Sailed" - complete visits need no visual guidance.
   */
  shouldHighlightOutwardTrip(): boolean {
    const status = this.form.get('visit.currentStatus')?.value;
    return status === 'Alongside';
  }

  // COLLAPSIBLE CARDS: Toggle methods for manual expand/collapse
  toggleShipDetails(): void {
    this.shipDetailsExpanded.update(v => !v);
  }

  toggleVisitStatus(): void {
    this.visitStatusExpanded.update(v => !v);
  }

  toggleInwardTrip(): void {
    this.inwardTripExpanded.update(v => !v);
  }

  toggleOutwardTrip(): void {
    this.outwardTripExpanded.update(v => !v);
  }

  toggleAdditionalTrips(): void {
    this.additionalTripsExpanded.update(v => !v);
  }

  /**
   * Initializes card expansion state based on ship status.
   * Called after loading data to set appropriate defaults.
   * 
   * Logic:
   * - Due: Visit Status expanded, others collapsed
   * - Awaiting Berth: Inward Trip expanded, others collapsed
   * - Alongside: Outward Trip expanded, others collapsed
   * - Sailed: ALL sections expanded
   */
  private initializeCardExpansion(): void {
    const status = this.form.get('visit.currentStatus')?.value;
    
    if (status === 'Sailed') {
      // Sailed ships: expand all sections for review
      this.visitStatusExpanded.set(true);
      this.inwardTripExpanded.set(true);
      this.outwardTripExpanded.set(true);
    } else if (status === 'Alongside') {
      this.visitStatusExpanded.set(false);
      this.inwardTripExpanded.set(false);
      this.outwardTripExpanded.set(true);
    } else if (status === 'Awaiting Berth') {
      this.visitStatusExpanded.set(false);
      this.inwardTripExpanded.set(true);
      this.outwardTripExpanded.set(false);
    } else {
      // Due or any other status: focus on Visit Status
      this.visitStatusExpanded.set(true);
      this.inwardTripExpanded.set(false);
      this.outwardTripExpanded.set(false);
    }
  }

  /**
   * Gets the available source options for the dropdown.
   * 
   * LEARNING: CONDITIONAL UI OPTIONS
   * 'Sheet-Info' is an automated source (set by AI-assisted updates from Sheet-Info page).
   * We don't want users to manually select it, but we need to show it if it's already set.
   * 
   * This method includes 'Sheet-Info' ONLY if it's the current value, so:
   * - Users can see it's set to 'Sheet-Info' (transparency)
   * - They can change it to something else if needed (override capability)
   * - But they can't manually select 'Sheet-Info' for new entries (prevents misuse)
   * 
   * @returns Array of Source values available for selection
   */
  getAvailableSources(): Source[] {
    const currentSource = this.form.get('visit.source')?.value;
    if (currentSource && !this.sources.includes(currentSource)) {
      return [...this.sources, currentSource];
    }
    return this.sources;
  }

  getSourceError(): string {
    const control = this.form.get('visit.source');
    if (control?.hasError('required')) {
      return 'Source is required';
    }
    return '';
  }

  /**
   * Checks if the current logged-in user is the pilot assigned to the inward trip.
   * Used to conditionally show pilot-only fields.
   * 
   * PRIVACY PATTERN: ROLE-BASED FIELD VISIBILITY
   * Some fields are personal to the pilot (like notes, car, time off).
   * We only show these when the logged-in user IS the assigned pilot.
   * 
   * @returns true if current user matches inward trip pilot name
   */
  isCurrentUserInwardPilot(): boolean {
    const pilotName = this.form.get('inwardTrip.pilot')?.value;
    const currentUser = this.authService.currentUserSig();
    
    if (!pilotName || !currentUser) return false;
    
    // Check if the pilot name matches the current user's display name
    // Case insensitive comparison for robustness
    return pilotName.toLowerCase() === currentUser.displayName?.toLowerCase();
  }

  /**
   * Checks if the current logged-in user is the pilot assigned to the outward trip.
   */
  isCurrentUserOutwardPilot(): boolean {
    const pilotName = this.form.get('outwardTrip.pilot')?.value;
    const currentUser = this.authService.currentUserSig();
    
    if (!pilotName || !currentUser) return false;
    
    return pilotName.toLowerCase() === currentUser.displayName?.toLowerCase();
  }

  // Helper needed for the template to check if there's a valid pilot service
  // Public accessor for template
  get pilotServicePublic(): PilotService {
    return this.pilotService;
  }

  openVisitDialog(visit: EnrichedVisit) {
    this.dialog.open(ViewVisitDialogComponent, {
      width: '800px',
      maxHeight: '90vh',
      data: { visitId: visit.visitId },
      autoFocus: false
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

  /**
   * LEARNING: EXTRACTING REUSABLE VALIDATION LOGIC
   * 
   * WHY THIS METHOD EXISTS:
   * - The save() method already has excellent error collection logic
   * - Instead of duplicating that code, we extract it into a reusable method
   * - Both the tooltip AND the save() snackbar can use the same validation messages
   * 
   * PATTERN: DRY (Don't Repeat Yourself) PRINCIPLE
   * - One source of truth for error messages
   * - If we add new validations, only update in one place
   * - Tooltip and snackbar always show identical messages
   * 
   * @returns Array of user-friendly error messages
   */
  private collectFormErrors(): string[] {
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

    // Check inward trip pilot validation
    const inwardTrip = this.form.get('inwardTrip');
    if (inwardTrip?.get('pilot')?.hasError('invalidPilot')) {
      errors.push('Inward trip: Invalid pilot selected');
    }

    // Check outward trip pilot validation
    const outwardTrip = this.form.get('outwardTrip');
    if (outwardTrip?.get('pilot')?.hasError('invalidPilot')) {
      errors.push('Outward trip: Invalid pilot selected');
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

    return errors;
  }

  /**
   * Navigates back to the previous page without saving.
   * 
   * WHY USE Location.back() instead of Router.navigate()?
   * - Preserves the user's navigation history
   * - Goes back to wherever they came from (could be status list, ships page, etc.)
   * - Provides more intuitive UX than a hardcoded destination
   */
  cancel(): void {
    this.location.back();
  }

  /**
   * TOOLTIP WRAPPER PATTERN for the disabled Save button
   * 
   * WHY THIS IS DIFFERENT FROM NEW-VISIT:
   * - Edit Trip form is more complex (ship + visit + multiple trips)
   * - We already had error collection logic in save()
   * - We extracted that logic into collectFormErrors() for reuse
   * - This makes the code more maintainable and DRY
   * 
   * @returns Tooltip text explaining what's wrong, or success message if valid
   */
  getSaveButtonTooltip(): string {
    // Form is valid - show positive message
    if (this.form.valid && !this.saving()) {
      return 'Save all changes';
    }

    // Currently saving - show status
    if (this.saving()) {
      return 'Saving changes...';
    }

    // Form is invalid - collect and display errors
    const errors = this.collectFormErrors();

    return errors.length > 0 
      ? `Please fix:\n• ${errors.join('\n• ')}`
      : 'Please fix the validation errors highlighted in red';
  }
}
