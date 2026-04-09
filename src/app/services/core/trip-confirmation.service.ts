import { computed, inject, Injectable, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  collection,
  collectionData,
  Firestore,
  orderBy,
  query,
  Timestamp,
  where,
} from '@angular/fire/firestore';
import { map } from 'rxjs/operators';
import type { Trip } from '../../models/entities/trip.entity';
import type { TripConfirmationRow } from '../../models/view/trip-confirmation-row.view';
import { mapTripToConfirmationRow } from '../../models/mappers/trip-confirmation-row.mapper';

/**
 * V2 Trip Confirmation Service — the single data gateway for the Trip Confirmation page.
 *
 * @remarks
 * **Severance Contract:**
 * This service is strictly forbidden from importing or referencing:
 *  - `UnifiedTrip` (`unified-trip.dto.ts`)
 *  - `Charge` (`charge.entity.ts`)
 *  - `ChargeableEvent` (`chargeable-event.dto.ts`)
 *
 * Data flows in one direction:
 *  Firestore `/trips` → `Trip[]` → mapper → `TripConfirmationRow[]` → Signals → Template
 *
 * **Why Signals instead of Observables exposed directly?**
 * Angular Signals are synchronous and glitch-free — `computed()` derived from a Signal
 * always sees a consistent snapshot. An Observable would require the component to
 * manage subscriptions or use the `async` pipe, both of which add ceremony.
 * We convert once at the boundary (`toSignal`) and everything downstream is pure Signal.
 *
 * **The Window:**
 * We query trips with a `boarding` timestamp within the last N months, PLUS all
 * trips where `boarding === null` (pending/upcoming). This covers the two cases
 * a confirmation officer needs to see: recent history and upcoming movements.
 *
 * @see {@link TripConfirmationRow} for the shape of each row
 * @see {@link mapTripToConfirmationRow} for the mapping logic
 */
@Injectable({
  providedIn: 'root',
})
export class TripConfirmationService {
  private readonly firestore = inject(Firestore);

  // -------------------------------------------------------------------------
  // CONFIGURATION
  // -------------------------------------------------------------------------

  /**
   * How many months back to look for trips with a boarding date.
   * Adjust this constant to widen/narrow the confirmation window.
   */
  private readonly HISTORY_MONTHS = 3;

  // -------------------------------------------------------------------------
  // RAW QUERY SIGNALS
  // We define two separate queries and merge them, because Firestore does not
  // support OR queries across different field values in a single compound query.
  //
  // Query A: Recent trips (boarding within the last N months, ordered newest → oldest)
  // Query B: Pending trips (boarding === null — no date set yet)
  // -------------------------------------------------------------------------

  /**
   * Signal of all trips with a real boarding date in the configured history window.
   * Ordered by `boarding` descending so the most recent trips appear at the top.
   */
  private readonly recentTrips: Signal<TripConfirmationRow[]> = toSignal(
    collectionData(
      query(
        collection(this.firestore, 'trips'),
        where('boarding', '>=', this.threeMonthsAgoTimestamp()),
        orderBy('boarding', 'desc'),
      ),
      { idField: 'id' },
    ).pipe(
      // Transform: Trip[] → TripConfirmationRow[]
      // We use .map() inside the Observable pipe to transform in one pass,
      // keeping the subscription count at 1 (no inner Observable, no mergeMap).
      map((trips) => (trips as Trip[]).map(mapTripToConfirmationRow)),
    ),
    { initialValue: [] },
  );

  /**
   * Signal of all pending trips (boarding is null).
   * These have no date yet so they cannot be ordered by boarding time.
   * The mapper sets `isPending = true` on these, allowing the component
   * to sort them separately (e.g., push to bottom of table).
   */
  private readonly pendingTrips: Signal<TripConfirmationRow[]> = toSignal(
    collectionData(
      query(
        collection(this.firestore, 'trips'),
        where('boarding', '==', null),
      ),
      { idField: 'id' },
    ).pipe(
      map((trips) => (trips as Trip[]).map(mapTripToConfirmationRow)),
    ),
    { initialValue: [] },
  );

  // -------------------------------------------------------------------------
  // PUBLIC API
  // -------------------------------------------------------------------------

  /**
   * All rows for the confirmation table — recent trips + pending trips merged.
   *
   * LEARNING: WHY `computed()` INSTEAD OF A MERGED OBSERVABLE?
   * Because both `recentTrips` and `pendingTrips` are already Signals, we can
   * combine them with `computed()`. Angular tracks which Signals a `computed()`
   * reads and re-runs it only when one of them changes — no subscription
   * management, no `combineLatest`, no `takeUntilDestroyed`.
   */
  readonly allRows: Signal<TripConfirmationRow[]> = computed(() => [
    ...this.recentTrips(),
    ...this.pendingTrips(),
  ]);

  /**
   * Only rows where the trip is NOT yet confirmed (isActionable = true).
   * These are the rows the confirmation officer still needs to act on.
   */
  readonly actionableRows: Signal<TripConfirmationRow[]> = computed(() =>
    this.allRows().filter((row) => row.isActionable),
  );

  /**
   * Only rows where the trip IS already confirmed (isActionable = false).
   * These represent the confirmed/billed history view.
   */
  readonly confirmedRows: Signal<TripConfirmationRow[]> = computed(() =>
    this.allRows().filter((row) => !row.isActionable),
  );

  // -------------------------------------------------------------------------
  // PRIVATE HELPERS
  // -------------------------------------------------------------------------

  /**
   * Computes a Firestore Timestamp representing `HISTORY_MONTHS` months ago from now.
   * Called once at service construction — this is safe because `toSignal` and
   * the Firestore query are both set up once and kept alive by the live listener.
   *
   * If you need the window to be reactive (e.g. user can change it), promote
   * this to a `signal<number>()` and derive the query inside a `computed()`.
   */
  private threeMonthsAgoTimestamp(): Timestamp {
    const date = new Date();
    // Mutating month directly handles year roll-over correctly in JS
    // (e.g., month 0 - 3 = month -3, which JS normalises to October of the previous year).
    date.setMonth(date.getMonth() - this.HISTORY_MONTHS);
    return Timestamp.fromDate(date);
  }
}
