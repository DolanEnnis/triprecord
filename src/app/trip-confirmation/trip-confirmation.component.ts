import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  TripLogV2Service,
  TripDirectionFilter,
  TripPortFilter,
  TripStatusFilter,
} from '../services/core/trip-log-v2.service';
import { AuthService } from '../auth/auth';
import type { TripConfirmationRow } from '../models';

// ---------------------------------------------------------------------------
// SEVERANCE CONTRACT — enforced by imports above
// This component MUST NOT import:
//   - UnifiedTrip, Charge, ChargeableEvent
//   - UnifiedTripLogService or DataService (legacy)
// All data flows from TripLogV2Service → TripConfirmationRow → template.
// Dialogs will receive only row.id and row.visitId — never a pre-built payload.
// ---------------------------------------------------------------------------

/**
 * Trip Confirmation Component (Formerly V2)
 *
 * @remarks
 * This is a **thin component** — it owns no data-fetching logic, no sorting,
 * no mapping, and no raw Firestore access. All of that lives in TripLogV2Service.
 *
 * The component's only responsibilities are:
 *  1. Exposing the service's Signals to the template as named aliases.
 *  2. Forwarding user interactions (filter changes, row clicks) back to the service.
 *  3. Opening dialogs with the minimal data they need (trip ID + visit ID).
 *
 * **Why alias the signals instead of using the service directly in the template?**
 * Exposing named properties (`rows`, `isLoading`) keeps the template readable and
 * decoupled from the service's internal naming. If the service is ever renamed or
 * replaced, we only update the aliases here — the template HTML doesn't change.
 */
@Component({
  selector: 'app-trip-confirmation',
  standalone: true,
  imports: [
    CommonModule,
    DatePipe,
    MatTableModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
  ],
  templateUrl: './trip-confirmation.component.html',
  styleUrl: './trip-confirmation.component.css',
})
export class TripConfirmationComponent implements OnInit {

  // -------------------------------------------------------------------------
  // SERVICE INJECTION
  //
  // We inject TripLogV2Service as the single source of truth.
  // It is `readonly` so nothing in this component can reassign the reference.
  // -------------------------------------------------------------------------

  protected readonly tripLogService = inject(TripLogV2Service);
  private  readonly authService    = inject(AuthService);

  // -------------------------------------------------------------------------
  // SERVICE SIGNAL ALIASES
  // -------------------------------------------------------------------------

  /** Base filtered dataset from the service (direction + port + status applied). */
  readonly rows = this.tripLogService.filteredRows;

  /** True while the first Firestore response is in-flight. */
  readonly isLoading = this.tripLogService.isLoading;

  /** Count of actionable rows after all filters are applied. */
  readonly actionableCount = this.tripLogService.actionableCount;

  // -------------------------------------------------------------------------
  // LOCAL UI SIGNALS
  //
  // These are component-owned — they don't belong in the service because:
  //  - pilotFilter is user-session-specific, not meaningful to other consumers.
  //  - textFilter is a transient search term, not a persisted data concern.
  //
  // `displayedRows` then applies these on top of the service's already-filtered
  // `rows()`, creating a clean two-tier filter chain:
  //   Firestore → service filters (dir/port/status) → UI filters (pilot/text)
  // -------------------------------------------------------------------------

  /** 'My' = show only this pilot's trips; 'All' = show everyone's trips. */
  readonly pilotFilter = signal<'My' | 'All'>('My');

  /** Free-text search string applied against ship, port, pilot, and notes. */
  readonly textFilter = signal<string>('');

  /**
   * Tracks the value of the direction <mat-select> including the synthetic
   * 'Default' option. Kept separate from the service filter so we can restore
   * the UI back to 'Division Default' visually after clearFilters().
   *
   * NOTE: No longer needed — direction is now a mat-button-toggle-group
   * which reads directly from tripLogService.directionFilter().
   * Kept as a comment for context; can be deleted entirely in a cleanup pass.
   */
  // readonly directionSelectValue = signal<TripDirectionFilter | 'Default'>('Default');

  // -------------------------------------------------------------------------
  // COMPUTED SIGNALS
  // -------------------------------------------------------------------------

  /**
   * Possessive display name for the "My" pilot toggle.
   * e.g. "John's" trips vs "All" trips.
   */
  readonly userName = computed(() => {
    const name = this.authService.currentUserSig()?.displayName;
    return name ? `${name}'s` : 'My';
  });

