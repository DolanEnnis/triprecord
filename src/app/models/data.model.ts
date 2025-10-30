// src/app/models/data.model.ts (The new, normalized data model)

import { Timestamp } from '@angular/fire/firestore';

/**
 * ----------------------------------------------------------------
 * CORE TYPES (Shared Enums/Unions)
 * ----------------------------------------------------------------
 */

// Port locations remain the same for consistency
export type Port = 'Anchorage' | 'Cappa' | 'Moneypoint' | 'Tarbert' | 'Foynes' | 'Aughinish' | 'Shannon' | 'Limerick';

// Defines the type of service rendered (Chargeable Event)
export type TripType = 'In' | 'Out' | 'Anchorage' | 'Shift' | 'BerthToBerth' | 'Other';

// Defines the current state of a vessel's visit (State Machine)
export type VisitStatus = 'Due' | 'Awaiting Berth' | 'Alongside' | 'Sailed' | 'Cancelled';


/**
 * ----------------------------------------------------------------
 * COLLECTION: /ships (Master Vessel Data)
 * ----------------------------------------------------------------
 * Contains permanent, historical information about a vessel.
 * This is your source of truth for vessel characteristics.
 */
export interface Ship {
  id?: string;                 // Firestore Document ID
  shipName: string;
  grossTonnage: number;
  imoNumber?: number | null;
  marineTrafficLink?: string | null;
  shipNotes?: string | null;   // General notes about the vessel

  // Audit Fields
  createdAt: Timestamp;
  updatedAt: Timestamp;
}


/**
 * ----------------------------------------------------------------
 * COLLECTION: /visits (The State Machine)
 * ----------------------------------------------------------------
 * Tracks the overall status and lifecycle of a ship's stay.
 * References a Ship document and acts as the parent for all Trips.
 */
export interface Visit {
  id?: string;                  // Firestore Document ID
  shipId: string;               // **Reference to /ships/{shipId}**

  // Denormalized fields for simple UI display/querying
  shipName: string;
  grossTonnage: number;

  // Visit Status
  currentStatus: VisitStatus;
  initialEta: Timestamp;        // The planned arrival date
  berthPort?: Port | null;      // The current/intended location

  // State Change & Audit
  statusLastUpdated: Timestamp;
  updatedBy: string;            // User display name/Pilot recording the status
  visitNotes?: string | null;   // Notes specific to this port call
}


/**
 * ----------------------------------------------------------------
 * COLLECTION: /trips (The Atomic, Chargeable Event)
 * ----------------------------------------------------------------
 * Represents every single pilot movement/service.
 * This is the unit you bill for, and it must reference its parent Visit.
 */
export interface Trip {
  id?: string;                  // Firestore Document ID
  visitId: string;              // **Reference to /visits/{visitId}**
  shipId: string;               // Denormalized ID for easy lookups/queries

  // Core Trip Details
  typeTrip: TripType;           // e.g., 'In', 'Shift', 'Out'
  boarding: Timestamp;          // The time the service began
  pilot: string;                // Pilot who performed the service

  // Movement Details
  fromPort?: Port | null;       // Source port (optional, useful for 'Shift')
  toPort?: Port | null;         // Destination port (renamed from old Trip.port for clarity)

  // Notes & Billing
  pilotNotes?: string;          // Pilot's internal log/notes (from old preTripNote/sailingNote)
  extraChargesNotes?: string;    // Details for extra services (from old extra)
  isConfirmed: boolean;         // Has this specific trip been confirmed for billing?

  // New optional fields
  ownNote?: string;
  pilotNo?: number;
  monthNo?: number;
  car?: string;
  timeOff?: Timestamp;
  good?: number;

  // Audit Fields
  recordedBy: string;
  recordedAt: Timestamp;
}
