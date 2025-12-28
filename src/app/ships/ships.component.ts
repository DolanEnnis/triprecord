import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router } from '@angular/router';
import { ShipRepository } from '../services/ship.repository';
import { VisitRepository } from '../services/visit.repository';
import { Observable, of } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, finalize, map } from 'rxjs/operators';
import { ShipDetailsCard } from '../ship-details-card/ship-details-card';
import { PreviousVisitsListComponent } from '../previous-visits/previous-visits-list/previous-visits-list.component';
import { EnrichedVisit } from '../models';

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
    MatProgressSpinnerModule,
    ShipDetailsCard,
    PreviousVisitsListComponent
  ],
  templateUrl: './ships.component.html',
  styleUrls: ['./ships.component.css']
})
export class ShipsComponent implements OnInit {
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

  // Cache for all ships - loaded eagerly on page load
  allShipsCache: { ship: string; gt: number; id: string }[] | null = null;
  
  // Signal to show loading indicator at top of page
  loadingShips = signal(true);

  constructor() {
    // LEARNING: EAGER-LOADED CACHED SEARCH PATTERN
    // 
    // Strategy:
    // 1. On page load (ngOnInit), fetch ALL ships from Firebase
    // 2. Show loading indicator while fetching
    // 3. Cache them in memory (allShipsCache)
    // 4. For ALL searches, filter the cache (instant!)
    // 
    // Benefits:
    // - Loading happens in background while user reads the page
    // - True "contains" matching: "Win" finds "Arklow Wind"
    // - All searches are INSTANT (no network delay)
    // - Clear visual feedback via loading indicator
    // 
    // Trade-off: Initial 4-second load, but user barely notices
    this.ships$ = this.searchControl.valueChanges.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap(search => {
        if (!search || search.length < 3) {
          return of([]);
        }
        
        // If cache doesn't exist yet, return empty (shouldn't happen after ngOnInit)
        if (!this.allShipsCache) {
          return of([]);
        }
        
        // Filter cached ships (instant!)
        const filtered = this.allShipsCache.filter((ship: { ship: string; gt: number; id: string }) =>
          ship.ship.toLowerCase().includes(search.toLowerCase())
        );
        return of(filtered);
      })
    );
  }

  ngOnInit(): void {
    // LEARNING: EAGER LOADING ON COMPONENT INIT
    // Load all ships immediately when component opens
    // User sees loading indicator while this happens
    
    this.shipRepository.getAllShips().subscribe({
      next: (ships: { ship: string; gt: number; id: string }[]) => {
        this.allShipsCache = ships;
        this.loadingShips.set(false);
      },
      error: (err) => {
        console.error('Failed to load ships:', err);
        this.loadingShips.set(false);
      }
    });
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
