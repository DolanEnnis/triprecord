import { FieldValue, Timestamp } from '@angular/fire/firestore';

/**
 * Ship entity representing a vessel in the master ships database.
 * 
 * @remarks
 * This is the single source of truth for vessel characteristics across the system.
 * All ship data should reference this collection via `shipId` to maintain data consistency.
 * 
 * @firestore Collection path: `/ships`
 * 
 * @example
 * ```typescript
 * const ship: Ship = {
 *   shipName: 'MSC Oscar',
 *   shipName_lowercase: 'msc oscar',
 *   grossTonnage: 195000,
 *   imoNumber: 9703291,
 *   marineTrafficLink: 'https://www.marinetraffic.com/...',
 *   shipNotes: 'Regular caller, prefers Foynes berth',
 *   createdAt: serverTimestamp(),
 *   updatedAt: serverTimestamp()
 * };
 * ```
 */
export interface Ship {
  /** Firestore document ID (auto-generated) */
  id?: string;
  
  /** Official vessel name as registered */
  shipName: string;
  
  /** Lowercase version of ship name for case-insensitive queries */
  shipName_lowercase?: string;
  
  /** Gross Tonnage - used for pilotage fee calculations */
  grossTonnage: number;
  
  /** International Maritime Organization number (unique vessel identifier) */
  imoNumber?: number | null;
  
  /** URL to MarineTraffic or similar tracking service */
  marineTrafficLink?: string | null;
  
  /** General notes about the vessel (e.g., berth preferences, operational notes) */
  shipNotes?: string | null;

  /** Timestamp when this ship record was first created */
  createdAt: Timestamp | FieldValue;
  
  /** Timestamp when this ship record was last modified */
  updatedAt: Timestamp | FieldValue;
}