  /**
   * The final dataset that the Material table renders.
   * Applies pilot + text filters on top of the service's direction/port/status output.
   *
   * LEARNING: WHY A SECOND COMPUTED?
   * The service's `filteredRows` doesn't know about pilot or text — those are
   * UI-only concerns. Rather than polluting the service, we chain a second
   * `computed()` here. Angular knows each Signal dependency and re-runs only
   * when `rows()`, `pilotFilter()`, or `textFilter()` actually changes.
   */
  readonly displayedRows = computed(() => {
    const rows    = this.rows();
    const pilot   = this.pilotFilter();
    const text    = this.textFilter().toLowerCase();
    const user    = this.authService.currentUserSig();

    return rows.filter((row) => {
      // --- Pilot filter ---
      if (pilot === 'My' && user) {
        const isOwn       = row.pilot === user.displayName;
        const isUnassigned = !row.pilot;
        if (!isOwn && !isUnassigned) return false;
      }

      // --- Text filter ---
      if (text) {
        const haystack = [
          row.ship, row.port ?? '', row.pilot,
          row.sailingNote, row.extra, row.updatedBy,
        ].join(' ').toLowerCase();
        if (!haystack.includes(text)) return false;
      }

      return true;
    });
  });

  // -------------------------------------------------------------------------
  // FILTER METHODS
  //
  // These are thin forwarders — they set the writable signals in the service,
  // which causes `filteredRows` (and therefore `rows`) to recompute automatically.
  //
  // The template calls these methods on user interaction (button toggle, select change).
  // The component never needs to manually refresh data or call a separate "apply" step.
  // -------------------------------------------------------------------------

  /** Forwards the direction value directly to the service setter. */
  updateDirectionFilter(value: TripDirectionFilter): void {
    this.tripLogService.setDirectionFilter(value);
  }

  /** Updates the port filter via the service setter. */
  updatePortFilter(port: TripPortFilter): void {
    this.tripLogService.setPortFilter(port);
  }

  /** Updates the status filter via the service setter. */
  updateStatusFilter(status: TripStatusFilter): void {
    this.tripLogService.setStatusFilter(status);
  }

  /** Updates the pilot filter (local UI signal). */
  onPilotFilterChange(value: 'My' | 'All'): void {
    this.pilotFilter.set(value);
  }

  /** Updates the text search filter (local UI signal). */
  onTextInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value.trim();
    this.textFilter.set(value);
  }

  /**
   * Resets all filters — both service-level and local UI signals — back to defaults.
   * The select UI is also reset to 'Division Default'.
   */
  clearFilters(): void {
    this.tripLogService.resetFilters();   // direction + port + status
    this.pilotFilter.set('My');           // local pilot filter
    this.textFilter.set('');             // local text filter
    this.applyDivisionDefault();         // re-apply direction from user profile
  }

  // -------------------------------------------------------------------------
  // LIFECYCLE
  // -------------------------------------------------------------------------

  ngOnInit(): void {
    // Apply the direction filter default on load based on the user's division.
    this.applyDivisionDefault();
  }

  // -------------------------------------------------------------------------
  // ROW INTERACTION
  // -------------------------------------------------------------------------

  onRowClicked(row: TripConfirmationRow): void {
    // Stub — dialogs wired up in the next phase.
    console.log('Row clicked. Trip ID:', row.id, 'Visit ID:', row.visitId);
  }

  // -------------------------------------------------------------------------
  // PRIVATE HELPERS
  // -------------------------------------------------------------------------

  /**
   * Sets the service direction filter based on the logged-in pilot's division.
   * Called on init and when the user selects "Division Default" from the dropdown.
   */
  private applyDivisionDefault(): void {
    const user = this.authService.currentUserSig();
    if (user?.userType === 'pilot' && user.division === 'In') {
      this.tripLogService.setDirectionFilter('In');
    } else if (user?.userType === 'pilot' && user.division === 'Out') {
      this.tripLogService.setDirectionFilter('Out');
    } else {
      this.tripLogService.setDirectionFilter('All');
    }
  }

  /** Column order for the Material table — single source of truth used by both header and row defs. */
  readonly displayedColumns = [
    'ship', 'gt', 'boarding', 'port', 'monthNo', 'pilot', 'typeTrip', 'status',
  ];
}
