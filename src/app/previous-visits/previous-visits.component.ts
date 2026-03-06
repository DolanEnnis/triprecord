import { Component, OnInit, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatRadioModule } from '@angular/material/radio';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterModule } from '@angular/router';
import { PreviousVisitsListComponent } from './previous-visits-list/previous-visits-list.component';
import { VisitRepository } from '../services/repositories/visit.repository';
import { Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { EnrichedVisit } from '../models';
import { AuthService } from '../auth/auth';

@Component({
  selector: 'app-previous-visits',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatInputModule,
    MatFormFieldModule,
    MatButtonModule,
    MatIconModule,
    MatRadioModule,
    MatProgressSpinnerModule,
    RouterModule,
    PreviousVisitsListComponent
  ],
  templateUrl: './previous-visits.component.html',
  styleUrls: ['./previous-visits.component.css']
})
export class PreviousVisitsComponent implements OnInit {
  private readonly visitRepository = inject(VisitRepository);
  private readonly authService = inject(AuthService);

  visits$!: Observable<EnrichedVisit[]>;
  filterValue = '';
  highlightMode: '2' | '3' = '3';

  // LEARNING: COMPUTED SIGNAL FOR DERIVED STATE
  // Instead of hardcoding 'inward', we derive the default sort from the pilot's division.
  // `computed()` re-evaluates whenever `currentUserSig()` changes — so if the profile
  // loads asynchronously after the component is created, this will update automatically.
  readonly defaultSortOrder = computed<'inward' | 'sailing'>(() => {
    const user = this.authService.currentUserSig();
    // Only pilots have a meaningful division. For all other roles, default to 'inward'.
    if (user?.userType === 'pilot' && user.division === 'Out') {
      return 'sailing';
    }
    return 'inward';
  });

  // Initialised to 'inward' but immediately overridden in ngOnInit once the user profile
  // is available — ensures the radio button group always reflects the computed value.
  sortOrder: 'inward' | 'sailing' = 'inward';
  
  dateRangeForm = new FormGroup({
    startDate: new FormControl<Date | null>(null),
    endDate: new FormControl<Date | null>(null)
  });

  ngOnInit() {
    // LEARNING: WHY WE SET sortOrder IN ngOnInit AND NOT IN THE DECLARATION
    // The `defaultSortOrder` Signal reads from `authService.currentUserSig()`, which
    // is populated asynchronously after the Firebase Auth state resolves.
    // By reading it in ngOnInit (one microtask after construction), the profile
    // is almost always already loaded for returning users (it's cached by Auth).
    // The `computed` Signal also keeps it in sync if the profile arrives later.
    this.sortOrder = this.defaultSortOrder();
    this.loadDefaultRange();
  }

  loadDefaultRange() {
    // Go 2 months back AND 2 months forward from today
    const today = new Date();
    const startDate = new Date();
    startDate.setMonth(today.getMonth() - 2);
    
    const endDate = new Date();
    endDate.setMonth(today.getMonth() + 2);
    
    this.dateRangeForm.setValue({
      startDate: startDate,
      endDate: endDate
    });
    
    this.searchByDateRange();
  }

  searchByDateRange() {
    const startDate = this.dateRangeForm.value.startDate || undefined;
    const endDate = this.dateRangeForm.value.endDate || undefined;
    
    // Filter out statuses that shouldn't appear in the history view.
    // 'Cancelled' = mistake/error entries; 'Undefined' = historical manual entries not yet reviewed.
    // We filter client-side to avoid a composite Firestore index on (initialEta, currentStatus).
    this.visits$ = this.visitRepository.getAllCompletedVisits(startDate, endDate).pipe(
      map(visits => visits.filter(v => v.status !== 'Cancelled' && v.status !== 'Undefined'))
    );
  }

  clearDates() {
    this.loadDefaultRange();
  }

  onSortOrderChange() {
    // This will trigger the change in the child component through the Input binding
  }
}
