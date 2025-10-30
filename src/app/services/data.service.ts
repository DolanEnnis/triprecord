import { inject, Injectable} from '@angular/core';
import {
  collection,
  collectionData,
  Firestore,
  query,
  getDocs,
  where,
} from '@angular/fire/firestore';
import { from, map, Observable, of } from 'rxjs';
import { Charge, ChargeableEvent, Trip, UnifiedTrip, Visit } from '../models/trip.model';
// Import new models with aliases to prevent naming conflicts during transition
import {
  NewVisitData, // Only needed for the workflow service
} from '../models/data.model';

import { ChargeRepository } from './charge.repository';
import { ShipRepository } from './ship.repository';
import { UnifiedTripLogService } from './unified-trip-log.service';
import { VisitWorkflowService } from './visit-workflow.service';
import { TripRepository } from './trip.repository';



@Injectable({
  providedIn: 'root',
})
export class DataService {
  private readonly firestore: Firestore = inject(Firestore);
  private readonly chargeRepository: ChargeRepository = inject(ChargeRepository);
  private readonly shipRepository: ShipRepository = inject(ShipRepository);
  private readonly tripRepository: TripRepository = inject(TripRepository);
  private readonly unifiedTripLogService: UnifiedTripLogService = inject(UnifiedTripLogService);
  private readonly visitWorkflowService: VisitWorkflowService = inject(VisitWorkflowService);

  /**
   * Fetches recent visits and maps their individual trips to ChargeableEvent objects.
   * This method now processes a 'trips' array for flexibility.
   * @deprecated Use UnifiedTripLogService.v2GetUnifiedTripLog() for new model data.
   */
  getRecentTrips(): Observable<ChargeableEvent[]> {
    const visitsCollection = collection(this.firestore, 'visits');
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const recentVisitsQuery = query(
      visitsCollection,
      where('eta', '>=', threeMonthsAgo)
    );
    return (collectionData(recentVisitsQuery, { idField: 'docid' }) as Observable<Visit[]>).pipe(
      map((visits) => {
        const chargeableEvents: ChargeableEvent[] = [];
        for (const visit of visits) {
          // Check for the new 'trips' array first
          if (visit.trips && visit.trips.length > 0) {
            for (const trip of visit.trips) {
              // The direction is now the `typeTrip` field
              if (trip.boarding) {
                chargeableEvents.push(this.createChargeableEvent(visit, trip));
              }
            }
          } else {
            // Fallback for old documents (backward compatibility)
            if (visit.inward && visit.inward.boarding) {
              chargeableEvents.push(this.createChargeableEvent(visit, visit.inward));
            }
            if (visit.outward && visit.outward.boarding) {
              chargeableEvents.push(this.createChargeableEvent(visit, visit.outward));
            }
          }
        }
        return chargeableEvents.sort((a, b) => b.boarding.getTime() - a.boarding.getTime());
      })
    );
  }

  /**
   * Combines recent charges and unconfirmed visits (old model) into a single UnifiedTrip log.
   * @deprecated Use UnifiedTripLogService.v2GetUnifiedTripLog() for new model data.
   */
  getUnifiedTripLog(): Observable<UnifiedTrip[]> {
    return this.unifiedTripLogService.getUnifiedTripLog();
  }



  /**
   * V2: Creates a new document in the 'charges' collection and updates the
   * corresponding 'trips' document to mark the specific trip as confirmed.
   * This function replaces the deprecated createChargeAndUpdateVisit.
   *
   * @param chargeData - The data for the new charge, structured for the charges collection.
   * @param tripId - The ID of the Trip document in /trips to mark as confirmed.
   */
  async v2ConfirmTripAndCreateCharge(
    chargeData: Omit<Charge, 'updateTime' | 'createdBy' | 'createdById'>,
    tripId: string
  ): Promise<void> {
    // Delegate to ChargeRepository for adding the charge
    await this.chargeRepository.addCharge(chargeData);

    // Delegate to TripRepository for updating the trip
    await this.tripRepository.updateTrip(tripId, { isConfirmed: true });
  }

  /**
   * Creates a new document in the 'charges' collection without an associated visit.
   * @deprecated Use ChargeRepository.addCharge() directly.
   */
  async createStandaloneCharge(chargeData: Omit<Charge, 'updateTime' | 'createdBy' | 'createdById'>): Promise<void> {
    return this.chargeRepository.addCharge(chargeData);
  }

  /**
   * Updates an existing charge document in Firestore.
   * @param chargeId The ID of the charge document to update.
   * @param chargeData The new data for the charge.
   * @deprecated Use ChargeRepository.updateCharge() directly.
   */
  async updateCharge(chargeId: string, chargeData: Partial<Charge>): Promise<void> {
    return this.chargeRepository.updateCharge(chargeId, chargeData);
  }

