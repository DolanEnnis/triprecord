import { Component, inject, Inject, OnInit, Optional, signal, computed, ViewChild } from '@angular/core';
import { DocketUploadComponent } from '../docket-upload/docket-upload.component';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators, ValidatorFn, AbstractControl, ValidationErrors } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { DataService } from '../services/core/data.service';
import { AuthService } from '../auth/auth';
import { PilotService } from '../services/state/pilot.service';
import { Charge, ChargeableEvent } from '../models';
import { Port, TripType } from '../models';
import { CommonModule } from '@angular/common';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { DateAdapter, MatNativeDateModule } from '@angular/material/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Observable, of, firstValueFrom } from 'rxjs';
import { debounceTime, distinctUntilChanged, startWith, switchMap } from 'rxjs/operators';
import { ConfirmationDialogComponent } from '../shared/confirmation-dialog/confirmation-dialog.component';

/**
 * A factory function that returns a ValidatorFn for the pilot field.
 *
 * LEARNING: CUSTOM VALIDATORS AS FACTORY FUNCTIONS
 * Because we need access to `PilotService` inside the validator, we use a
 * "factory" pattern — a function that *returns* a ValidatorFn. This lets us
 * close over the service instance rather than relying on dependency injection
 * inside a plain function (which Angular's DI doesn't support for standalone
 * validator functions).
 */
function pilotValidator(pilotService: PilotService): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value;

    // An empty pilot field is handled by Validators.required separately.
    if (!value || value.trim() === '') {
      return null;
    }

    // Delegate the "is this a real pilot?" check to the PilotService.
    if (!pilotService.isPilotValid(value)) {
      return { invalidPilot: { value } };
    }
    return null;
  };
}

/**
 * Discriminated union type that describes every possible way this dialog can be opened.
 *
 * LEARNING: DISCRIMINATED UNIONS
 * Instead of using a single object with lots of optional fields, we define a
 * union of distinct shapes. TypeScript can then *narrow* the type inside an
 * `if ('mode' in dialogData)` check, giving us full type safety without casts.
 *
 * - `fromVisit` — opened from the Status List to confirm an existing visit event.
 * - `editCharge` — opened to edit an already-confirmed charge record.
 * - `{ activeShips }` — opened as a blank "New Trip" form (no mode property).
 * - `null` — opened with no context at all (treated the same as 'new').
 */
export type ChargeDialogData =
  | { mode: 'fromVisit', event: ChargeableEvent }
  | { mode: 'editCharge', charge: Charge }
  | { activeShips?: string[] }
  | null;

/**
 * Dialog component for creating or editing a pilot charge / trip record.
 *
 * This single component handles three distinct modes, determined by the data
 * passed via MAT_DIALOG_DATA:
 *
 *  - **'new'**        — A blank form; saves a brand-new standalone Visit + Trip.
 *  - **'fromVisit'**  — Pre-filled from an existing unconfirmed visit event;
 *                       confirms the trip and creates the billing Charge.
 *  - **'editCharge'** — Pre-filled from a confirmed Charge; updates that record.
 */
@Component({
  selector: 'app-create-charge-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatProgressSpinnerModule,
    MatAutocompleteModule,
    MatSnackBarModule,
    MatSelectModule,
    MatTooltipModule,
    MatIconModule,
    DocketUploadComponent,
  ],
  templateUrl: './create-charge-dialog.html',
  styleUrl: './create-charge-dialog.css',
})
export class CreateChargeDialogComponent implements OnInit {
  // --- Dependencies (injected via inject() — the modern Angular alternative to constructor injection) ---
  private readonly fb = inject(FormBuilder);
  private readonly dataService = inject(DataService);
  private readonly authService = inject(AuthService);
  /** Public so the template can call pilotService.pilotNames() directly in the autocomplete. */
  pilotService = inject(PilotService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialogRef = inject(MatDialogRef<CreateChargeDialogComponent>);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);

  // --- Dialog mode & context ---
  readonly mode: 'fromVisit' | 'editCharge' | 'new';
  /** The visit event being confirmed (only set in 'fromVisit' mode). */
  private readonly eventToProcess: ChargeableEvent | null = null;
  /** The existing charge being edited (only set in 'editCharge' mode). Protected so the template can read it. */
  protected readonly chargeToEdit: Charge | null = null;
  /** Ships currently active on the status list, used to warn the user about duplicates in 'new' mode. */
  private readonly activeShips: string[] = [];
  readonly title: string;

  // --- UI state ---
  isSaving = false;

