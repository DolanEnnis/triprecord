import type { Port, TripType } from '../types';

/**
 * View Model for a single row in the Trip Confirmation table.
 *
 * @remarks
 * This interface is the **single contract** between the data layer (Firestore /trips)
 * and the Trip Confirmation UI. It is intentionally flat so the Angular Material table
 * template can render every cell without any conditional logic or joins.
 *
 * **Architectural Rule — The Severance Contract:**
 * This file MUST NOT import from:
 *  - `UnifiedTrip` (unified-trip.dto.ts)
 *  - `Charge` (charge.entity.ts)
 *  - `ChargeableEvent` (chargeable-event.dto.ts)
 *
 * All fields are derived exclusively from the `/trips` Firestore collection
 * (see `trip.entity.ts`). Mapping from `Trip` → `TripConfirmationRow` is the
 * responsibility of the V2 service/mapper, not this interface.
 *
 * @see {@link Trip} for the raw Firestore entity this is derived from
 * @see {@link TripType} for valid values of `typeTrip`
 * @see {@link Port} for valid values of `port`
 *
 * @example
 * ```typescript
 * // A confirmed inward trip — isActionable is false, the row's buttons are disabled.
 * const confirmedRow: TripConfirmationRow = {
 *   id: 'trip_abc123',
 *   visitId: 'visit_xyz789',
 *   ship: 'MV Atlantic',
 *   gt: 12500,
 *   boarding: new Date('2024-01-15T14:30:00Z'),
 *   port: 'Foynes',
 *   pilot: 'John Smith',
 *   typeTrip: 'In',
 *   sailingNote: 'Strong ebb tide',
 *   extra: 'Detained 2 hours',
 *   isActionable: false,   // trip.isConfirmed was TRUE → NOT actionable
 *   isPending: false,      // boarding was NOT null → NOT pending
 *   updatedBy: 'John Smith',
 *   updateTime: new Date('2024-01-15T18:00:00Z'),
 * };
 * ```
 */
export interface TripConfirmationRow {
  // ============================================================
  // IDENTITY
  // ============================================================

  /** The pure Firestore document ID of the Trip (`trip.id`). */
  id: string;

  /**
   * Parent Visit document ID (`trip.visitId`).
   * Passed directly to dialogs (e.g., Edit, Create Charge) to ensure
   * they operate on the correct underlying Visit — we never reconstruct
   * a legacy payload, we pass IDs and let the dialog fetch what it needs.
   */
  visitId?: string;

  // ============================================================
  // DISPLAY FIELDS  (1:1 mapping from Trip document)
  // ============================================================

  /** Ship name → mapped from `trip.shipName` */
  ship: string;

  /** Gross Tonnage → mapped from `trip.gt` */
  gt: number;

  /**
   * Pilot boarding time → converted from `trip.boarding` (Firestore Timestamp → JS Date).
   * `null` means the time is not yet known (trip is still scheduled / pending).
   */
  boarding: Date | null;

  /** Port of service → mapped from `trip.port` */
  port: Port | null;

  /** Pilot who performed the service → mapped from `trip.pilot` */
  pilot: string;

  /** Type of pilot service (In, Out, Shift, etc.) → mapped from `trip.typeTrip` */
  typeTrip: TripType;

  /** Pilot's operational notes → mapped from `trip.pilotNotes` */
  sailingNote: string;

  /** Details of extra billable services → mapped from `trip.extraChargesNotes` */
  extra: string;

  // ============================================================
  // DERIVED / COMPUTED FIELDS  (calculated once in the mapper)
  // ============================================================

  /**
   * THE NEW PIVOT — replaces the old `source === 'Charge'` check.
   *
   * `true`  → trip is unconfirmed (`trip.isConfirmed === false`), so the UI
   *           should show the Confirm / Edit / Charge action buttons.
   * `false` → trip is confirmed, row is read-only, buttons are hidden/disabled.
   *
   * Formula: `isActionable = !trip.isConfirmed`
   */
  isActionable: boolean;

  /**
   * `true` if `trip.boarding` was `null` at the time of mapping.
   * Used as a secondary sort key: pending rows (no boarding time) are
   * pushed to the bottom of the table, below rows with a real datetime.
   *
   * Formula: `isPending = trip.boarding === null`
   */
  isPending: boolean;

  // ============================================================
  // AUDIT & METADATA
  // (Priority: lastModifiedBy > confirmedBy > recordedBy)
  // ============================================================

  /**
   * Human-readable display name of the last person who touched this record.
   * Resolved in the mapper with the following priority:
   *   1. `trip.lastModifiedBy` (most recent edit)
   *   2. `trip.confirmedBy`    (billing confirmation)
   *   3. `trip.recordedBy`     (original creation)
   */
  updatedBy: string;

  /**
   * Timestamp of the last meaningful change to this record.
   * Resolved in the mapper with the following priority (Timestamp → JS Date):
   *   1. `trip.lastModifiedAt`
   *   2. `trip.confirmedAt`
   *   3. `trip.recordedAt`
   */
  updateTime: Date;

  // ============================================================
  // DOCKET (OPTIONAL)
  // ============================================================

  /** Firebase Storage download URL for the attached docket → `trip.docketUrl` */
  docketUrl?: string;

  /**
   * Drives the docket viewer:
   * - `'image'` → thumbnail + lightbox
   * - `'pdf'`   → "View PDF" button
   *
   * Mapped from `trip.docketType`.
   */
  docketType?: 'image' | 'pdf';

  // ============================================================
  // DATA QUALITY WARNINGS  (generated locally in the UI/mapper)
  // ============================================================

  /**
   * Optional array of human-readable warning strings generated at mapping time.
   * These are NOT persisted to Firestore — they are computed fresh on each load
   * to surface data issues (e.g., missing GT, unrecognised port) without
   * polluting the source document.
   *
   * @example ['Missing GT — fee calculation may be incorrect', 'Port not set']
   */
  dataWarnings?: string[];
}
