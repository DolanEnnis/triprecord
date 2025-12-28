import type { Port, TripType, TripDirection } from '../types';

/**
 * Data Transfer Object representing a trip ready for billing confirmation.
 * 
 * @remarks
 * This DTO transforms {@link Trip} and {@link Visit} data into a flat structure
 * optimized for the charge creation workflow. It serves as an intermediate format
 * between operational trip data and financial {@link Charge} records.
 * 
 * **Transformation Rules:**
 * - `Trip.pilotNotes` → `sailingNote`
 * - `Trip.extraChargesNotes` → `extra`
 * - `Trip.boarding` (Timestamp) → `boarding` (Date)
 * - `Trip.typeTrip` → `tripDirection` (derived mapping)
 * - Visit fields are denormalized for display
 * 
 * **Use Cases:**
 * - Trip Confirmation UI displays list of ChargeableEvents
 * - User reviews and confirms trips before creating Charges
 * - Acts as preview of what will be billed
 * 
 * @see {@link Trip} for the source operational data
 * @see {@link Charge} for the final immutable billing record
 * @see {UnifiedTripLogService} for transformation logic
 * 
 * @example
 * ```typescript
 * const chargeableEvent: ChargeableEvent = {
 *   tripId: 'trip123',
 *   visitId: 'visit456',
 *   ship: 'MSC Oscar',
 *   gt: 195000,
 *   boarding: new Date('2024-01-15T14:30:00Z'),
 *   port: 'Foynes',
 *   pilot: 'John Smith',
 *   typeTrip: 'In',
 *   sailingNote: 'Strong ebb tide, required tug',
 *   extra: 'Detained 2 hours',
 *   tripDirection: 'inward',
 *   isConfirmed: false  // User hasn't confirmed yet
 * };
 * ```
 */
export interface ChargeableEvent {
  /** ID of the source Trip document (optional for standalone charges) */
  tripId?: string;
  
  /** ID of the parent Visit document */
  visitId: string;
  
  /** Vessel name (denormalized from Visit) */
  ship: string;
  
  /** Gross Tonnage (denormalized from Visit) */
  gt: number;
  
  /** Pilot boarding time (converted from Timestamp to Date) */
  boarding: Date;
  
  /** Port where service was rendered */
  port?: Port | null;
  
  /** Pilot who performed the service */
  pilot: string;
  
  /** Type of service (In, Out, Shift, etc.) */
  typeTrip: TripType;
  
  /** Operational notes from pilot (mapped from Trip.pilotNotes) */
  sailingNote: string;
  
  /** Extra billable services (mapped from Trip.extraChargesNotes) */
  extra: string;
  
  /** Direction derived from typeTrip (inward/outward/other) */
  tripDirection: TripDirection;
  
  /** Whether this trip has been confirmed and converted to a Charge */
  isConfirmed: boolean;
}
