import { inject, Injectable} from '@angular/core';
import { Observable } from 'rxjs';
import { Timestamp } from '@angular/fire/firestore';
// Only import DTO models
import { Charge, UnifiedTrip, NewVisitData, VisitStatus } from '../../models';

import { AuthService } from '../../auth/auth';
import { ShipRepository } from '../repositories/ship.repository';
import { UnifiedTripLogService } from './unified-trip-log.service';
import { VisitWorkflowService } from '../workflows/visit-workflow.service';
import { TripRepository } from '../repositories/trip.repository';
import { VisitRepository } from '../repositories/visit.repository';



@Injectable({
  providedIn: 'root',
})
export class DataService {
  // ChargeRepository has been fully retired — all operations now go through TripRepository.
  private readonly shipRepository: ShipRepository = inject(ShipRepository);
  private readonly tripRepository: TripRepository = inject(TripRepository);
  private readonly unifiedTripLogService: UnifiedTripLogService = inject(UnifiedTripLogService);
  private readonly visitWorkflowService: VisitWorkflowService = inject(VisitWorkflowService);
  private readonly visitRepository: VisitRepository = inject(VisitRepository);
  private readonly authService: AuthService = inject(AuthService);

  // 🛑 REMOVED: getRecentTrips() - Deprecated old model method
  // 🛑 REMOVED: getUnifiedTripLog() - Deprecated old model method

  /**
   * Fetches the unified log of confirmed charges and actionable unconfirmed trips
   * based on the new normalized schema. (Renamed from v2GetUnifiedTripLog)
   */
  getUnifiedTripLog(): Observable<UnifiedTrip[]> {
    return this.unifiedTripLogService.getUnifiedTripLog();
  }

  /**
   * Confirms an operational trip and updates the trip record with billing details.
   * 
   * MIGRATION UPDATE (Step 4):
   * - No longer creates a duplicate record in /charges.
   * - Writes all billing data (shipName, gt, confirmedBy, etc.) directly to /trips.
   * - Sets isConfirmed = true.
   */
  async confirmTripAndCreateCharge(
    chargeData: Omit<Charge, 'updateTime' | 'createdBy' | 'createdById'>,
    tripId: string,
    visitId: string // Visit ID is required to update parent status
  ): Promise<void> {
    const user = this.authService.currentUserSig();
    const updatedBy = user?.displayName || 'Unknown';
    const updatedById = user?.uid || 'Unknown';
    const confirmedAt = Timestamp.now();

    // 1. Update the operational trip record with the final details MARK AS CONFIRMED.
    // We now include all billing fields (shipName, gt) directly on the trip.
    const tripUpdatePayload = {
      ...chargeData,
      boarding: Timestamp.fromDate(chargeData.boarding), // Convert Date to Timestamp
      
      // Billing Fields (Denormalized)
      shipName: chargeData.ship,
      gt: chargeData.gt,
      
      // Confirmation Metadata
      isConfirmed: true,
      confirmedBy: updatedBy,
      confirmedById: updatedById,
      confirmedAt: confirmedAt,
    };
    
    await this.tripRepository.updateTrip(tripId, tripUpdatePayload);

    // 2. CRITICAL: Only update the visit status if the trip is an 'Out' trip.
    if (chargeData.typeTrip === 'Out') {
      await this.visitRepository.updateVisitStatus(
        visitId,
        'Sailed' as VisitStatus,
        updatedBy
      );
    }
  }

  /**
   * Creates a new standalone confirmed trip.
   */
  async createStandaloneCharge(
    chargeData: Omit<Charge, 'updateTime' | 'createdBy' | 'createdById'>
  ): Promise<string> {
    // 1. Ensure the ship exists in the master /ships collection and get its ID.
    const { id: shipId } = await this.shipRepository.ensureShipDetails(chargeData.ship, chargeData.gt);

    // 2. Use the workflow service to create the underlying Visit and confirmed Trip.
    // This creates the trip with isConfirmed=true and full billing details.
    const tripId = await this.visitWorkflowService.createVisitAndTripFromCharge(chargeData, shipId);

    return tripId;
  }

