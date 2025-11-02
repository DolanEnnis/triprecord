import { inject, Injectable} from '@angular/core';
import { Observable, of } from 'rxjs';
import { Timestamp } from '@angular/fire/firestore';
// Only import DTO models
import { Charge, UnifiedTrip } from '../models/trip.model';
import { NewVisitData } from '../models/data.model';

// Removed: Firestore import
// Removed: Old model imports (ChargeableEvent, Trip, Visit)
import { ChargeRepository } from './charge.repository';
import { ShipRepository } from './ship.repository';
import { UnifiedTripLogService } from './unified-trip-log.service';
import { VisitWorkflowService } from './visit-workflow.service';
import { TripRepository } from './trip.repository';



@Injectable({
  providedIn: 'root',
})
export class DataService {
  private readonly chargeRepository: ChargeRepository = inject(ChargeRepository);
  private readonly shipRepository: ShipRepository = inject(ShipRepository);
  private readonly tripRepository: TripRepository = inject(TripRepository);
  private readonly unifiedTripLogService: UnifiedTripLogService = inject(UnifiedTripLogService);
  private readonly visitWorkflowService: VisitWorkflowService = inject(VisitWorkflowService);

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
   * Creates a new charge and marks the corresponding trip as confirmed.
   * (Renamed from v2ConfirmTripAndCreateCharge)
   */
  async confirmTripAndCreateCharge(
    chargeData: Omit<Charge, 'updateTime' | 'createdBy' | 'createdById'>,
    tripId: string
  ): Promise<void> {
    // The `chargeData` from the form has `boarding` as a JS Date.
    // We must convert it to a Firestore Timestamp before updating the Trip document.
    const updatePayload = {
      ...chargeData,
      boarding: Timestamp.fromDate(chargeData.boarding), // Convert Date to Timestamp
      isConfirmed: true,
    };

    await this.tripRepository.updateTrip(tripId, updatePayload);
  }

  /**
   * Creates a new standalone charge. (Retained, no change)
   */
  async createStandaloneCharge(
    chargeData: Omit<Charge, 'updateTime' | 'createdBy' | 'createdById'>
  ): Promise<string> {
    // 1. Ensure the ship exists in the master /ships collection and get its ID.
    const shipId = await this.shipRepository.ensureShipDetails(chargeData.ship, chargeData.gt);

    // 2. Use the workflow service to create the underlying Visit and confirmed Trip.
    // This replaces direct creation of a 'charge' document.
    return this.visitWorkflowService.createVisitAndTripFromCharge(chargeData, shipId);
  }

  /**
   * Updates an existing charge document. (Retained, no change)
   */
  async updateCharge(chargeId: string, chargeData: Partial<Charge>): Promise<void> {
    return this.chargeRepository.updateCharge(chargeId, chargeData);
  }

  /**
   * Deletes a charge document. (Retained, no change)
   */
  async deleteCharge(chargeId: string): Promise<void> {
    return this.chargeRepository.deleteCharge(chargeId);
  }

  /**
   * Checks for duplicate charges. (Retained, no change)
   */
  async doesChargeExist(chargeData: { ship: string; boarding: Date; typeTrip: string }): Promise<boolean> {
    return this.chargeRepository.doesChargeExist(chargeData);
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
  async ensureShipDetails(shipName: string, grossTonnage: number): Promise<string> {
    // This simply calls the repository method.
    return this.shipRepository.ensureShipDetails(shipName, grossTonnage);
  }

  // 🛑 REMOVED: private createChargeableEvent() - Only for old model compatibility

  /**
   * Creates a new Visit and its initial 'In' Trip, and ensures the master Ship record is up to date.
   * (Renamed from v2CreateNewVisit)
   */
  async createNewVisit(data: NewVisitData): Promise<string> {
    return this.visitWorkflowService.createNewVisit(data);
  }
}
