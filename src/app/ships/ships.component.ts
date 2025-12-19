import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { Router } from '@angular/router';
import { ShipRepository } from '../services/ship.repository';
import { VisitRepository } from '../services/visit.repository';
import { Observable, of } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, finalize } from 'rxjs/operators';
import { ShipDetailsCard } from '../ship-details-card/ship-details-card';
import { PreviousVisitsListComponent } from '../previous-visits/previous-visits-list/previous-visits-list.component';
import { EnrichedVisit } from '../models/enriched-visit.model';

/**
 * LEARNING: COMPONENT COMPOSITION PATTERN
 * 
 * This component demonstrates composing multiple child components:
 * 1. Ship search (local implementation)
 * 2. ShipDetailsCard component (reusable edit card)
 * 3. PreviousVisitsListComponent (reusable data table)
 * 
 * The key pattern is using Signals to manage local state (selectedShipId)
 * and passing data down to child components via @Input() bindings.
 * 
 * This is more maintainable than having all logic in one large component.
 */
@Component({
  selector: 'app-ships',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatInputModule,
    MatFormFieldModule,
    MatTableModule,
    MatIconModule,
    MatButtonModule,
    MatCardModule,
    ShipDetailsCard,
    PreviousVisitsListComponent
  ],
  templateUrl: './ships.component.html',
  styleUrls: ['./ships.component.css']
})
export class ShipsComponent {
  private readonly shipRepository = inject(ShipRepository);
  private readonly visitRepository = inject(VisitRepository);
  private readonly router = inject(Router);

  // Search form control
  searchControl = new FormControl('');
  
  // Observable for ship search results
  ships$!: Observable<{ ship: string; gt: number; id: string }[]>;
  
  // Table columns for search results
  displayedColumns = ['shipName', 'grossTonnage'];
  
  // Loading state for search (using a functional approach with finalize)
  searching = signal(false);

  // LEARNING: SIGNAL FOR COMPONENT STATE
  // selectedShipId is a Signal that tracks which ship the user has clicked.
  // When null, we show the search results. When set, we show ship details + visits.
  // Signals are reactive - when this changes, the template automatically updates.
  selectedShipId = signal<string | null>(null);
  selectedShipName = signal<string>('');

  // Observable for visit history of the selected ship
  shipVisits = signal<EnrichedVisit[]>([]);

  constructor() {
    // LEARNING: REACTIVE SEARCH with RxJS
    // This pattern is common for implementing type-ahead search:
    // 1. Listen to form control changes
    // 2. Debounce to avoid too many API calls (wait 300ms after typing stops)
    // 3. Only search if >3 characters
    // 4. Use switchMap to cancel previous search if user keeps typing
    this.ships$ = this.searchControl.valueChanges.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap(search => {
        if (!search || search.length < 3) {
          this.searching.set(false);
          return of([]);
        }
        this.searching.set(true);
        return this.shipRepository.getShipSuggestions(search).pipe(
          finalize(() => this.searching.set(false)) // Reset loading state when done
        );
      })
    );
  }

  /**
   * LEARNING: CLICK HANDLER PATTERN
   * 
   * When a user clicks a ship row, we:
   * 1. Store the selected ship's ID and name in Signals
   * 2. Load the ship's fully enriched visit history
   * 3. The template will reactively hide search results and show details
   * 
   * WHY getEnrichedVisitsByShipId?
   * - Returns EnrichedVisit[] with full Trip data (In and Out trips)
   * - Includes berthed date, sailed date, and outward pilot information
   * - No manual enrichment needed - repository handles all the complexity
   */
  viewShipVisits(shipId: string, shipName: string): void {
    this.selectedShipId.set(shipId);
    this.selectedShipName.set(shipName);
    
    // Load fully enriched visit history for this ship
    // This fetches both In and Out trip data automatically
    this.visitRepository.getEnrichedVisitsByShipId(shipId).subscribe({
      next: (enrichedVisits) => {
        this.shipVisits.set(enrichedVisits);
      },
      error: (err) => {
        console.error('Failed to load ship visits:', err);
        this.shipVisits.set([]);
      }
    });
  }

  /**
   * Clears the ship selection and returns to search view.
   * If there's text in the search box, re-trigger the search to show results.
   */
  clearSelection(): void {
    this.selectedShipId.set(null);
    this.selectedShipName.set('');
    this.shipVisits.set([]);
    
    // LEARNING: MANUAL OBSERVABLE TRIGGER
    // When we clear selection, the search box still has text but the observable
    // doesn't automatically re-emit. We need to manually trigger it.
    const currentSearch = this.searchControl.value;
    if (currentSearch && currentSearch.length >= 3) {
      // Trigger the search by updating the form control with the same value
      // This forces the valueChanges observable to emit
      this.searchControl.setValue(currentSearch);
    }
  }
}