  /**
   * True while the DocketUploadComponent is uploading a file.
   * We must disable the Save button during this window — if the pilot
   * hits Save before the upload resolves, the docket URL won't be included
   * in the Firestore payload (broken link in the database).
   */
  isDocketUploading = false;

  // --- Docket state (populated by DocketUploadComponent on successful upload) ---
  private pendingDocketUrl: string | undefined;
  private pendingDocketPath: string | undefined;
  private pendingDocketType: 'image' | 'pdf' | undefined;

  /**
   * Provides the tripId to <app-docket-upload>.
   * - In 'fromVisit' mode: the existing tripId from the visit event.
   * - In 'editCharge' mode: the charge/trip document ID.
   * - In 'new' mode: we don't have a tripId yet (set post-save); docket upload is hidden.
   */
  get docketTripId(): string | null {
    return this.eventToProcess?.tripId ?? this.chargeToEdit?.id ?? null;
  }
  /** Observable of ship name suggestions, driven by the 'ship' form control's value changes. */
  filteredShips$!: Observable<{ ship: string, gt: number }[]>;

  /** Prevents the user from picking a future date as a boarding date. */
  readonly maxDate = new Date();

  // Static lookup arrays used by the template's <mat-select> dropdowns.
  readonly tripTypes: TripType[] = ['In', 'Out', 'Anchorage', 'Shift', 'BerthToBerth', 'Other'];
  readonly ports: Port[] = ['Anchorage', 'Cappa', 'Moneypoint', 'Tarbert', 'Foynes', 'Aughinish', 'Shannon', 'Limerick'];

  // --- Pilot autocomplete (using Signals) ---
  /**
   * LEARNING: SIGNALS FOR LOCAL UI STATE
   * `pilotFilter` is a writable Signal updated whenever the user types in the
   * pilot field. `filteredPilots` is a computed Signal that automatically
   * re-derives its value whenever `pilotFilter` changes — no manual subscription
   * or `async` pipe needed.
   */
  pilotFilter = signal<string>('');
  filteredPilots = computed(() => {
    const filterValue = this.pilotFilter().toLowerCase();
    const pilots = this.pilotService.pilotNames();

    // When the field is empty, show every pilot (plus the Unassigned option).
    if (!filterValue) {
      return ['Unassigned', ...pilots];
    }

    // Otherwise, filter to only names containing the typed substring.
    const filtered = pilots.filter(name => name.toLowerCase().includes(filterValue));
    return ['Unassigned', ...filtered];
  });

  /**
   * The reactive form is defined here (rather than in ngOnInit) so that it is
   * available immediately — the constructor needs it to be ready before we
   * patch values based on the dialog data.
   *
   * LEARNING: NULL DEFAULT FOR DATE FIELDS
   * The `boarding` field defaults to `null` rather than `new Date()`. This
   * forces the user to consciously choose a date, preventing accidental charges
   * being filed against today's date.
   */
  readonly form: FormGroup = this.fb.group({
    ship: ['', Validators.required],
    gt: [null as number | null, Validators.required],
    boarding: [null as Date | null, Validators.required],
    port: [null as Port | null, Validators.required],
    pilot: ['', [Validators.required, pilotValidator(this.pilotService)]],
    typeTrip: ['', Validators.required],
    sailingNote: [''],
    extra: [''],
  });

  constructor(
    @Optional() @Inject(MAT_DIALOG_DATA) readonly dialogData: ChargeDialogData,
    private _adapter: DateAdapter<any>
  ) {
    // Determine which mode we are operating in based on the shape of dialogData.
    if (dialogData && 'mode' in dialogData) {
      this.mode = dialogData.mode;

      if (this.mode === 'fromVisit') {
        this.eventToProcess = (dialogData as { mode: 'fromVisit', event: ChargeableEvent }).event;
        this.title = `Create Charge for ${this.eventToProcess.ship}`;
      } else {
        // 'editCharge' mode — load the existing charge record.
        this.chargeToEdit = (dialogData as { mode: 'editCharge', charge: Charge }).charge;
        this.title = `Edit Charge for ${this.chargeToEdit?.ship}`;
      }
    } else {
      // No 'mode' key means this is a blank "New Trip" dialog.
      this.mode = 'new';
      this.title = 'New Trip';

      // The parent may pass a list of currently active ships so we can warn
      // the user if they try to create a duplicate In/Out movement.
      if (dialogData && 'activeShips' in dialogData) {
        this.activeShips = dialogData.activeShips || [];
      }
    }

    // Use British English locale so the datepicker displays as dd/MM/yyyy.
    this._adapter.setLocale('en-GB');
  }

