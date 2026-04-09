import { Timestamp } from '@angular/fire/firestore';
import type { Trip } from '../entities/trip.entity';
import type { TripConfirmationRow } from '../view/trip-confirmation-row.view';

/**
 * Maps a raw Firestore `Trip` document to a flat `TripConfirmationRow` view model.
 *
 * @remarks
 * This is a **pure function** — it has no side effects, no injected dependencies,
 * and always produces the same output for the same input. This makes it trivially
 * unit-testable without needing TestBed or mocked services.
 *
 * **Severance Contract:**
 * This function MUST NOT import or reference:
 *  - `UnifiedTrip`
 *  - `Charge`
 *  - `ChargeableEvent`
 *  - Any `/charges` or `/visits` collection data
 *
 * All field values are derived exclusively from the single `Trip` argument.
 *
 * **Field Priority Rules (applied in this function):**
 * - `updatedBy`: `lastModifiedBy` → `confirmedBy` → `recordedBy`
 * - `updateTime`: `lastModifiedAt` → `confirmedAt` → `recordedAt`
 *
 * @param trip - A `Trip` document fetched from Firestore, with its `id` populated.
 * @returns A flat `TripConfirmationRow` ready for the Angular Material table to render.
 *
 * @example
 * ```typescript
 * // In a service, transform a stream of Trip documents:
 * trips$.pipe(
 *   map(trips => trips.map(mapTripToConfirmationRow))
 * )
 * ```
 */
export function mapTripToConfirmationRow(trip: Trip): TripConfirmationRow {
  // -----------------------------------------------------------------------
  // AUDIT FIELD RESOLUTION
  // We resolve `updatedBy` and `updateTime` in a single pass using the
  // priority chain. `??` (nullish coalescing) moves to the next candidate
  // only if the current value is null or undefined — an empty string would
  // still "win" (which is intentional: an empty confirmedBy beats a stale recordedBy).
  // -----------------------------------------------------------------------

  const updatedBy: string =
    trip.lastModifiedBy ??
    trip.confirmedBy ??
    trip.recordedBy;

  // Resolve the matching timestamp using the same priority chain.
  // Each field may be a Firestore Timestamp, a FieldValue sentinel, or null/undefined.
  // We use a helper (below) to safely convert to a JS Date.
  const rawUpdateTime =
    trip.lastModifiedAt ??
    trip.confirmedAt ??
    trip.recordedAt;

  const updateTime: Date = toDate(rawUpdateTime);

  // -----------------------------------------------------------------------
  // BOARDING CONVERSION
  // Firestore stores `boarding` as a Timestamp (or null for pending trips).
  // The view model uses JS Date so the template doesn't need to know about
  // Firestore types at all — that knowledge stays locked in this mapper.
  // -----------------------------------------------------------------------

  const boarding: Date | null =
    trip.boarding instanceof Timestamp ? trip.boarding.toDate() : null;

  // -----------------------------------------------------------------------
  // DERIVED BOOLEANS  (computed once here, never re-computed in the template)
  // -----------------------------------------------------------------------

  // THE NEW PIVOT: read the boolean, don't check source strings.
  // An unconfirmed trip IS actionable (can be edited/confirmed/charged).
  const isActionable: boolean = !trip.isConfirmed;

  // A pending trip is one where the pilot hasn't boarded yet.
  // Used as a secondary sort key: pending rows are pushed to the bottom.
  const isPending: boolean = trip.boarding === null;

  // -----------------------------------------------------------------------
  // DATA QUALITY WARNINGS
  // These are generated locally at map time and are never persisted to Firestore.
  // They surface data issues to the user without polluting the source document.
  // -----------------------------------------------------------------------

  const dataWarnings: string[] = [];

  if (!trip.gt || trip.gt <= 0) {
    // GT is required for accurate fee calculation — missing it is a billing risk.
    dataWarnings.push('Missing GT — fee calculation may be incorrect');
  }
  if (!trip.port) {
    dataWarnings.push('Port not set');
  }
  if (!trip.shipName) {
    // This should never happen for a confirmed trip, but guards unconfirmed edge cases.
    dataWarnings.push('Ship name missing');
  }

  // -----------------------------------------------------------------------
  // ASSEMBLE THE VIEW MODEL
  // Every field is named exactly as the template/table columns expect.
  // No logic in the template — only property access.
  // -----------------------------------------------------------------------

  return {
    // Identity
    id: trip.id!,          // id is always present after a Firestore fetch
    visitId: trip.visitId, // may be undefined for standalone trips

    // Display fields (direct mapping)
    ship:       trip.shipName ?? '',
    gt:         trip.gt        ?? 0,
    boarding,
    port:       trip.port      ?? null,
    pilot:      trip.pilot,
    typeTrip:   trip.typeTrip,
    sailingNote: trip.pilotNotes        ?? '',
    extra:       trip.extraChargesNotes ?? '',

    // Derived
    isActionable,
    isPending,

    // Audit
    updatedBy,
    updateTime,

    // Docket (optional)
    docketUrl:  trip.docketUrl,
    docketType: trip.docketType,

    // Data quality warnings (empty array = no issues)
    dataWarnings: dataWarnings.length > 0 ? dataWarnings : undefined,
  };
}

// ---------------------------------------------------------------------------
// PRIVATE HELPERS
// ---------------------------------------------------------------------------

/**
 * Safely converts a Firestore Timestamp, FieldValue sentinel, Date, or
 * null/undefined to a plain JS Date.
 *
 * `FieldValue` (e.g. `serverTimestamp()`) is a write-time placeholder that
 * Firestore resolves on the server. When reading back, Firestore returns
 * a real `Timestamp` — but defensively we treat any non-Timestamp value
 * as "now" so we never crash on a partially-written document.
 *
 * @param value - Any timestamp-like value from a Firestore document field.
 * @returns A valid JS Date (falls back to `new Date()` if unresolvable).
 */
function toDate(value: unknown): Date {
  if (value instanceof Timestamp) {
    return value.toDate();
  }
  if (value instanceof Date) {
    return value;
  }
  // Fallback: server sentinel not yet resolved, or field is missing.
  // Using "now" is the safest choice — it prevents sorting anomalies
  // where a null date drifts to the top or bottom incorrectly.
  return new Date();
}
