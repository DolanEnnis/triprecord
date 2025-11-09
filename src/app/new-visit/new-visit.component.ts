import { Component, inject, OnInit, signal, WritableSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatSelectModule } from '@angular/material/select';
import { MatNativeDateModule, DateAdapter } from '@angular/material/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Router, RouterLink } from '@angular/router';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { Observable, of } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, startWith } from 'rxjs/operators';

import { VisitWorkflowService } from '../services/visit-workflow.service';
import { AuthService } from '../auth/auth';
import { Port, Visit } from '../models/data.model';
import { ShipRepository } from '../services/ship.repository';
import { VisitRepository } from '../services/visit.repository';
import {MatDivider} from '@angular/material/divider';

@Component({
  selector: 'app-new-visit',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    MatAutocompleteModule,
    MatSnackBarModule,
    MatDivider
  ],
  templateUrl: './new-visit.component.html',
  styleUrl: './new-visit.component.css',
})
/**
 * NewVisitComponent provides a form for creating a new ship visit.
 * It orchestrates the creation of a master Ship record, a Visit record, and an initial 'In' Trip record.
 */
export class NewVisitComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly visitWorkflowService = inject(VisitWorkflowService);
  private readonly authService = inject(AuthService);
  private readonly shipRepository = inject(ShipRepository);
  private readonly visitRepository = inject(VisitRepository);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly adapter = inject(DateAdapter<any>);

  visitForm!: FormGroup;
  isLoading: boolean = false;

  // --- Component Data & Configuration ---
  readonly ports: Port[] = ['Anchorage', 'Cappa', 'Moneypoint', 'Tarbert', 'Foynes', 'Aughinish', 'Shannon', 'Limerick'];
  /** Observable stream for the ship name autocomplete suggestions. */
  filteredShips$!: Observable<{ ship: string, gt: number, id: string }[]>;
  /** The earliest date selectable in the ETA date picker (today). */
  readonly minDate = new Date();

  /** A signal to hold the list of previous visits for a selected ship, used to provide context to the user. */
  previousVisits: WritableSignal<Visit[]> = signal([]);

  constructor() {
    // Set date adapter locale for consistent date formatting (e.g., dd/mm/yyyy).
    this.adapter.setLocale('en-GB');
  }

  ngOnInit(): void {
    const userDisplayName = this.authService.currentUserSig()?.displayName || 'Unknown';

    this.visitForm = this.fb.group({
      // Ship details (Used by ShipRepository.findOrCreateShip)
      shipName: ['', Validators.required],
      grossTonnage: [null, [Validators.required, Validators.min(1)]],
      imoNumber: [null],
      marineTrafficLink: [''],
      shipNotes: [''],

      // Visit details (Used by VisitWorkflowService.createNewVisit)
      initialEta: [new Date(), Validators.required],
      berthPort: [null as Port | null, Validators.required],
      visitNotes: [''],

      // Trip detail (Used for initial 'In' Trip in /trips)
      pilot: [userDisplayName, Validators.required],
    });

    // Set up the reactive stream for the ship name autocomplete.
    // This listens to value changes, debounces input, and fetches suggestions from the repository.
    this.filteredShips$ = this.shipNameControl.valueChanges.pipe(
      startWith(''),
      debounceTime(300),
      distinctUntilChanged(),
      switchMap(value => {
        // The autocomplete can emit a string (user typing) or an object (selection made).
        const searchTerm = typeof value === 'string' ? value : value?.ship;
        if (typeof searchTerm === 'string' && searchTerm.length > 1) {
          // Fetch suggestions only when the search term is long enough.
          return this.shipRepository.getShipSuggestions(searchTerm);
        } else {
          // If the search term is cleared or too short, clear previous visits and return no suggestions.
          this.previousVisits.set([]); // Clear the context view.
          return of([]);
        }
      })
    );
  }

  get shipNameControl() { return this.visitForm.get('shipName')!; }
  get grossTonnageControl() { return this.visitForm.get('grossTonnage')!; }

  /**
   * Function used by the MatAutocomplete to display the ship name in the input field
   * after an option has been selected.
   * @param ship The selected ship object.
   * @returns The ship's name.
   */
  displayShip(ship: { ship: string, gt: number, id: string }): string {
    return ship?.ship || '';
  }

  /**
   * Triggered when a user selects a ship from the autocomplete list.
   * It patches the form with the ship's data and fetches its visit history.
   * @param event The selection event from MatAutocomplete.
   */
  onShipSelected(event: MatAutocompleteSelectedEvent): void {
    const selectedSuggestion: { id: string } = event.option.value;

    // 1. Fetch the full ship details using the ID from the suggestion.
    this.shipRepository.getShipById(selectedSuggestion.id).subscribe({
      next: (fullShip) => {
        if (fullShip) {
          // 2. Autopopulate the form with all known ship details.
          // We do NOT patch 'shipName' here because the autocomplete has already set it to the full object.
          // Patching it with a string would break the displayWith functionality.
          this.visitForm.patchValue({
            grossTonnage: fullShip.grossTonnage,
            imoNumber: fullShip.imoNumber,
            marineTrafficLink: fullShip.marineTrafficLink,
            shipNotes: fullShip.shipNotes,
          });
        }
      },
      error: (err) => {
        console.error("Failed to load full ship details:", err);
        this.snackBar.open('Could not load full ship details.', 'Close', { duration: 3000 });
      }
    });

    // 3. Fetch the ship's visit history.
    this.visitRepository.getPreviousVisits(selectedSuggestion.id).subscribe({
      next: (visits) => this.previousVisits.set(visits),
      error: (err) => {
        console.error("Failed to load previous visits:", err);
        this.previousVisits.set([]);
      }
    });
  }

  /**
   * Handles the form submission. Validates the form, then calls the workflow service to create the visit.
   */
  async onSubmit(): Promise<void> {
    if (this.visitForm.invalid) {
      this.visitForm.markAllAsTouched();
      this.snackBar.open('Please correct all validation errors.', 'Close', { duration: 3000 });
      return;
    }

    this.isLoading = true;

    try {
      // The form's value is structured to match the NewVisitData DTO.
      const newVisitData = this.visitForm.value;

      await this.visitWorkflowService.createNewVisit(newVisitData);

      this.snackBar.open('New visit and initial trip successfully created!', 'Dismiss', {
        duration: 5000,
        verticalPosition: 'top',
        horizontalPosition: 'end',
      });

      // Navigate to the main trip confirmation page to see the new unconfirmed trip
      this.router.navigate(['/trip-confirmation']);
    } catch (error: any) {
      console.error('Visit creation failed:', error);
      this.snackBar.open(`Error creating visit: ${error.message || 'An unexpected error occurred.'}`, 'Close', {
        duration: 7000,
      });
    } finally {
      this.isLoading = false;
    }
  }

}
