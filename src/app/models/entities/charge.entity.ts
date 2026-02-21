import type { Port, TripType } from '../types';

/**
 * Charge entity representing a finalized, immutable billing record.
 * 
 * @remarks
 * Charges are created from confirmed {@link Trip} documents and serve as the
 * authoritative financial record for pilotage services. Once created, charges
 * should not be modified (create new charge if correction needed).
 * 
 * **Key Differences from Trip:**
 * - Uses `Date` instead of Firestore `Timestamp`
 * - Flat structure optimized for export/reporting
 * - Immutable after creation
 * - Includes audit trail (createdBy, createdById)
 * 
 * @firestore Collection path: `/charges`
 * 
 * @see {@link Trip} for operational trip records
 * @see {@link ChargeableEvent} for the transformation DTO
 * 
 * @example
 * ```typescript
 * const charge: Charge = {
 *   tripId: 'trip123',
 *   ship: 'MSC Oscar',
 *   gt: 195000,
 *   boarding: new Date('2024-01-15T14:30:00Z'),
 *   port: 'Foynes',
 *   pilot: 'John Smith',
 *   typeTrip: 'In',
 *   sailingNote: 'Strong ebb tide',
 *   extra: 'Detained 2 hours',
 *   updateTime: new Date(),
 *   createdBy: 'John Smith',
 *   createdById: 'user123'
 * };
 * ```
 */
export interface Charge {
  /** Firestore document ID (auto-generated) */
  id?: string;
  
  /** Optional reference to the source Trip document */
  tripId?: string;

  /** Reference to the parent visit ID (required for navigation) */
  visitId?: string;
  
  /** Vessel name (denormalized for reporting) */
  ship: string;
  
  /** Gross Tonnage (used for fee calculation) */
  gt: number;
  
  /** Pilot boarding time (JavaScript Date for easy export) */
  boarding: Date;
  
  /** Port where service was rendered */
  port?: Port | null;
  
  /** Pilot who performed the service */
  pilot: string;
  
  /** Type of service rendered */
  typeTrip: TripType;
  
  /** Operational notes from the pilot */
  sailingNote: string;
  
  /** Details of extra billable services */
  extra: string;
  
  /** When this charge record was created/last updated */
  updateTime: Date;
  
  /** Display name of user who created this charge */
  createdBy?: string;
  
  /** Firebase UID of user who created this charge */
  createdById?: string;
}