  ngOnInit(): void {
    const currentUser = this.authService.currentUserSig();

    // Pre-fill the form from either the charge being edited or the visit event.
    // The spread operator copies all matching field names automatically.
    const initialData = this.chargeToEdit || this.eventToProcess;
    this.form.patchValue({
      ...initialData,
      // Default the pilot to the logged-in user if no pilot is already set.
      pilot: initialData?.pilot || currentUser?.displayName || '',
    });

    /**
     * LEARNING: REACTIVE SHIP AUTOCOMPLETE WITH switchMap
     *
     * We listen to value changes on the 'ship' control and pipe them through:
     *  - startWith('')     → emits immediately so the autocomplete initialises.
     *  - debounceTime(300) → waits 300 ms of inactivity before firing a query,
     *                        avoiding a Firestore read on every keystroke.
     *  - distinctUntilChanged() → skips the query if the value hasn't changed
     *                             (e.g. user tabs away and back).
     *  - switchMap         → cancels any in-flight request if a new value arrives,
     *                        ensuring we never display stale results.
     */
    this.filteredShips$ = this.form.get('ship')!.valueChanges.pipe(
      startWith(''),
      debounceTime(300),
      distinctUntilChanged(),
      switchMap(value => {
        // The form value could be a plain string (typed) or an object (after selection).
        const searchTerm = typeof value === 'string' ? value : value?.ship;

        // Only query once the user has typed at least 2 characters.
        if (typeof searchTerm === 'string' && searchTerm.length > 1) {
          return this.dataService.getShipSuggestions(searchTerm);
        } else {
          return of([]);
        }
      })
    );
  }

  /**
   * Called on every keystroke in the pilot autocomplete input.
   * Updates the `pilotFilter` Signal, which triggers `filteredPilots` to recompute.
   */
  onPilotInput(value: string): void {
    this.pilotFilter.set(value);
  }

  /**
   * Main save handler. Guards against invalid forms and duplicate submissions,
   * then delegates to the appropriate private method based on the current mode.
   */
  async onSave(): Promise<void> {
    // Block save if form is invalid, already saving, OR if docket is still uploading
    if (this.form.invalid || this.isSaving || this.isDocketUploading) {
      return;
    }

    // In 'new' mode, warn the user if they are creating an In/Out movement for
    // a ship that already has active trips (potential duplicate entry).
    if (this.mode === 'new') {
      const formValue = this.form.value;
      const shipName = (formValue.ship || '').trim();
      const typeTrip = formValue.typeTrip;

      // Normalise both sides to lowercase for a case-insensitive comparison.
      const normalizedShipName = shipName.toLowerCase();
      const normalizedActiveShips = this.activeShips.map(s => s.trim().toLowerCase());

      if ((typeTrip === 'In' || typeTrip === 'Out') && normalizedActiveShips.includes(normalizedShipName)) {
        const confirmDialogRef = this.dialog.open(ConfirmationDialogComponent, {
          data: {
            title: 'Active Ship Warning',
            message: `The ship '${shipName}' already has active trips. Are you sure you want to create a NEW '${typeTrip}' trip instead of using the existing one?`,
            confirmText: 'Create Anyway',
            cancelText: 'Cancel'
          }
        });

        // firstValueFrom converts the Observable into a Promise, so we can
        // use await rather than nesting inside a subscribe callback.
        const confirmed = await firstValueFrom(confirmDialogRef.afterClosed());
        if (!confirmed) {
          return;
        }
      }
    }

    this.isSaving = true;

    // Route to the correct save path for each mode.
    if (this.mode === 'editCharge') {
      await this.updateExistingCharge();
    } else if (this.mode === 'fromVisit') {
      await this.saveChargeFromVisit();
    } else {
      await this.saveStandaloneCharge();
    }
  }

  /**
   * Shows a non-blocking snack bar warning when a duplicate charge is detected.
   * The user can dismiss it OR choose to save anyway via the action button.
   *
   * LEARNING: NON-MODAL CONFIRMATION WITH SNACK BAR
   * For low-stakes warnings we prefer a snack bar over a full dialog — it is
   * less disruptive. We subscribe to `onAction()` to know if "Add Anyway" was
   * clicked, and `afterDismissed()` to reset `isSaving` if it was auto-dismissed.
   */
  private warnAndSave(): void {
    const snackBarRef = this.snackBar.open(
      'A similar charge for this ship on this day already exists.',
      'Add Anyway',
      { duration: 7000 }
    );

    // User clicked "Add Anyway" — proceed with the save.
    snackBarRef.onAction().subscribe(() => {
      this.saveStandaloneCharge();
    });

    // Snack bar timed out without action — re-enable the Save button.
    snackBarRef.afterDismissed().subscribe(({ dismissedByAction }) => {
      if (!dismissedByAction) {
        this.isSaving = false;
      }
    });
  }

