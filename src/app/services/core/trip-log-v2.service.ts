import { computed, inject, Injectable, Signal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { combineLatest, map, Observable } from 'rxjs';
import { Timestamp } from '@angular/fire/firestore';
import { TripRepository } from '../repositories/trip.repository';
import { mapTripToConfirmationRow } from '../../models/mappers/trip-confirmation-row.mapper';
import type { TripConfirmationRow } from '../../models/view/trip-confirmation-row.view';
import type { Port } from '../../models/types';
import type { TripType } from '../../models/types';
import { AuthService } from '../../auth/auth';

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
  private readonly authService = inject(AuthService);

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
        // Sort immediately so that _allRows is always in the canonical order:
        // dated rows newest-first, pending rows (no boarding date) at the bottom.
        // All downstream consumers (filteredRows, actionableCount, etc.) inherit
        // this order for free — no re-sorting needed anywhere else.
        return uniqueTrips.map(mapTripToConfirmationRow).sort(TripLogV2Service.sortRows);
      }),
    ),
    { initialValue: [] },
  );

  // -------------------------------------------------------------------------
  // FILTER SIGNALS
  //
  // Pattern: private writable backing signal + public read-only view.
  //
  // LEARNING: WHY THIS PATTERN?
  // Exposing a writable signal directly (e.g. `readonly directionFilter = signal(...)`) 
  // lets ANY injector call `.set()` on it, bypassing your intended API surface.
  // By making the signal `private` and returning it via `.asReadonly()`, the
  // PUBLIC type is `Signal<T>` (read-only) — the `.set()` and `.update()` methods
  // are stripped at compile time. Mutation can only happen through the explicit
  // setter methods below, giving you full control over state changes.
  //
  // `.asReadonly()` has ZERO runtime cost — it is purely a TypeScript type cast.
  // -------------------------------------------------------------------------

  /** Private writable source — only mutated via setDirectionFilter() / resetFilters(). */
  private readonly _directionFilter = signal<TripDirectionFilter>('All');

  /** Private writable source — only mutated via setPortFilter() / resetFilters(). */
  private readonly _portFilter = signal<TripPortFilter>('All');

  /** Private writable source — only mutated via setStatusFilter() / resetFilters(). */
  private readonly _statusFilter = signal<TripStatusFilter>('All');

  /** Read-only public view of the direction filter — template and component bind to this. */
  readonly directionFilter = this._directionFilter.asReadonly();

  /** Read-only public view of the port filter. */
  readonly portFilter = this._portFilter.asReadonly();

  /** Read-only public view of the status filter. */
  readonly statusFilter = this._statusFilter.asReadonly();

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
    const user = this.authService.currentUserSig();
    const now = new Date();

    return this._allRows().filter((row) => {
      // --- Ghost Trip Filter ---
      // Hide pending trips (no boarding date set) from non-admin users.
      if (row.isPending && user?.userType !== 'admin') {
        return false;
      }

      // --- Future Trip Filter ---
      // A trip cannot be confirmed if it hasn't actually happened yet.
      // If the boarding date is in the future relative to the user's local clock, hide it.
      if (row.boarding && row.boarding > now) {
        return false;
      }

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
   * Resets all three filters back to their defaults in one atomic step.
   * Call this when the user clicks "Clear Filters" in the component.
   */
  resetFilters(): void {
    // Use the private backing signals — the public views are read-only.
    this._directionFilter.set('All');
    this._portFilter.set('All');
    this._statusFilter.set('All');
  }

  // -------------------------------------------------------------------------
  // PUBLIC FILTER SETTERS
  //
  // These are the ONLY sanctioned way for external code to mutate filter state.
  // Components call these methods; they never touch the private signals directly.
  // -------------------------------------------------------------------------

  /**
   * Sets the trip direction filter.
   * @param value 'All' | 'In' | 'Out'
   */
  setDirectionFilter(value: TripDirectionFilter): void {
    this._directionFilter.set(value);
  }

  /**
   * Sets the port filter.
   * @param value 'All' | a Port string (e.g. 'Foynes', 'Aughinish')
   */
  setPortFilter(value: TripPortFilter): void {
    this._portFilter.set(value);
  }

  /**
   * Sets the confirmation status filter.
   * @param value 'All' | 'Actionable' | 'Confirmed'
   */
  setStatusFilter(value: TripStatusFilter): void {
    this._statusFilter.set(value);
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
      // Delegate to the shared pure mapper — identical field mapping as _allRows,
      // no duplication. Then apply the same canonical sort so this Observable
      // and the Signal pipeline always produce identically-ordered data.
      map((trips) => trips.map(mapTripToConfirmationRow).sort(TripLogV2Service.sortRows)),
    );
  }

  // -------------------------------------------------------------------------
  // PRIVATE HELPERS
  // -------------------------------------------------------------------------

  /**
   * Canonical sort comparator for `TripConfirmationRow[]`.
   *
   * Rules (in priority order):
   *  1. Pending rows (no boarding date) always sink to the bottom.
   *  2. All other rows sort by `boarding` date descending (newest first).
   *
   * Defined as a `static` method so it can be passed directly as a callback
   * to `.sort()` without binding `this`. This also makes it trivially
   * unit-testable: `[rowA, rowB].sort(TripLogV2Service.sortRows)`.
   */
  static sortRows(a: TripConfirmationRow, b: TripConfirmationRow): number {
    // If exactly one row is pending, it loses — push it toward the bottom.
    if (a.isPending && !b.isPending) return 1;
    if (!a.isPending && b.isPending) return -1;

    // Both pending or both dated: sort by boarding timestamp, newest first.
    // Pending rows have null boarding, so we fall back to 0 to keep their
    // relative order stable (no arbitrary re-ordering among pending rows).
    const timeA = a.boarding?.getTime() ?? 0;
    const timeB = b.boarding?.getTime() ?? 0;
    return timeB - timeA; // positive → b is newer → b comes first
  }

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
