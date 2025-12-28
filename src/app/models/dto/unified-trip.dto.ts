import type { Port, TripType } from '../types';
import type { ChargeableEvent } from './chargeable-event.dto';

/**
 * Data Transfer Object combining trip and charge data into a unified view.
 * 
 * @remarks
 * This DTO merges data from two sources:
 * - **Unconfirmed Trips** from `/trips` collection (operational data)
 * - **Confirmed Charges** from `/charges` collection (financial records)
 * 
 * The unified view enables a single table/list to show both types of records,
 * with clear visual distinction between actionable (unconfirmed) and archived
 * (confirmed) entries.
 * 
 * **Why This Exists:**
 * Before the normalized schema, all data was in one collection. This DTO maintains
 * backward compatibility with UI components that expect a unified list while allowing
 * the backend to use the new, cleaner separation of concerns.
 * 
 * **Source Priority:**
 * - `source === 'Charge'` → Data from confirmed billing records (immutable)
 * - `source === 'Visit'` → Data from operational trips (can be edited/confirmed)
 * 
 * @see {@link Trip} for unconfirmed operational records
 * @see {@link Charge} for confirmed financial records
 * @see {@link ChargeableEvent} for the confirmation transformation
 * @see {UnifiedTripLogService.getUnifiedTripLog} for the merge logic
 * 
 * @example
 * ```typescript
 * // Unconfirmed trip (actionable)
 * const unconfirmedTrip: UnifiedTrip = {
 *   id: 'trip123',
 *   ship: 'MSC Oscar',
 *   gt: 195000,
 *   boarding: new Date('2024-01-15T14:30:00Z'),
 *   port: 'Foynes',
 *   pilot: 'John Smith',
 *   typeTrip: 'In',
 *   sailingNote: 'Strong ebb tide',
 *   extra: '',
 *   source: 'Visit',
 *   updatedBy: 'John Smith',
 *   updateTime: new Date(),
 *   isActionable: true,  // User can confirm this
 *   chargeableEvent: { ... }  // Full data for confirmation
 * };
 * 
 * // Confirmed charge (archived)
 * const confirmedCharge: UnifiedTrip = {
 *   id: 'charge456',
 *   ship: 'Ever Given',
 *   gt: 220000,
 *   boarding: new Date('2024-01-10T09:00:00Z'),
 *   port: 'Aughinish',
 *   pilot: 'Jane Doe',
 *   typeTrip: 'Out',
 *   sailingNote: 'Normal departure',
 *   extra: 'Tug assist',
 *   source: 'Charge',
 *   updatedBy: 'Jane Doe',
 *   updateTime: new Date('2024-01-10T12:00:00Z'),
 *   isActionable: false,  // Already billed, read-only
 *   chargeableEvent: undefined
 * };
 * ```
 */
export interface UnifiedTrip {
  /** Document ID (either trip ID or charge ID depending on source) */
  id?: string;
  
  // ─────────────────────────────────────────────────────────────
  // Common Fields (present in both trips and charges)
  // ─────────────────────────────────────────────────────────────
  
  /** Vessel name */
  ship: string;
  
  /** Gross Tonnage */
  gt: number;
  
  /** Pilot boarding time */
  boarding: Date;
  
  /** Port where service was rendered */
  port?: Port | null;
  
  /** Pilot who performed the service */
  pilot: string;
  
  /** Type of service */
  typeTrip: TripType;
  
  /** Extra billable services */
  extra: string;
  
  /** Operational notes from pilot */
  sailingNote: string;
  
  // ─────────────────────────────────────────────────────────────
  // Metadata
  // ─────────────────────────────────────────────────────────────
  
  /** 
   * Data source indicator:
   * - 'Visit' = Unconfirmed trip from operational records
   * - 'Charge' = Confirmed charge from financial records
   */
  source: 'Visit' | 'Charge';
  
  /** User who created/last updated this record */
  updatedBy: string;
  
  /** When this record was created/updated */
  updateTime: Date;
  
  // ─────────────────────────────────────────────────────────────
  // Actionability (UI behavior control)
  // ─────────────────────────────────────────────────────────────
  
  /** 
   * Whether user can take action on this record:
   * - `true` = Can confirm/edit (source === 'Visit')
   * - `false` = Read-only (source === 'Charge')
   */
  isActionable: boolean;
  
  /** 
   * Full chargeable event data for confirmation workflow.
   * Only populated when `isActionable === true`.
   */
  chargeableEvent?: ChargeableEvent;
}
