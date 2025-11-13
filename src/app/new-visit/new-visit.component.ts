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
import { MatDivider } from '@angular/material/divider';
import { MatTableModule } from '@angular/material/table';
import { Router, RouterLink } from '@angular/router';

// --- Custom Components ---
import { DateTimePickerComponent } from '../date-time-picker/date-time-picker.component';

import { Observable, of, tap } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, startWith } from 'rxjs/operators';

import { VisitWorkflowService } from '../services/visit-workflow.service';
import { AuthService} from '../auth/auth';
import { Port, Ship, Visit, NewVisitData, Source } from '../models/data.model';
import { ShipRepository } from '../services/ship.repository';
import { VisitRepository } from '../services/visit.repository';
import { PilotUser, UserRepository } from '../services/user.repository';

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
    MatNativeDateModule, MatSelectModule, MatProgressSpinnerModule, MatAutocompleteModule, MatSnackBarModule, MatDivider,
    MatTableModule,
  ],
  templateUrl: './new-visit.component.html',
  styleUrl: './new-visit.component.css',
})
export class NewVisitComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly visitWorkflowService = inject(VisitWorkflowService);
  private readonly authService = inject(AuthService);
  private readonly shipRepository = inject(ShipRepository);
  private readonly visitRepository = inject(VisitRepository);
  private readonly userRepository = inject(UserRepository);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly adapter = inject(DateAdapter<any>);

  visitForm!: FormGroup;
  isLoading: boolean = false;
  displayedColumns: string[] = ['date', 'port', 'pilot'];
  pilots$!: Observable<PilotUser[]>;

  readonly ports: Port[] = ['Anchorage', 'Cappa', 'Moneypoint', 'Tarbert', 'Foynes', 'Aughinish', 'Shannon', 'Limerick'];
  readonly sources: Source[] = ['Sheet', 'AIS', 'Good Guess', 'Agent', 'Pilot', 'Other'];
  filteredShips$!: Observable<{ ship: string, gt: number, id: string }[]>;
  readonly minDate = new Date();
  previousVisits: WritableSignal<Visit[]> = signal([]);

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

      // Trip detail
      pilot: [null],
    });

    this.pilots$ = this.userRepository.getPilots();

    this.filteredShips$ = this.shipNameControl.valueChanges.pipe(
      startWith(''),
      tap(value => {
        if (typeof value === 'string') {
          this.visitForm.patchValue({
            grossTonnage: null, imoNumber: null, marineTrafficLink: '', shipNotes: ''
          }, { emitEvent: false });
          this.previousVisits.set([]);
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
      })
    );
  }

  get shipNameControl() { return this.visitForm.get('shipName')!; }
  get grossTonnageControl() { return this.visitForm.get('grossTonnage')!; }

  displayShip(ship: Ship | { ship: string, id: string }): string {
    return ship ? (ship as Ship).shipName || (ship as { ship: string }).ship || '' : '';
  }

  onShipSelected(event: MatAutocompleteSelectedEvent): void {
    const selectedSuggestion: { id: string } = event.option.value;

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
    this.shipNameControl.setValue(ship.shipName, { emitEvent: false });

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

        pilot: formValue.pilot,
      };

      await this.visitWorkflowService.createNewVisit(newVisitData);

      this.snackBar.open('New visit and initial trip successfully created!', 'Dismiss', {
        duration: 5000,
        verticalPosition: 'top',
        horizontalPosition: 'end',
      });

      await this.router.navigate(['/trip-confirmation']);
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
