import { inject, Injectable } from '@angular/core';
import { ShipRepository } from '../repositories/ship.repository';
import { VisitRepository } from '../repositories/visit.repository';
import { TripRepository } from '../repositories/trip.repository';
import { Ship } from '../../models';

/**
 * Result of a ship merge operation.
 * 
 * LEARNING: WHY RETURN A RESULT OBJECT?
 * Returning a structured result allows the UI to display meaningful
 * feedback to the admin about what was changed. This is better than
 * just returning void because:
 * - Admin can verify the expected number of visits were migrated
 * - Provides data for audit logging
 * - Easier to debug if something goes wrong
 */
export interface MergeResult {
  /** Number of visit documents updated */
  visitsMigrated: number;
  /** Number of trip documents updated */
  tripsMigrated: number;
  /** Whether the source ship was successfully deleted */
  sourceShipDeleted: boolean;
  /** Combined notes if notes were merged */
  mergedNotes?: string;
}

/**
 * Data needed to perform a ship merge.
 */
export interface MergeShipData {
  /** The ship to keep (target) */
  targetShip: Ship;
  /** The ship to absorb and delete (source) */
  sourceShip: Ship;
  /** Which GT to use for the merged ship */
  selectedGrossTonnage: number;
  /** Whether to merge notes from both ships */
  mergeNotes: boolean;
}

/**
 * ShipMergeService - Orchestrates merging duplicate ship records.
 * 
 * LEARNING: WORKFLOW SERVICES vs REPOSITORIES
 * - Repositories: Single data source, CRUD operations only
 * - Workflow Services: Coordinate operations across multiple repositories
 * 
 * This service ensures that merging ships is done in the correct order:
 * 1. Optionally merge notes from source into target
 * 2. Migrate all visits from source → target (updates denormalized fields)
 * 3. Migrate all trips from source → target (updates shipId)
 * 4. Delete the source ship
 * 
 * If any step fails, the operation stops but partial changes may exist.
 * For full transactionality, we'd need Firestore transactions, but they
 * have a 500 write limit which could be exceeded with many visits.
 */
@Injectable({ providedIn: 'root' })
export class ShipMergeService {
  private readonly shipRepository = inject(ShipRepository);
  private readonly visitRepository = inject(VisitRepository);
  private readonly tripRepository = inject(TripRepository);

  /**
   * Merges sourceShip INTO targetShip.
   * 
   * This operation:
   * 1. Updates target ship's notes and GT if needed
   * 2. Migrates all visits from source to target
   * 3. Migrates all trips from source to target
   * 4. Deletes the source ship
   * 
   * @param mergeData The merge configuration
   * @returns Result object with counts of migrated records
   */
  async mergeShips(mergeData: MergeShipData): Promise<MergeResult> {
    const { targetShip, sourceShip, selectedGrossTonnage, mergeNotes } = mergeData;
    
    if (!targetShip.id || !sourceShip.id) {
      throw new Error('Both ships must have valid IDs');
    }
    
    // Step 1: Prepare merged notes if requested
    let mergedNotes: string | undefined;
    if (mergeNotes && sourceShip.shipNotes) {
      // Combine notes from both ships, separating with a divider
      const targetNotes = targetShip.shipNotes?.trim() || '';
      const sourceNotes = sourceShip.shipNotes?.trim() || '';
      
      if (targetNotes && sourceNotes) {
        // Both have notes - combine them
        mergedNotes = `${targetNotes}\n---\n${sourceNotes}`;
      } else {
        // Only one has notes - use whichever has content
        mergedNotes = targetNotes || sourceNotes;
      }
    }
    
    // Step 2: Update target ship with merged data
    const shipUpdateData: Partial<Ship> = {
      grossTonnage: selectedGrossTonnage,
    };
    
    if (mergedNotes !== undefined) {
      shipUpdateData.shipNotes = mergedNotes;
    }
    
    await this.shipRepository.updateShip(targetShip.id, shipUpdateData);
    
    // Step 3: Migrate all visits from source to target
    // This updates shipId, shipName, and grossTonnage on all visits
    const visitsMigrated = await this.visitRepository.migrateVisitsToShip(
      sourceShip.id,
      targetShip.id,
      targetShip.shipName,
      selectedGrossTonnage
    );
    
    // Step 4: Migrate all trips from source to target
    // This updates the shipId field on all trips
    const tripsMigrated = await this.tripRepository.migrateTripsToShip(
      sourceShip.id,
      targetShip.id
    );
    
    // Step 5: Delete the source ship
    // Only do this after visits and trips are successfully migrated
    await this.shipRepository.deleteShip(sourceShip.id);
    
    return {
      visitsMigrated,
      tripsMigrated,
      sourceShipDeleted: true,
      mergedNotes
    };
  }

  /**
   * Extracts the ship ID from a MarineTraffic link.
   * 
   * LEARNING: PARSING MT LINKS TO DETECT SAME VESSEL
   * MarineTraffic URLs contain a unique ship ID like "/shipid:8583597"
   * If two ships have the same MT ID, they're definitely the same vessel.
   * If they differ, warn the admin - it might be an error.
   * 
   * @param link The MarineTraffic URL
   * @returns The ship ID if found, null otherwise
   */
  extractMarineTrafficId(link: string | null | undefined): string | null {
    if (!link) return null;
    
    // Pattern matches /shipid:1234567 or similar
    const match = link.match(/\/shipid:(\d+)/i);
    return match ? match[1] : null;
  }

  /**
   * Checks if two ships have conflicting MarineTraffic IDs.
   * 
   * @returns Object with match status and IDs for display
   */
  compareMarineTrafficLinks(ship1: Ship, ship2: Ship): {
    match: 'same' | 'different' | 'unknown';
    id1: string | null;
    id2: string | null;
  } {
    const id1 = this.extractMarineTrafficId(ship1.marineTrafficLink);
    const id2 = this.extractMarineTrafficId(ship2.marineTrafficLink);
    
    // If neither has an ID, we can't compare
    if (!id1 && !id2) {
      return { match: 'unknown', id1, id2 };
    }
    
    // If only one has an ID, we can't confirm match
    if (!id1 || !id2) {
      return { match: 'unknown', id1, id2 };
    }
    
    // Both have IDs - compare them
    return {
      match: id1 === id2 ? 'same' : 'different',
      id1,
      id2
    };
  }
}
