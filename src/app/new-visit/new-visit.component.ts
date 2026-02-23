import { Component, inject, OnInit, signal, WritableSignal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

// --- Angular Material & Core Imports ---
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule, DateAdapter } from '@angular/material/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { Router, RouterLink } from '@angular/router';

// --- Custom Components ---
import { DateTimePickerComponent } from '../date-time-picker/date-time-picker.component';
import { ViewVisitDialogComponent } from './view-visit-dialog.component';
import { DuplicateShipDialogComponent } from '../dialogs/duplicate-ship-dialog.component';

import { Observable, of, tap } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, startWith } from 'rxjs/operators';

import { VisitWorkflowService } from '../services/workflows/visit-workflow.service';
import { AuthService} from '../auth/auth';
import { Port, Ship, Visit, NewVisitData, Source, AuditablePayload } from '../models';
import { ShipRepository } from '../services/repositories/ship.repository';
import { VisitRepository } from '../services/repositories/visit.repository';
import { UserRepository } from '../services/repositories/user.repository';
import { IFormComponent } from '../guards/form-component.interface';

@Component({
  selector: 'app-new-visit',
  standalone: true,
  imports: [
    // Core
    CommonModule, ReactiveFormsModule, RouterLink, DatePipe,
    // Custom
    DateTimePickerComponent,
    // Material
    MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule, MatDatepickerModule,
    MatNativeDateModule, MatSelectModule, MatProgressSpinnerModule, MatAutocompleteModule, MatSnackBarModule,
    MatTableModule, MatTooltipModule, MatDialogModule,
  ],
  templateUrl: './new-visit.component.html',
  styleUrl: './new-visit.component.css',
})
export class NewVisitComponent implements OnInit, IFormComponent {
  private readonly fb = inject(FormBuilder);
  private readonly visitWorkflowService = inject(VisitWorkflowService);
  private readonly authService = inject(AuthService);
  private readonly shipRepository = inject(ShipRepository);
  private readonly visitRepository = inject(VisitRepository);
  private readonly userRepository = inject(UserRepository);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly adapter = inject(DateAdapter<any>);

  visitForm!: FormGroup;
  isLoading: boolean = false;
  displayedColumns: string[] = ['date', 'port', 'pilot'];
  
  /**
   * Tracks whether the form has been successfully submitted.
   * Prevents unsaved changes warning after successful visit creation.
   */
  private formSubmitted = false;

  readonly ports: Port[] = ['Anchorage', 'Cappa', 'Moneypoint', 'Tarbert', 'Foynes', 'Aughinish', 'Shannon', 'Limerick'];
  readonly sources: Source[] = ['Sheet', 'AIS', 'Good Guess', 'Agent', 'Pilot', 'Other'];
  filteredShips$!: Observable<{ ship: string, gt: number, id: string }[]>;
  readonly minDate = new Date();
  previousVisits: WritableSignal<Visit[]> = signal([]);
  
  /**
   * Tracks the current list of matching ships from autocomplete.
   * Used to determine if we need to show the duplicate warning dialog.
   */
  currentFilteredShips: WritableSignal<{ ship: string; gt: number; id: string }[]> = signal([]);
  
  /**
   * When true, forces creation of a new ship record on submit.
   * Set by the duplicate ship warning dialog when user confirms they want a separate vessel.
   */
  forceNewShip: WritableSignal<boolean> = signal(false);

  constructor() {
    this.adapter.setLocale('en-GB');
  }

