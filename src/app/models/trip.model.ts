import { Timestamp } from '@angular/fire/firestore';

export type Port = 'Anchorage' | 'Cappa' | 'Moneypoint' | 'Tarbert' | 'Foynes' | 'Aughinish' | 'Shannon' | 'Limerick';

/**
 * Represents a single leg of a journey (inward or outward).
 * This is a nested map within a Visit document.
 */
export interface Trip {
  boarding: Timestamp;
  port?: Port | null;
  pilot: string;
  typeTrip: 'In' | 'Out' | 'Anchorage' | 'Shift'  | 'Other';
  note?: string;
  extra?: string;
  [key: string]: any; // Allow other properties
}

/**
 * Represents a visit document from your Firestore 'visits' collection.
 */
export interface Visit {
  docid: string;
  ship: string;
  gt: number;
  inward?: Trip;
  outward?: Trip;
  inwardConfirmed?: boolean;
  outwardConfirmed?: boolean;
  [key: string]: any; // Allow other properties
}

/**
 * A flattened, view-friendly object representing a single chargeable trip.
 * This will be used to populate the table in the MainComponent.
 */
export interface ChargeableEvent {
  visitDocId: string;
  ship: string;
  gt: number;
  boarding: Date;
  port?: Port | null;
  pilot: string;
  typeTrip: 'In' | 'Out' | 'Anchorage' | 'Shift'  | 'Other';
  note: string;
  extra: string;
  tripDirection: 'inward' | 'outward';
  isConfirmed: boolean;
}

/** Represents a charge document in your 'charges' collection. */
export type Charge = Omit<ChargeableEvent, 'visitDocId' | 'tripDirection' | 'boarding' | 'isConfirmed'> & {
  id?: string,
  boarding: Date,
  updateTime: Date,
  createdBy?: string, // User display name
  createdById?: string, // User UID
};

/** A unified model representing an entry from either visits or charges. */
export interface UnifiedTrip {
  // Common fields
  ship: string;
  gt: number;
  boarding: Date;
  port?: Port | null;
  pilot: string;
  typeTrip: 'In' | 'Out' | 'Anchorage' | 'Shift' | 'Other';
  note: string;
  extra: string;
  // Metadata
  source: 'Visit' | 'Charge';
  updatedBy: string;
  updateTime: Date;
  // Actionability
  isActionable: boolean;
  chargeableEvent?: ChargeableEvent; // Original event to pass to the dialog
}