  /**
   * Updates a confirmed trip.
   *
   * MIGRATION: Previously wrote to /charges. Now writes directly to /trips,
   * where all confirmed records live since the data migration.
   * The `chargeId` passed in is already the /trips document ID because
   * the trip-confirmation table is built from UnifiedTrip, which sources its
   * `id` from the /trips collection.
   *
   * LEARNING: TYPE BOUNDARY CONVERSION
   * The `Charge` DTO uses a plain JS `Date` for `boarding` (convenient for display
   * and CSV export), but the `Trip` entity stores it as a Firestore `Timestamp`.
   * We convert at this service boundary — the same pattern used in
   * `confirmTripAndCreateCharge()` above.
   */
  async updateCharge(chargeId: string, chargeData: Partial<Charge>): Promise<void> {
    // Map Charge fields to their Trip equivalents, converting types as needed.
    const tripUpdatePayload: Partial<import('../../models').Trip> = {
      ...(chargeData.ship && { shipName: chargeData.ship }),
      ...(chargeData.gt !== undefined && { gt: chargeData.gt }),
      ...(chargeData.port !== undefined && { port: chargeData.port }),
      ...(chargeData.pilot && { pilot: chargeData.pilot }),
      ...(chargeData.typeTrip && { typeTrip: chargeData.typeTrip }),
      // Convert JS Date → Firestore Timestamp (rejected by Firestore otherwise)
      ...(chargeData.boarding && { boarding: Timestamp.fromDate(chargeData.boarding) }),
      ...(chargeData.sailingNote !== undefined && { pilotNotes: chargeData.sailingNote }),
      ...(chargeData.extra !== undefined && { extraChargesNotes: chargeData.extra }),
      // Pass docket metadata through to the Trip record
      ...(chargeData.docketUrl !== undefined && { docketUrl: chargeData.docketUrl }),
      ...(chargeData.docketPath !== undefined && { docketPath: chargeData.docketPath }),
      ...(chargeData.docketType !== undefined && { docketType: chargeData.docketType }),
    };
    return this.tripRepository.updateTrip(chargeId, tripUpdatePayload);
  }

  /**
   * Deletes a confirmed trip record.
   *
   * MIGRATION: Previously deleted from /charges. Now deletes from /trips.
   */
  async deleteCharge(chargeId: string): Promise<void> {
    return this.tripRepository.deleteTrip(chargeId);
  }

  /**
   * Checks whether a confirmed trip already exists (duplicate detection).
   *
   * MIGRATION: The old version queried /charges, which is no longer written to.
   * Now delegates to TripRepository which queries /trips with isConfirmed == true.
   */
  async doesChargeExist(chargeData: { ship: string; boarding: Date; typeTrip: string }): Promise<boolean> {
    return this.tripRepository.doesConfirmedTripExist(chargeData);
  }

  /**
   * Gets ship name and GT suggestions from the master '/ships' collection.
   * (Renamed from v2GetShipSuggestions and replaces old logic)
   */
  getShipSuggestions(search: string): Observable<{ ship: string, gt: number }[]> {
    return this.shipRepository.getShipSuggestions(search);
  }

  /**
   * Ensures a ship's details (especially GT) are up-to-date in the master /ships collection.
   * This is a facade method that delegates the call to the ShipRepository.
   * @param shipName The name of the ship.
   * @param grossTonnage The Gross Tonnage of the ship.
   */
  async ensureShipDetails(shipName: string, grossTonnage: number): Promise<{ id: string; syncResult: { updatedCount: number; skippedConfirmedCount: number } }> {
    // This simply calls the repository method.
    return this.shipRepository.ensureShipDetails(shipName, grossTonnage);
  }

  async repairRecentTrips(): Promise<number> {
    return this.unifiedTripLogService.repairRecentTrips();
  }

  // 🛑 REMOVED: private createChargeableEvent() - Only for old model compatibility

  /**
   * Creates a new Visit and its initial 'In' Trip, and ensures the master Ship record is up to date.
   * (Renamed from v2CreateNewVisit)
   */
  async createNewVisit(data: NewVisitData): Promise<string> {
    return this.visitWorkflowService.createNewVisit(data);
  }

  /**
   * Alias for createNewVisit - used by sheet-info component.
   * @param data The new visit data
   */
  async addNewVisitFromPaste(data: NewVisitData): Promise<string> {
    return this.createNewVisit(data);
  }
}