  /**
   * Deletes a charge document from Firestore.
   * @param chargeId The ID of the charge document to delete.
   * @deprecated Use ChargeRepository.deleteCharge() directly.
   */
  async deleteCharge(chargeId: string): Promise<void> {
    return this.chargeRepository.deleteCharge(chargeId);
  }

  /**
   * Checks if a charge that matches the given criteria already exists to prevent duplicates.
   * @param chargeData The core fields of the charge to check for.
   * @deprecated Use ChargeRepository.doesChargeExist() directly.
   */
  async doesChargeExist(chargeData: { ship: string; boarding: Date; typeTrip: string }): Promise<boolean> {
    return this.chargeRepository.doesChargeExist(chargeData);
  }

  /**
   * Gets ship name and GT suggestions from recent visits for autocomplete.
   * @param search The string to search for.
   * @deprecated Use ShipRepository.getShipSuggestions() for new model data.
   */
  getShipSuggestions(search: string): Observable<{ ship: string, gt: number }[]> {
    // Don't query if the search string is too short.
    if (!search || search.length < 2) {
      return of([]);
    }

    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    const visitsCollection = collection(this.firestore, 'visits');
    // NOTE: This query requires a composite index in Firestore on ('ship', 'eta').
    // The browser console will log an error with a link to create it automatically.
    const q = query(
      visitsCollection,
      where('eta', '>=', sixtyDaysAgo),
      where('shipInfo.ship', '>=', search),
      where('shipInfo.ship', '<=', search + '\uf8ff') // Standard prefix search trick
    );

    return from(getDocs(q)).pipe(
      map(snapshot => {
        // Use a Map to ensure ship names are unique in the suggestion list.
        const ships = new Map<string, number>();
        snapshot.docs.forEach(doc => {
          const data = doc.data();
          if (data['shipInfo']) { // Defensive check for old data
            ships.set(data['shipInfo']['ship'], data['shipInfo']['gt']);
          }
        });
        // Return an array of objects, limiting to the top 10 results.
        return Array.from(ships, ([ship, gt]) => ({ ship, gt })).slice(0, 10);
      })
    );
  }

  /**
   * the createChargeableEvent helper function to handle the new Trip model.
   * This helper is now part of UnifiedTripLogService, but kept here for backward
   * compatibility with getRecentTrips() and getUnifiedTripLog() which are
   * still in this service.
   */
  private createChargeableEvent(visit: Visit, trip: Trip, tripDirection?: 'inward' | 'outward'): ChargeableEvent {
    // A map to handle pilot name replacements. This is a good place for data cleaning.
    const pilotNameMap: { [key: string]: string } = {
      'Fergal': 'WMcN',
      'Fintan': 'Matt',
    };
    const originalPilot = trip.pilot || '';
    const pilotName = pilotNameMap[originalPilot] || originalPilot;

    const isConfirmed = tripDirection
      ? (tripDirection === 'inward' ? visit.inwardConfirmed === true : visit.outwardConfirmed === true)
      : trip.confirmed === true;

    return {
      visitDocId: visit.docid,
      ship: visit.shipInfo.ship,
      gt: visit.shipInfo.gt,
      boarding: trip.boarding.toDate(),
      port: trip.port,
      pilot: pilotName,
      typeTrip: trip.typeTrip,
      sailingNote: '', // This is for user input about the sailing, starts empty.
      extra: trip.extra || '',
      tripDirection: tripDirection || (trip.typeTrip === 'In' ? 'inward' : 'outward'),
      isConfirmed: isConfirmed,
    };
  }

  // ==================================================================================
  // V2 METHODS - Using the new normalized data model (data.model.ts)
  // ==================================================================================

  /**
   * V2: Fetches trips and their associated visit data based on the new normalized schema. (Delegated)
   */
  v2GetUnifiedTripLog(): Observable<UnifiedTrip[]> {
    return this.unifiedTripLogService.v2GetUnifiedTripLog();
  }

  /**
   * V2: Gets ship name and GT suggestions from the master '/ships' collection. (Delegated)
   */
  v2GetShipSuggestions(search: string): Observable<{ ship: string, gt: number }[]> {
    return this.shipRepository.getShipSuggestions(search);
  }

  /**
   * V2: Creates a new Visit and its initial 'In' Trip, and ensures the master Ship record is up to date. (Delegated)
   */
  async v2CreateNewVisit(data: NewVisitData): Promise<string> {
    return this.visitWorkflowService.createNewVisit(data);
  }
}
