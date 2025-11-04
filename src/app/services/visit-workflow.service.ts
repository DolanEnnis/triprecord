import { inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
import { serverTimestamp, Timestamp } from '@angular/fire/firestore';
import { AuthService } from '../auth/auth';
import { NewVisitData, Trip, TripType, Visit, VisitStatus } from '../models/data.model';
import { Charge } from '../models/trip.model';
import { ShipRepository } from './ship.repository';
import { VisitRepository } from './visit.repository';
import { TripRepository } from './trip.repository';

/**
 * VisitWorkflowService orchestrates the creation of new visits,
 * including ensuring ship records exist and creating initial trips.
 * It uses lower-level repositories to perform specific data operations.
 */
@Injectable({
  providedIn: 'root',
})
export class VisitWorkflowService {
  private readonly authService: AuthService = inject(AuthService);
  private readonly shipRepository: ShipRepository = inject(ShipRepository);
  private readonly visitRepository: VisitRepository = inject(VisitRepository);
  private readonly tripRepository: TripRepository = inject(TripRepository);
  private readonly injector = inject(Injector);

  /**
   * Creates a new Visit and its initial 'In' Trip, and ensures the master Ship record is up to date.
   * This is the function the new ship input form will call.
   * @param data The validated form data (NewVisitData).
   * @returns The new Visit ID.
   */
  async createNewVisit(data: NewVisitData): Promise<string> {
    return runInInjectionContext(this.injector, async () => {
      const user = this.authService.currentUserSig();
      const now = serverTimestamp();
      const recordedBy = user?.displayName || 'Unknown';
      const initialEtaTimestamp = Timestamp.fromDate(data.initialEta);

      // 1. Ensure/Update the master Ship record
      const shipId = await this.shipRepository.findOrCreateShip(data);

      // 2. Create the new Visit Document in /visits
      const newVisit: Omit<Visit, 'id'> = {
        shipId: shipId,
        shipName: data.shipName, // Denormalized field
        grossTonnage: data.grossTonnage, // Denormalized field
        currentStatus: 'Due' as VisitStatus, // Initial state
        initialEta: initialEtaTimestamp,
        berthPort: data.berthPort,
        visitNotes: data.visitNotes,

        // Audit Fields
        statusLastUpdated: now as Timestamp,
        updatedBy: recordedBy,
      };
      const visitId = await this.visitRepository.addVisit(newVisit);

      // 3. Create the initial 'In' Trip in /trips
      const initialTrip: Omit<Trip, 'id'> = {
        visitId: visitId,
        shipId: shipId, // Denormalized

        typeTrip: 'In' as TripType,
        boarding: initialEtaTimestamp, // Use ETA as provisional boarding time
        pilot: data.pilot,

        fromPort: null, // 'In' implies from sea
        toPort: data.berthPort,

        pilotNotes: data.visitNotes || '', // Initial notes can come from the visit notes
        extraChargesNotes: '',
        isConfirmed: false,

        // Audit Fields
        recordedBy: recordedBy,
        recordedAt: now as Timestamp,
      };
      await this.tripRepository.addTrip(initialTrip);

      return visitId; // Return the new visit ID
    });
  }

  /**
   * Creates a minimal Visit and a single, confirmed Trip for scenarios where a pilot
   * is creating a charge directly without a preceding visit/trip record.
   * This ensures all new charges follow the normalized data structure.
   * @param chargeData The confirmed trip details from the charge form.
   * @param shipId The ID of the existing/new master ship document.
   * @returns The newly created Trip ID.
   */
  async createVisitAndTripFromCharge(
    chargeData: Omit<Charge, 'updateTime' | 'createdBy' | 'createdById'>,
    shipId: string
  ): Promise<string> {
    return runInInjectionContext(this.injector, async () => {
      const user = this.authService.currentUserSig();
      const now = serverTimestamp();
      const recordedBy = user?.displayName || 'Unknown';
      const boardingTimestamp = Timestamp.fromDate(chargeData.boarding);

      // --- 1. Create the new Visit Document in /visits ---
      const newVisit: Omit<Visit, 'id'> = {
        shipId: shipId,
        shipName: chargeData.ship,
        grossTonnage: chargeData.gt,

        // Status determination based on trip type
        currentStatus: chargeData.typeTrip === 'Out' ? 'Sailed' : 'Alongside',
        initialEta: boardingTimestamp, // Use boarding time as the best estimate
        berthPort: chargeData.port,
        visitNotes: `Trip confirmed directly by pilot: ${chargeData.pilot}`,

        // Audit Fields
        statusLastUpdated: now as Timestamp,
        updatedBy: recordedBy,
      };
      const visitId = await this.visitRepository.addVisit(newVisit);

      // --- 2. Create the Confirmed Trip in /trips ---
      const newTrip: Omit<Trip, 'id'> = {
        visitId: visitId,
        shipId: shipId,
        typeTrip: chargeData.typeTrip as TripType,
        boarding: boardingTimestamp,
        pilot: chargeData.pilot,
        fromPort: chargeData.typeTrip === 'In' ? null : chargeData.port,
        toPort: chargeData.typeTrip === 'Out' ? null : chargeData.port,
        pilotNotes: chargeData.sailingNote || '',
        extraChargesNotes: chargeData.extra || '',
        isConfirmed: true, // It is confirmed immediately
        recordedBy: recordedBy,
        recordedAt: now as Timestamp,
      };
      return this.tripRepository.addTrip(newTrip);
    });
  }
}
