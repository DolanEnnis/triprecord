import { FieldValue, Timestamp } from '@angular/fire/firestore';
import type { TripType, Port } from '../types';

/**
 * Trip entity representing a single billable pilot movement/service.
 * 
 * @remarks
 * This is the atomic unit of work for pilotage billing. Each movement of a vessel
 * (In, Out, Shift, etc.) creates a separate Trip document. All trips must reference
 * a parent {@link Visit} document.
 * 
 * **Trip is the single source of truth for billing.** When a trip is confirmed,
 * the billing fields (shipName, gt, confirmedBy, etc.) are populated and
 * isConfirmed is set to true.
 * 
 * **Typical Trip Lifecycle:**
 * 1. Created with `boarding = null` when visit is scheduled
 * 2. Updated with actual `boarding` time when pilot boards
 * 3. Confirmed for billing: `isConfirmed = true` + billing fields populated
 * 
 * @firestore Collection path: `/trips`
 * 
 * @see {@link Visit} for the parent port call
 * @see {@link TripType} for valid trip types
 * 
 * @example
 * ```typescript
 * // Inward trip (bringing ship into port)
 * const inwardTrip: Trip = {
 *   visitId: 'visit123',
 *   shipId: 'ship456',
 *   typeTrip: 'In',
 *   boarding: Timestamp.fromDate(new Date('2024-01-15T14:30:00Z')),
 *   pilot: 'John Smith',
 *   port: 'Foynes',
 *   pilotNotes: 'Strong ebb tide, required tug assistance',
 *   extraChargesNotes: 'Detained 2 hours',
 *   isConfirmed: false,
 *   recordedBy: 'John Smith',
 *   recordedAt: serverTimestamp()
 * };
 * ```
 */
export interface Trip {
  /** Firestore document ID (auto-generated) */
  id?: string;
  
  /** 
   * Foreign key reference to parent {@link Visit}.
   * Optional: standalone trips (e.g., created via "Create Charge" flow) 
   * may not have an associated visit.
   */
  visitId?: string;
  
  /** 
   * Denormalized ship ID for direct queries without joining.
   * Optional for standalone trips where ship may only be identified by name.
   */
  shipId?: string;

  /** Type of pilot service (In, Out, Shift, Anchorage, etc.) */
  typeTrip: TripType;
  
  /** 
   * Pilot boarding time (ETB for inward, ETS for outward).
   * `null` until the actual time is known.
   */
  boarding: Timestamp | null;
  
  /** Pilot who performed this service */
  pilot: string;

  /** 
   * Port relevant to this movement:
   * - For 'In': destination berth
   * - For 'Out': origin berth
   * - For 'Shift': destination berth
   */
  port?: Port | null;

  /** Pilot's operational notes (weather, tides, issues encountered) */
  pilotNotes?: string;
  
  /** Details of extra billable services (delays, tugs, etc.) */
  extraChargesNotes?: string;
  
  /** Whether this trip has been confirmed and is ready for billing */
  isConfirmed: boolean;

  /** Pilot's private notes (not shown to port authority) */
  ownNote?: string | null;
  
  /** Pilot's internal reference number for this trip */
  pilotNo?: number | null;
  
  /** Month number for pilot's accounting */
  monthNo?: number | null;
  
  /** Vehicle/transport used by pilot */
  car?: string | null;
  
  /** Time when pilot was released from duty */
  timeOff?: Timestamp | null;
  
  /** Pilot's rating of the job (internal metric) */
  good?: number | null;

  // ============================================
  // BILLING FIELDS (previously only in /charges)
  // ============================================
  
  /** 
   * Denormalized ship name for billing exports.
   * Populated when trip is confirmed to avoid joins in billing queries.
   */
  shipName?: string;
  
  /** 
   * Gross Tonnage - used for fee calculation.
   * Required for billing; copied from Ship record when confirmed.
   */
  gt?: number;
  
  /** 
   * Display name of user who confirmed this trip for billing.
   * Only set when isConfirmed = true.
   */
  confirmedBy?: string;
  
  /** 
   * Firebase UID of user who confirmed this trip.
   * Used for audit trail.
   */
  confirmedById?: string;
  
  /** 
   * Timestamp when this trip was confirmed for billing.
   * Only set when isConfirmed = true.
   */
  confirmedAt?: Timestamp | FieldValue;

  // ============================================
  // AUDIT FIELDS
  // ============================================

  /** User who created this trip record */
  recordedBy: string;
  
  /** Timestamp when this trip was recorded */
  recordedAt: Timestamp | FieldValue;

  /** User who last updated this trip record */
  lastModifiedBy?: string;
  
  /** Timestamp when this trip was last updated */
  lastModifiedAt?: Timestamp | FieldValue;

  /* ========================================================================
   * MIGRATION METADATA (Optional)
   * Fields used to track records migrated from legacy /charges collection
   * ======================================================================== */
  
  /** Source of the record if migrated (e.g., 'migration') */
  source?: string;
  
  /** Original Charge ID if migrated from /charges */
  migratedFromChargeId?: string;
}
