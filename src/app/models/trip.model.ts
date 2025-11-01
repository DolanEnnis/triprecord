import { Timestamp } from '@angular/fire/firestore';
// Import necessary types from the normalized database schema
import { TripType, Port } from './data.model';

/**
 * 🛑 REMOVED: interface ShipInfo - Use Ship from data.model.ts
 * 🛑 REMOVED: interface Trip (old model) - Use Trip from data.model.ts
 * 🛑 REMOVED: interface Visit (old model) - Use Visit from data.model.ts
 */

/**
 * A flattened, view-friendly object representing a single chargeable trip.
 * This DTO is now based purely on the new /trips and /visits data.
 */
export interface ChargeableEvent {
  tripId?: string; // ID of the trip from the new /trips collection
  visitId: string; // The parent visit's ID (renamed from old visitDocId)
  ship: string;
  gt: number;
  boarding: Date;
  port?: Port | null;
  pilot: string;
  typeTrip: TripType;
  sailingNote: string; // Mapped from Trip.pilotNotes
  extra: string; // Mapped from Trip.extraChargesNotes
  // Updated to allow 'other' as tripDirection is now derived from typeTrip
  tripDirection: 'inward' | 'outward' | 'other';
  isConfirmed: boolean;
}

/** Represents a charge document in your 'charges' collection. */
export type Charge = Omit<
  ChargeableEvent,
  'visitId' | 'tripDirection' | 'boarding' | 'isConfirmed'
> & {
  id?: string,
  boarding: Date,
  updateTime: Date,
  createdBy?: string, // User display name
  createdById?: string, // User UID
};

/** A unified model representing an entry from either trips or charges. */
export interface UnifiedTrip {
  id?: string;
  // Common fields
  ship: string;
  gt: number;
  boarding: Date;
  port?: Port | null;
  pilot: string;
  typeTrip: TripType;
  extra: string;
  sailingNote: string;
  // Metadata
  source: 'Visit' | 'Charge';
  updatedBy: string;
  updateTime: Date;
  // Actionability
  isActionable: boolean;
  chargeableEvent?: ChargeableEvent;
}