  ngOnInit(): void {
    const initialDate = new Date();
    initialDate.setMinutes(0); // Set minutes to 0 for the default time

    this.visitForm = this.fb.group({
      // Ship details
      shipName: ['', Validators.required],
      grossTonnage: [null, [Validators.required, Validators.min(1)]],
      imoNumber: [null],
      marineTrafficLink: [''],
      shipNotes: [''],

      // Visit details
      initialEta: [initialDate, Validators.required],
      berthPort: [null as Port | null, Validators.required],
      visitNotes: [''],
      source: [null, Validators.required],
    });

    // Set up autocomplete observable FIRST (before patching values)
    // Store filtered results in Signal for use by Create New Ship logic
    this.filteredShips$ = this.shipNameControl.valueChanges.pipe(
      startWith(''),
      tap(value => {
        if (typeof value === 'string') {
          this.visitForm.patchValue({
            grossTonnage: null, imoNumber: null, marineTrafficLink: '', shipNotes: ''
          }, { emitEvent: false });
          this.previousVisits.set([]);
          // Reset forceNewShip when user types a new name
          this.forceNewShip.set(false);
        }
      }),
      debounceTime(300),
      distinctUntilChanged(),
      switchMap(value => {
        const searchTerm = typeof value === 'string' ? value : value?.ship;
        if (typeof searchTerm === 'string' && searchTerm.length > 1) {
          return this.shipRepository.getShipSuggestions(searchTerm);
        } else {
          return of([]);
        }
      }),
      // Store the filtered ships for the Create New Ship dialog
      tap(ships => this.currentFilteredShips.set(ships))
    );
    
    // NOW check for router state and pre-fill (AFTER observable is set up)
    // This prevents the startWith('') from clearing our pre-filled values
    const pdfData = window.history.state?.pdfData;
    
    if (pdfData) {
      console.log('Pre-filling form with PDF data:', pdfData);
      
      // Pre-fill form with PDF ship data
      // Use emitEvent: false to prevent valueChanges from clearing the fields
      this.visitForm.patchValue({
        shipName: pdfData.shipName || '',
        grossTonnage: pdfData.grossTonnage || null,
        initialEta: pdfData.eta ? new Date(pdfData.eta) : initialDate,
        berthPort: pdfData.port || null,
        source: 'Sheet' // Default source to 'Sheet' since it came from PDF
      }, { emitEvent: false });
      
      // Mark form as dirty
      this.visitForm.markAsDirty();
      
      // Try to find the ship in database to auto-populate vessel details
      // This will override the PDF GT if ship exists in our system
      if (pdfData.shipName) {
        this.shipRepository.findShipByName(pdfData.shipName).subscribe(ship => {
          if (ship) {
            console.log('Ship found in database, populating full details:', ship);
            this.populateFormWithShipData(ship);
          } else {
            console.log('Ship not in database, using PDF data only');
          }
        });
      }
      
      // Show confirmation message
      this.snackBar.open(`Form pre-filled with data for ${pdfData.shipName}`, 'Dismiss', {
        duration: 4000,
        verticalPosition: 'top'
      });
    }
  }

  get shipNameControl() { return this.visitForm.get('shipName')!; }
  get grossTonnageControl() { return this.visitForm.get('grossTonnage')!; }

  /**
   * Display function for ship autocomplete.
   * Handles both Ship objects from database AND plain strings from PDF pre-fill.
   */
  displayShip(ship: Ship | { ship: string, id: string } | string): string {
    // Handle plain string (from PDF pre-fill)
    if (typeof ship === 'string') {
      return ship;
    }
    // Handle Ship object or suggestion object
    return ship ? (ship as Ship).shipName || (ship as { ship: string }).ship || '' : '';
  }

  onShipSelected(event: MatAutocompleteSelectedEvent): void {
    const selectedSuggestion: { id: string; ship: string } = event.option.value;

    // Check if user selected "Create New Ship" option
    if (selectedSuggestion.id === 'NEW_SHIP') {
      this.handleCreateNewShip(selectedSuggestion.ship);
      return;
    }

    // Normal flow: load existing ship details
    this.forceNewShip.set(false); // Reset flag when selecting existing ship
    this.shipRepository.getShipById(selectedSuggestion.id).subscribe({
      next: (fullShip) => {
        if (fullShip) {
          this.populateFormWithShipData(fullShip);
        }
      },
      error: (err) => {
        console.error("Failed to load full ship details:", err);
        this.snackBar.open('Could not load full ship details.', 'Close', { duration: 3000 });
      }
    });
  }