  /**
   * Called by <app-docket-upload> when a file has been successfully uploaded.
   * We store the result here so it can be merged into the Firestore payload when
   * the pilot finally clicks "Save Charge".
   *
   * LEARNING: PARENT-CHILD COMMUNICATION PATTERN
   * The child component (DocketUploadComponent) emits an output event.
   * The parent stores the value in a private field and passes it to the
   * DataService. This keeps the upload logic fully encapsulated in the child.
   */
  onDocketUploaded(result: { docketUrl: string; docketPath: string; docketType: 'image' | 'pdf' }): void {
    this.pendingDocketUrl  = result.docketUrl;
    this.pendingDocketPath = result.docketPath;
    this.pendingDocketType = result.docketType;
  }

  /** Syncs the isDocketUploading flag with the child component's output event. */
  onDocketUploadingChange(uploading: boolean): void {
    this.isDocketUploading = uploading;
  }

  /**
   * Creates a brand-new Visit and Trip document in Firestore from the form data.
   * Used in 'new' mode (standalone charge, not linked to an existing visit event).
   */
  private async saveStandaloneCharge(): Promise<void> {
    try {
      await this.dataService.createStandaloneCharge(this.form.value);
      this.dialogRef.close('success');
    } catch (error: any) {
      console.error('Error creating standalone charge:', error);
      this.snackBar.open(`Error: ${error.message || 'Could not create trip.'}`, 'Close', { duration: 7000 });
      this.isSaving = false;
    }
  }

  /**
   * Confirms an existing visit event and creates the billing Charge record.
   * Used in 'fromVisit' mode — the tripId and visitId must already exist.
   *
   * ATOMIC GUARANTEE: The docket upload completes BEFORE onSave() is called
   * (Save is disabled during upload). We include pendingDocketUrl in the same
   * updateTrip call so there is never a moment where the Trip doc exists
   * without the correct docketUrl — no partial writes.
   */
  private async saveChargeFromVisit(): Promise<void> {
    try {
      // Both IDs are required; old records from before the visitId field was
      // introduced may lack one, so we fail early with a descriptive message.
      if (!this.eventToProcess?.tripId || !this.eventToProcess?.visitId) {
        throw new Error('Cannot save charge: Trip or Visit ID is missing. This might be an old record.');
      }

      // Build docket payload (only included if a file was uploaded)
      const docketPayload = this.pendingDocketUrl ? {
        docketUrl:  this.pendingDocketUrl,
        docketPath: this.pendingDocketPath,
        docketType: this.pendingDocketType,
      } : {};

      await this.dataService.confirmTripAndCreateCharge(
        { ...this.form.value, ...docketPayload },
        this.eventToProcess.tripId,
        this.eventToProcess.visitId
      );
      this.dialogRef.close('success');
    } catch (error: any) {
      console.error('Error creating charge from visit:', error);
      this.snackBar.open(`Error: ${error.message || 'Could not create trip from visit.'}`, 'Close', { duration: 7000 });
      this.isSaving = false;
    }
  }

  /**
   * Persists changes to an existing Charge document.
   * Also calls `ensureShipDetails` to propagate any GT / name corrections,
   * but skips already-confirmed trips to protect billing history.
   */
  private async updateExistingCharge(): Promise<void> {
    try {
      const { ship, gt } = this.form.value;

      if (ship && gt) {
        // Sync the ship's GT and name across all unconfirmed trips.
        // Returns a syncResult describing how many records were (or were not) updated.
        const { syncResult } = await this.dataService.ensureShipDetails(ship, gt);

        if (syncResult && syncResult.skippedConfirmedCount > 0) {
          // Inform the user that some confirmed trips were intentionally left
          // untouched — changing them would invalidate existing invoices.
          this.snackBar.open(
            `Ship details updated. Note: ${syncResult.skippedConfirmedCount} confirmed trips were NOT updated to preserve billing history.`,
            'Got it',
            { duration: 8000 }
          );
        }
      }

      // Merge docket fields into the update payload if a new file was uploaded
      const docketPayload = this.pendingDocketUrl ? {
        docketUrl:  this.pendingDocketUrl,
        docketPath: this.pendingDocketPath,
        docketType: this.pendingDocketType,
      } : {};

      await this.dataService.updateCharge(this.chargeToEdit!.id!, { ...this.form.value, ...docketPayload });
      this.dialogRef.close('success');
    } catch (error: any) {
      console.error('Error updating charge:', error);
      this.snackBar.open(`Error: ${error.message || 'Could not update trip.'}`, 'Close', { duration: 7000 });
      this.isSaving = false;
    }
  }

