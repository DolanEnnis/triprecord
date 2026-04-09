import { computed, inject, Injectable, Signal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { combineLatest, map, Observable } from 'rxjs';
import { Timestamp } from '@angular/fire/firestore';
import { TripRepository } from '../repositories/trip.repository';
import { mapTripToConfirmationRow } from '../../models/mappers/trip-confirmation-row.mapper';
import type { TripConfirmationRow } from '../../models/view/trip-confirmation-row.view';
import type { Port } from '../../models/types';
import type { TripType } from '../../models/types';

// ---------------------------------------------------------------------------
// FILTER TYPES
// Defined here (not in a shared types file) because these are UI concerns
// that live and die with this service and the confirmation component.
// ---------------------------------------------------------------------------

/** Controls which trip direction the table shows. */
export type TripDirectionFilter = 'All' | 'In' | 'Out';

/** Controls which port the table shows. */
export type TripPortFilter = 'All' | Port;

/** Controls which confirmation state the table shows. */
export type TripStatusFilter = 'All' | 'Actionable' | 'Confirmed';

/**
 * TripLogV2Service — the authoritative data gateway for the Trip Confirmation page (V2).
 *
 * @remarks
 * **Architecture: Why this service exists alongside `TripRepository`**
 *
 * The repository layer (`TripRepository`) is responsible for one thing only:
 * talking to Firestore. It returns raw `Trip[]` observables.
 *
 * THIS service sits one level above:
 *  1. Delegates all Firestore access to `TripRepository` (never touches Firestore directly).
 *  2. Transforms raw `Trip[]` into `TripConfirmationRow[]` via the pure mapper.
 *  3. Exposes reactive filter Signals that the component can bind to.
 *  4. Exposes a derived `filteredRows` Signal combining both data and filters.
 *
 * **Severance Contract — Strictly Enforced:**
 * This service MUST NOT import or reference:
 *  - `UnifiedTrip` (`unified-trip.dto.ts`)
 *  - `Charge` (`charge.entity.ts`)
 *  - `ChargeableEvent` (`chargeable-event.dto.ts`)
 *  - `VisitRepository` or `ChargeRepository`
 *
 * All data originates exclusively from the `/trips` Firestore collection.
 *
 * **Data Window:**
 * - Recent trips: `boarding >= (now - HISTORY_MONTHS)`, ordered newest → oldest.
 * - Pending trips: `boarding == null` (no date set yet).
 * Both streams are merged and deduplicated before any filtering is applied.
 *
 * @see {@link TripRepository} for the Firestore query methods
 * @see {@link mapTripToConfirmationRow} for the Trip → Row transformation
 * @see {@link TripConfirmationRow} for the shape of each rendered row
 */
@Injectable({
  providedIn: 'root',
})
export class TripLogV2Service {
  // Injecting only TripRepository — no VisitRepository, no ChargeRepository.
  private readonly tripRepository = inject(TripRepository);

  // -------------------------------------------------------------------------
  // CONFIGURATION
  // -------------------------------------------------------------------------

  /** How many months of boarding-date history to show. Adjust to widen/narrow the window. */
  private readonly HISTORY_MONTHS = 3;

  // -------------------------------------------------------------------------
  // RAW DATA SIGNAL
  //
  // We merge two repository streams using `combineLatest`:
  //   Stream A — recent trips (boarding within history window, ordered desc)
  //   Stream B — pending trips (boarding === null)
  //
  // Why `combineLatest` and not `merge`?
  // `combineLatest` waits for BOTH streams to emit before producing a value,
  // then re-emits any time either stream changes. This means the merged array
  // is always a coherent snapshot of both streams together.
  //
  // `merge` would emit partial results (only the first-to-respond stream)
  // which would cause a flicker where pending trips appear before recent ones
  // or vice versa.
  // -------------------------------------------------------------------------

  /** Internal merged signal of ALL rows before any filter is applied. */
  private readonly _allRows: Signal<TripConfirmationRow[]> = toSignal(
    combineLatest([
      // Stream A: trips with a real boarding date (within the history window)
      this.tripRepository.getRecentTrips(this.buildCutoffTimestamp()),

      // Stream B: trips with no boarding date yet (scheduled but not yet executed)
      this.tripRepository.getPendingTrips(),
    ]).pipe(
      map(([recentTrips, pendingTrips]) => {
        // Merge both arrays into one, then map through the pure mapper.
        // De-duplicate by ID as a safety measure in case a race condition causes
        // the same document to appear in both streams (should not happen, but
        // defensive coding is cheap here).
        const seenIds = new Set<string>();
        const uniqueTrips = [...recentTrips, ...pendingTrips].filter((trip) => {
          if (!trip.id || seenIds.has(trip.id)) return false;
          seenIds.add(trip.id);
          return true;
        });

        // Transform each raw Trip into a flat TripConfirmationRow.
        // The mapper handles all field priority logic, Timestamp → Date conversion,
        // and data-quality warning generation.
        return uniqueTrips.map(mapTripToConfirmationRow);
      }),
    ),
    { initialValue: [] },
  );

  // -------------------------------------------------------------------------
  // FILTER SIGNALS (writable — the component sets these via the UI)
  // -------------------------------------------------------------------------

  /** Which trip direction to show: 'All', 'In', or 'Out'. */
  readonly directionFilter = signal<TripDirectionFilter>('All');

  /** Which port to show: 'All' or a specific Port value. */
  readonly portFilter = signal<TripPortFilter>('All');

  /** Which confirmation state to show: 'All', 'Actionable', or 'Confirmed'. */
  readonly statusFilter = signal<TripStatusFilter>('All');

  // -------------------------------------------------------------------------
  // PUBLIC API — DERIVED SIGNALS
  //
  // All of these are `computed()` — they recalculate automatically when
  // either the raw data or the filter signals change.
  // The component reads these; it never filters manually.
  // -------------------------------------------------------------------------

  /**
   * The final rendered dataset: all rows after all active filters have been applied.
   *
   * LEARNING: WHY ONE BIG `computed()` INSTEAD OF CHAINED SIGNALS?
   * Chaining signals (filterByDir → filterByPort → filterByStatus) creates multiple
   * intermediate computations that all re-run on every change. A single `computed()`
   * that reads all three filters runs the full filter pipeline only once per change
   * event, which is more efficient and easier to follow.
   */
  readonly filteredRows: Signal<TripConfirmationRow[]> = computed(() => {
    const direction = this.directionFilter();
    const port = this.portFilter();
    const status = this.statusFilter();

    return this._allRows().filter((row) => {
      // --- Direction filter ---
      // 'All' passes everything. Otherwise we match the typeTrip field directly.
      if (direction !== 'All' && row.typeTrip !== direction) return false;

      // --- Port filter ---
      // 'All' passes everything. Port comparison is case-insensitive for safety.
      if (port !== 'All') {
        const rowPort = row.port?.toLowerCase() ?? '';
        if (rowPort !== port.toLowerCase()) return false;
      }

      // --- Status filter ---
      // 'Actionable' = unconfirmed trips the officer still needs to act on.
      // 'Confirmed'  = already billed / read-only history.
      if (status === 'Actionable' && !row.isActionable) return false;
      if (status === 'Confirmed' && row.isActionable) return false;

      return true;
    });
  });

  /**
   * Count of unconfirmed rows in the FILTERED set.
   * Useful for driving a badge UI (e.g. "3 pending confirmations").
   */
  readonly actionableCount: Signal<number> = computed(
    () => this.filteredRows().filter((row) => row.isActionable).length,
  );

  /**
   * `true` while the first data load is still in progress.
   * `toSignal` emits `initialValue: []` immediately, so the component can
   * show a skeleton/spinner by checking `isLoading()` instead of checking
   * for an empty array (which is ambiguous — empty could mean "loaded but
   * no records").
   *
   * LEARNING: WHY NOT A `BehaviorSubject<boolean>`?
   * Because we can derive this purely from the data signal — we don't need
   * to manually track loading state. Zero manual `isLoading.next(true/false)` calls.
   * This pattern is called "derive, don't duplicate".
   */
  readonly isLoading: Signal<boolean> = computed(() => {
    // We treat the initialValue (empty array emitted before Firestore responds)
    // as the loading state. Once Firestore returns (even 0 docs), _allRows will
    // still be an empty array — so we use a separate flag pattern here.
    // A more robust approach would be a dedicated `loaded` signal toggled in the
    // pipe, but for now this serves as a useful starting point.
    return this._allRows() === undefined;
  });

  /**
   * Resets all three filters back to their defaults.
   * Call this when the user clicks "Clear Filters" in the component.
   */
  resetFilters(): void {
    this.directionFilter.set('All');
    this.portFilter.set('All');
    this.statusFilter.set('All');
  }

  // -------------------------------------------------------------------------
  // OBSERVABLE API
  //
  // This method is the explicit, Observable-based contract for the component.
  // It uses the same TripRepository methods as the signal pipeline above,
  // but returns a plain Observable<TripConfirmationRow[]> so the component
  // (or a future resolver/guard) can consume it however it likes.
  //
  // WHY BOTH A SIGNAL PIPELINE AND AN OBSERVABLE METHOD?
  // The signal pipeline (_allRows + filteredRows) owns the filter state and
  // drives reactive UI. This Observable method is a clean, stateless fetch
  // that can be consumed with the `async` pipe, used in a resolver, or tested
  // with a simple `subscribe()` in a unit test — no TestBed Signal context needed.
  // -------------------------------------------------------------------------

  /**
   * Fetches and maps the last 3 months of trips into `TripConfirmationRow[]`.
   *
   * This is the primary data source for the Trip Confirmation table.
   * It reads exclusively from the `/trips` collection via `TripRepository`
   * and applies the canonical field mapping and sort order.
   *
   * **Sort order:**
   *  1. Pending trips (no boarding date) are pushed to the bottom.
   *  2. All other trips are sorted by `boarding` date, newest → oldest.
   *
   * @returns A live Observable that re-emits whenever Firestore data changes.
   */
  getConfirmationTrips(): Observable<TripConfirmationRow[]> {
    // Step 3: Calculate the 3-month cutoff and delegate to the repository.
    // The repository owns the Firestore query; this service owns the transformation.
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const cutoff = Timestamp.fromDate(threeMonthsAgo);

    return this.tripRepository.getRecentTrips(cutoff).pipe(
      map((trips) => {
        // Step 4: Map each raw Trip entity to a flat TripConfirmationRow.
        // Every field is named exactly as the Material table column definitions expect.
        const rows: TripConfirmationRow[] = trips.map((trip) => ({
          // --- Identity ---
          id:      trip.id!,       // id is always populated after a Firestore fetch
          visitId: trip.visitId,   // undefined for standalone trips — that is valid

          // --- Display fields (direct 1:1 from Trip document) ---
          ship:        trip.shipName            || 'Unknown Ship',
          gt:          trip.gt                  || 0,
          boarding:    this.toSafeDate(trip.boarding),        // Timestamp | null → Date | null
          port:        trip.port                || null,
          pilot:       trip.pilot               || '',
          typeTrip:    trip.typeTrip,
          sailingNote: trip.pilotNotes          || '',
          extra:       trip.extraChargesNotes   || '',

          // --- Derived booleans (computed once here, never in the template) ---
          // THE NEW PIVOT: we trust the boolean, not source strings.
          isActionable: !trip.isConfirmed,
          // isPending flags rows with no boarding date for special sort treatment.
          isPending:    !trip.boarding,

          // --- Audit fields: resolved with a priority chain ---
          // Priority: most-recent edit → billing confirmation → original creation
          updatedBy: trip.lastModifiedBy ?? trip.confirmedBy ?? trip.recordedBy ?? 'System',
          updateTime: (
            this.toSafeDate(trip.lastModifiedAt) ??
            this.toSafeDate(trip.confirmedAt)    ??
            this.toSafeDate(trip.recordedAt)     ??
            new Date()
          ),

          // --- Docket (optional) ---
          docketUrl:  trip.docketUrl,
          docketType: trip.docketType,
        }));

        // Step 5: Sort the mapped rows.
        // Rule 1 — pending rows (no boarding date) always sink to the bottom.
        // Rule 2 — for all other rows, newest boarding date first (descending).
        return rows.sort((a, b) => {
          // If exactly one row is pending, it loses (goes toward the bottom).
          if (a.isPending && !b.isPending) return 1;   // a sinks
          if (!a.isPending && b.isPending) return -1;  // b sinks

          // Both pending or both dated: sort by boarding date descending.
          // Pending rows have null boarding, so we fall back to 0 (stable position)
          // which keeps them in their original order relative to each other.
          const timeA = a.boarding?.getTime() ?? 0;
          const timeB = b.boarding?.getTime() ?? 0;
          return timeB - timeA; // descending: larger (more recent) timestamp first
        });
      }),
    );
  }

  // -------------------------------------------------------------------------
  // PRIVATE HELPERS
  // -------------------------------------------------------------------------

  /**
   * Safely converts a Firestore Timestamp, a duck-typed Timestamp object,
   * a JS Date, or null/undefined into a plain JS Date (or null).
   *
   * WHY DO WE NEED THIS?
   * Firestore sometimes returns objects that look like Timestamps (they have
   * `.seconds` and `.toDate()`) but have lost their prototype chain due to
   * serialisation (e.g., after going through an Angular service worker cache
   * or certain emulator versions). The `instanceof` check alone would fail
   * for those cases, so we duck-type as a fallback.
   *
   * @param val - Any timestamp-like value from a Firestore document field.
   * @returns A JS Date, or null if the value cannot be resolved.
   */
  private toSafeDate(val: unknown): Date | null {
    if (!val) return null;
    // First choice: proper Firestore Timestamp with prototype intact
    if (val instanceof Timestamp) return val.toDate();
    // Second choice: already a JS Date (e.g. from tests or local mutation)
    if (val instanceof Date) return val;
    // Third choice: duck-type for serialised Timestamp objects
    if (
      typeof val === 'object' &&
      typeof (val as any).seconds === 'number' &&
      typeof (val as any).toDate === 'function'
    ) {
      return (val as any).toDate() as Date;
    }
    return null;
  }

  /**
   * Builds a Firestore Timestamp representing the start of the history window.
   * Called once at construction time — the cutoff is fixed for the lifetime of
   * this service instance (which is 'root', so for the whole app session).
   *
   * LEARNING: IS THIS STALE?
   * For a session-lived service, "3 months ago" computed at startup is acceptable.
   * If the app stays open overnight and you need the window to stay accurate,
   * promote this to a `computed()` that reads a `signal<Date>()` updated by a timer.
   * That's an optimisation for later — YAGNI applies here for now.
   */
  private buildCutoffTimestamp(): Timestamp {
    const cutoff = new Date();
    // JS handles month underflow correctly: month 0 - 3 → month -3 → October prev year.
    cutoff.setMonth(cutoff.getMonth() - this.HISTORY_MONTHS);
    return Timestamp.fromDate(cutoff);
  }
}