  /**
   * Handles the "Create New Ship" option from the autocomplete dropdown.
   * 
   * LEARNING: DEFENSIVE UX PATTERN
   * - If matching ships exist, we WARN the user before allowing creation
   * - This prevents accidental duplicates while allowing intentional ones
   * - The warning dialog shows existing matches so user can make an informed choice
   */
  private handleCreateNewShip(shipName: string): void {
    const existingMatches = this.currentFilteredShips();

    if (existingMatches.length > 0) {
      // Show warning dialog - user might be creating a duplicate
      const dialogRef = this.dialog.open(DuplicateShipDialogComponent, {
        data: { existingShips: existingMatches },
        width: '500px'
      });

      dialogRef.afterClosed().subscribe(confirmed => {
        if (confirmed) {
          // User confirmed they want a NEW ship record
          this.forceNewShip.set(true);
          // Set the ship name as a plain string in the form
          this.shipNameControl.setValue(shipName, { emitEvent: false });
          this.snackBar.open('A new ship will be created on submit.', 'OK', {
            duration: 4000,
            panelClass: ['info-snackbar']
          });
        } else {
          // User cancelled - clear the selection so they can choose an existing ship
          this.shipNameControl.setValue('', { emitEvent: false });
        }
      });
    } else {
      // No matches - just create a new ship normally (no warning needed)
      this.shipNameControl.setValue(shipName, { emitEvent: false });
      this.forceNewShip.set(false); // Normal flow will create the ship
    }
  }

  onShipNameBlur(): void {
    const shipNameValue = this.shipNameControl.value;
    if (typeof shipNameValue === 'string' && shipNameValue.trim()) {
      this.shipRepository.findShipByName(shipNameValue).subscribe(ship => {
        if (ship) {
          this.populateFormWithShipData(ship);
        }
      });
    }
  }

  private populateFormWithShipData(ship: Ship): void {
    this.shipNameControl.setValue(ship, { emitEvent: false });

    this.visitForm.patchValue({
      grossTonnage: ship.grossTonnage,
      imoNumber: ship.imoNumber,
      marineTrafficLink: ship.marineTrafficLink,
      shipNotes: ship.shipNotes,
    }, { emitEvent: false });

    if (ship.id) {
      this.visitRepository.getPreviousVisits(ship.id).subscribe({
        next: (visits) => {
          this.previousVisits.set(visits);
          this.checkForActiveVisits(visits);
        },
        error: (err) => {
          console.error("Failed to load previous visits:", err);
          this.previousVisits.set([]);
        }
      });
    }
  }

  private checkForActiveVisits(visits: Visit[]): void {
    const activeStatuses: Visit['currentStatus'][] = ['Due', 'Awaiting Berth', 'Alongside'];
    const hasActiveVisit = visits.some(visit => activeStatuses.includes(visit.currentStatus));

    if (hasActiveVisit) {
      this.snackBar.open('Warning: This ship has an active visit. Creating a new one may be a duplicate.', 'Dismiss', {
        duration: 10000,
        panelClass: ['warn-snackbar'],
        verticalPosition: 'top',
      });
    }
  }

  isVisitActive(visit: Visit): boolean {
    const activeStatuses: Visit['currentStatus'][] = ['Due', 'Awaiting Berth', 'Alongside'];
    return activeStatuses.includes(visit.currentStatus);
  }

  /**
   * View a previous visit in a read-only dialog.
   * Opens dialog to show visit details without losing form data or opening tabs.
   */
  viewVisit(visit: Visit): void {
    if (visit.id) {
      this.dialog.open(ViewVisitDialogComponent, {
        data: { visitId: visit.id },
        width: '800px',
        maxWidth: '95vw',
        maxHeight: '90vh'
      });
    }
  }