  /** Closes the dialog without saving anything. */
  onCancel(): void {
    this.dialogRef.close();
  }

  /**
   * Display function for the ship autocomplete (`[displayWith]` binding).
   *
   * LEARNING: HANDLING MIXED VALUE TYPES IN AUTOCOMPLETE
   * Angular Material's autocomplete stores whatever value you bind to
   * `[value]` on each option (here: a full `{ ship, gt }` object). But the
   * same input also receives plain strings when the form is pre-filled from
   * saved data. `displayWith` must gracefully handle both cases so the input
   * always shows a readable ship name — never "[object Object]".
   *
   * @param ship - Either a plain string (pre-filled) or a `{ ship, gt }` object (autocomplete selection).
   * @returns The ship name to display in the text input.
   */
  displayShip(ship: string | { ship: string, gt: number }): string {
    if (typeof ship === 'string') {
      return ship;
    }
    return ship?.ship || '';
  }

  /**
   * Called when the user selects a suggestion from the ship autocomplete dropdown.
   * Splits the selected object back into separate `ship` and `gt` form fields,
   * because the form submission expects them as individual scalar values.
   */
  onShipSelected(event: MatAutocompleteSelectedEvent): void {
    const selectedShip: { ship: string, gt: number } = event.option.value;

    // patch() rather than setValue() so unrelated fields are left unchanged.
    this.form.patchValue({
      ship: selectedShip.ship,
      gt: selectedShip.gt
    });
  }

  /**
   * Navigates the user to the full Edit Visit page for the charge being edited.
   * Opens a confirmation dialog first because editing a confirmed trip may
   * affect billing records.
   */
  async onEditVisit(): Promise<void> {
    if (!this.chargeToEdit?.visitId) {
      this.snackBar.open('Error: No Visit ID found for this trip.', 'Close', { duration: 5000 });
      return;
    }

    const confirmDialogRef = this.dialog.open(ConfirmationDialogComponent, {
      data: {
        title: 'Edit Confirmed Trip?',
        message: 'You are about to edit a CONFIRMED trip. Any changes may affect billing. Are you sure you want to proceed?',
        confirmText: 'Yes, Edit',
        cancelText: 'Cancel'
      }
    });

    confirmDialogRef.afterClosed().subscribe(confirmed => {
      if (confirmed) {
        // Close this dialog before navigating so it doesn't linger in the background.
        this.dialogRef.close();
        this.router.navigate(['/edit', this.chargeToEdit!.visitId]);
      }
    });
  }

  /**
   * Builds the tooltip text for the Save button.
   *
   * LEARNING: TOOLTIP ON A DISABLED BUTTON
   * Disabled buttons swallow mouse events, so Angular Material tooltips won't
   * fire on the button element itself. The pattern is to wrap the button in a
   * `<span>` or `<div>` and attach the tooltip there instead. This method
   * provides the dynamic text for that wrapper tooltip.
   *
   * @returns A human-readable message describing why Save is unavailable,
   *          or a positive label when the form is ready to submit.
   */
  getSaveButtonTooltip(): string {
    if (this.isDocketUploading) {
      return 'Please wait for the docket to finish uploading...';
    }

    if (this.form.valid && !this.isSaving) {
      return this.mode === 'editCharge' ? 'Update charge' : 'Save charge';
    }

    if (this.isSaving) {
      return 'Saving...';
    }

    // Build a list of every validation error so the user knows exactly what to fix.
    const errors: string[] = [];

    if (this.form.get('ship')?.hasError('required')) {
      errors.push('Ship is required');
    }
    if (this.form.get('gt')?.hasError('required')) {
      errors.push('Gross tonnage is required');
    }
    if (this.form.get('boarding')?.hasError('required')) {
      errors.push('Boarding date is required');
    }
    if (this.form.get('port')?.hasError('required')) {
      errors.push('Port is required');
    }
    if (this.form.get('pilot')?.hasError('required')) {
      errors.push('Pilot is required');
    } else if (this.form.get('pilot')?.hasError('invalidPilot')) {
      errors.push('Please select a valid pilot from the list');
    }
    if (this.form.get('typeTrip')?.hasError('required')) {
      errors.push('Trip type is required');
    }

    return errors.length > 0
      ? `Please fix:\n• ${errors.join('\n• ')}`
      : 'Please fix the validation errors';
  }
}
