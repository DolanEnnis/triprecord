import { Timestamp } from '@angular/fire/firestore';

export type Port = 'Anchorage' | 'Cappa' | 'Moneypoint' | 'Tarbert' | 'Foynes' | 'Aughinish' | 'Shannon' | 'Limerick';

/**
 * Represents a single leg of a journey.
 */
export interface Trip {
  boarding: Timestamp;
  port?: Port | null;
  pilot: string;
  typeTrip: 'In' | 'Out' | 'Anchorage' | 'Shift'  | 'Other';
  preTripNote?: string;
  extra?: string;
  confirmed?: boolean;
  [key: string]: any;
}

/**
 * Represents a visit document from your Firestore 'visits' collection.
 * This model has been updated to use a 'trips' array for scalability.
 */
export interface Visit {
  docid: string;
  ship: string;
  gt: number;
  shipnote?: string;
  // New property for the updated model
  trips?: Trip[];
  // Keep old properties optional for backward compatibility
  inward?: Trip;
  outward?: Trip;
  inwardConfirmed?: boolean;
  outwardConfirmed?: boolean;
  [key: string]: any;
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
  sailingNote: string; // For comments on the sailing, entered by user.
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
  id?: string; // Firestore document ID, only for trips from 'charges'
  // Common fields
  ship: string;
  gt: number;
  boarding: Date;
  port?: Port | null;
  pilot: string;
  typeTrip: 'In' | 'Out' | 'Anchorage' | 'Shift' | 'Other';
  extra: string;
  sailingNote: string; // For comments on the sailing.
  // Metadata
  source: 'Visit' | 'Charge';
  updatedBy: string;
  updateTime: Date;
  // Actionability
  isActionable: boolean;
  chargeableEvent?: ChargeableEvent; // Original event to pass to the dialog
}