  async onSubmit(): Promise<void> {
    if (this.visitForm.invalid) {
      this.visitForm.markAllAsTouched();
      this.snackBar.open('Please correct all validation errors.', 'Close', { duration: 3000 });
      return;
    }

    this.isLoading = true;

    try {
      const formValue = this.visitForm.getRawValue();
      const shipNameValue = formValue.shipName;

      const newVisitData: NewVisitData = {
        shipName: typeof shipNameValue === 'string'
          ? shipNameValue
          : shipNameValue.shipName || (shipNameValue as { ship: string }).ship,
        grossTonnage: formValue.grossTonnage!,
        imoNumber: formValue.imoNumber,
        marineTrafficLink: formValue.marineTrafficLink,
        shipNotes: formValue.shipNotes,

        initialEta: formValue.initialEta,
        berthPort: formValue.berthPort,
        visitNotes: formValue.visitNotes,
        source: formValue.source,
      };

      // Build audit stamp so the Cloud Function can log who created this visit and from where.
      // The Router URL (e.g. '/new-visit') is the canonical route identifier.
      const auditStamp: AuditablePayload = {
        _modifiedBy: this.authService.currentUserSig()?.uid || 'unknown',
        _modifiedFrom: this.router.url,
      };

      // Pass forceNewShip flag to create a separate ship record if user confirmed
      await this.visitWorkflowService.createNewVisit(newVisitData, this.forceNewShip(), auditStamp);
      
      // Mark form as submitted to prevent unsaved changes warning
      this.formSubmitted = true;

      this.snackBar.open('New visit and initial trip successfully created!', 'Dismiss', {
        duration: 5000,
        verticalPosition: 'top',
        horizontalPosition: 'end',
      });

      await this.router.navigate(['/']);
    } catch (error: any) {
      console.error('Visit creation failed:', error);
      this.snackBar.open(`Error creating visit: ${error.message || 'An unexpected error occurred.'}`, 'Close', {
        duration: 7000,
      });
    } finally {
      this.isLoading = false;
    }
  }
  
  /**
   * Implementation of IFormComponent interface.
   * Called by the CanDeactivate guard before navigation.
   * 
   * @returns true if safe to navigate (no unsaved changes), false otherwise
   */
  canDeactivate(): boolean {
    return this.visitForm.pristine || this.formSubmitted;
  }

  /**
   * WHY THIS METHOD EXISTS:
   * - Disabled buttons don't receive mouse events, so matTooltip won't work on them
   * - We need to wrap the button and put the tooltip on the wrapper
   * - This method generates user-friendly error messages for the tooltip
   * 
   * LEARNING: ACCESSIBILITY + UX PATTERN
   * - Users deserve to know WHY they can't submit
   * - Instead of just a disabled button, we guide them to fix the issues
   * - This reduces frustration and improves form completion rates
   * 
   * @returns Tooltip text explaining form errors, or empty string if form is valid
   */
  getFormErrorTooltip(): string {
    if (this.visitForm.valid) {
      return 'Create a new visit';
    }

    const errors: string[] = [];

    // Check ship name
    if (this.shipNameControl.hasError('required')) {
      errors.push('Ship name is required');
    }

    // Check gross tonnage
    if (this.grossTonnageControl.hasError('required')) {
      errors.push('Gross tonnage is required');
    } else if (this.grossTonnageControl.hasError('min')) {
      errors.push('Gross tonnage must be at least 1');
    }

    // Check initial ETA
    const etaControl = this.visitForm.get('initialEta');
    if (etaControl?.hasError('required')) {
      errors.push('Initial ETA is required');
    }

    // Check berth port
    const berthPortControl = this.visitForm.get('berthPort');
    if (berthPortControl?.hasError('required')) {
      errors.push('Destination port is required');
    }

    // Check source
    const sourceControl = this.visitForm.get('source');
    if (sourceControl?.hasError('required')) {
      errors.push('Source is required');
    }

    // Return formatted error message
    return errors.length > 0 
      ? `Please fix:\n• ${errors.join('\n• ')}`
      : 'Please complete all required fields';
  }
}
