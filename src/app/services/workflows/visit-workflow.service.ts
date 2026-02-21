import { inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
import { serverTimestamp, Timestamp, doc, updateDoc } from '@angular/fire/firestore';
import { AuthService } from '../../auth/auth';
import { NewVisitData, Trip, TripType, Visit, VisitStatus, Charge, Port } from '../../models';
import { ShipRepository } from '../repositories/ship.repository';
import { VisitRepository } from '../repositories/visit.repository';
import { TripRepository } from '../repositories/trip.repository';


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
   * Creates a new visit with inward and outward trips.
   * @param data The form data containing ship and visit details.
   * @param forceNewShip If true, creates a new ship record even if one with the same name exists.
   *                     Used when user explicitly confirms they want a separate vessel record.
   */
  async createNewVisit(data: NewVisitData, forceNewShip: boolean = false): Promise<string> {
    return runInInjectionContext(this.injector, async () => {
      const user = this.authService.currentUserSig();
      const now = serverTimestamp();
      const recordedBy = user?.displayName || 'Unknown';
      const initialEtaTimestamp = Timestamp.fromDate(data.initialEta);

      // Use forceCreateShip when user explicitly wants a separate ship record
      const shipId = forceNewShip
        ? await this.shipRepository.forceCreateShip(data)
        : await this.shipRepository.findOrCreateShip(data);

      // Create the Visit record with ship's ETA
      const newVisit: Omit<Visit, 'id'> = {
        shipId: shipId,
        shipName: data.shipName,
        grossTonnage: data.grossTonnage,
        currentStatus: 'Due' as VisitStatus,
        initialEta: initialEtaTimestamp,  // Ship's ETA to port
        berthPort: data.berthPort,
        visitNotes: data.visitNotes,
        source: data.source,  // Track where this visit information came from
        statusLastUpdated: now,
        updatedBy: recordedBy,
      };
      const visitId = await this.visitRepository.addVisit(newVisit);

      // Create INWARD Trip with boarding = null (ETB comes later)
      const inwardTrip: Omit<Trip, 'id'> = {
        visitId: visitId,
        shipId: shipId,
        typeTrip: 'In' as TripType,
        boarding: null,  // ETB not yet known (User Req: Keep null to avoid pilot confusion)
        pilot: data.pilot ?? '',
        port: data.berthPort,
        pilotNotes: data.visitNotes || '',
        extraChargesNotes: '',
        isConfirmed: false,
        recordedBy: recordedBy,
        recordedAt: now,
        ownNote: undefined,
        pilotNo: undefined,
        monthNo: undefined,
        car: undefined,
        timeOff: undefined,
        good: undefined,
        
        // Denormalized Ship Data
        shipName: data.shipName,
        gt: data.grossTonnage,
      };
      await this.tripRepository.addTrip(inwardTrip);

      // Create OUTWARD Trip with boarding = null (ETS not yet known)
      const outwardTrip: Omit<Trip, 'id'> = {
        visitId: visitId,
        shipId: shipId,
        typeTrip: 'Out' as TripType,
        boarding: null,  // ETS not yet known (User Req: Keep null to avoid pilot confusion)
        pilot: '',  // Pilot assigned later
        port: data.berthPort,
        pilotNotes: '',
        extraChargesNotes: '',
        isConfirmed: false,
        recordedBy: recordedBy,
        recordedAt: now,
        ownNote: undefined,
        pilotNo: undefined,
        monthNo: undefined,
        car: undefined,
        timeOff: undefined,
        good: undefined,

        // Denormalized Ship Data
        shipName: data.shipName,
        gt: data.grossTonnage,
      };
      await this.tripRepository.addTrip(outwardTrip);

      return visitId;
    });
  }

  async createVisitAndTripFromCharge(
    chargeData: Omit<Charge, 'updateTime' | 'createdBy' | 'createdById'>,
    shipId: string
  ): Promise<string> {
    return runInInjectionContext(this.injector, async () => {
      const user = this.authService.currentUserSig();
      const now = serverTimestamp();
      const recordedBy = user?.displayName || 'Unknown';
      const boardingTimestamp = Timestamp.fromDate(chargeData.boarding);

      const newVisit: Omit<Visit, 'id'> = {
        shipId: shipId,
        shipName: chargeData.ship,
        grossTonnage: chargeData.gt,
        currentStatus: chargeData.typeTrip === 'Out' ? 'Sailed' : 'Alongside',
        initialEta: boardingTimestamp,
        berthPort: chargeData.port,
        visitNotes: `Trip manually created by pilot: ${chargeData.pilot}`,
        source: 'Pilot',  // This visit was created from a pilot's direct confirmation
        statusLastUpdated: now,
        updatedBy: recordedBy,
      };
      const visitId = await this.visitRepository.addVisit(newVisit);

      const newTrip: Omit<Trip, 'id'> = {
        visitId: visitId,
        shipId: shipId,
        typeTrip: chargeData.typeTrip as TripType,
        boarding: boardingTimestamp,
        pilot: chargeData.pilot,
        port: chargeData.port,
        pilotNotes: chargeData.sailingNote || '',
        extraChargesNotes: chargeData.extra || '',
        
        // Billing Fields
        shipName: chargeData.ship,
        gt: chargeData.gt, 
        
        // Confirmation Metadata
        isConfirmed: false,
        confirmedBy: undefined,
        confirmedById: undefined,
        confirmedAt: undefined,
        
        recordedBy: recordedBy,
        recordedAt: now,
        ownNote: undefined,
        pilotNo: undefined,
        monthNo: undefined,
        car: undefined,
        timeOff: undefined,
        good: undefined,
      };
      return this.tripRepository.addTrip(newTrip);
    });
  }

  /**
   * Updates a visit status to 'Alongside' when ship arrives.
   * TYPE SAFETY: Now uses Port type instead of any
   */
  async arriveShip(visitId: string, port: Port): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      const user = this.authService.currentUserSig();
      const now = serverTimestamp();
      const updatedBy = user?.displayName || 'Unknown';

      // Update Visit Status
      await this.visitRepository.updateVisitStatus(visitId, 'Alongside', updatedBy);
    });
  }

  /**
   * Creates a shift trip and updates visit location.
   * TYPE SAFETY: Now uses Port type instead of any
   */
  async shiftShip(visitId: string, fromPort:  Port, toPort: Port, pilot: string): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      const user = this.authService.currentUserSig();
      const now = serverTimestamp();
      const recordedBy = user?.displayName || 'Unknown';

      // 1. Create Shift Trip
      const visit = await this.visitRepository.getVisitById(visitId).toPromise();
      if (!visit) throw new Error('Visit not found');

      const shiftTrip: Omit<Trip, 'id'> = {
        visitId: visitId,
        shipId: visit.shipId,
        typeTrip: 'Shift',
        boarding: now as Timestamp,
        pilot: pilot,
        port: toPort,
        pilotNotes: '',
        extraChargesNotes: '',
        isConfirmed: false,
        recordedBy: recordedBy,
        recordedAt: now,
        ownNote: null,
        pilotNo: null,
        monthNo: null,
        car: null,
        timeOff: null,
        good: null,

        // Denormalized Ship Data
        shipName: visit.shipName,
        gt: visit.grossTonnage || 0,
      };
      await this.tripRepository.addTrip(shiftTrip);

      // 2. Update Visit Location
      await this.visitRepository.updateVisitLocation(visitId, toPort, recordedBy);
    });
  }

  async sailShip(visitId: string, pilot: string): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      const user = this.authService.currentUserSig();
      const now = serverTimestamp();
      const recordedBy = user?.displayName || 'Unknown';

      const visit = await this.visitRepository.getVisitById(visitId).toPromise();
      if (!visit) throw new Error('Visit not found');

      // 1. Create Out Trip
      const outTrip: Omit<Trip, 'id'> = {
        visitId: visitId,
        shipId: visit.shipId,
        typeTrip: 'Out',
        boarding: now as Timestamp,
        pilot: pilot,
        port: visit.berthPort,
        pilotNotes: '',
        extraChargesNotes: '',
        isConfirmed: false,
        recordedBy: recordedBy,
        recordedAt: now,
        ownNote: null,
        pilotNo: null,
        monthNo: null,
        car: null,
        timeOff: null,
        good: null,

        // Denormalized Ship Data
        shipName: visit.shipName,
        gt: visit.grossTonnage || 0,
      };
      await this.tripRepository.addTrip(outTrip);

      // 2. Update Visit Status to Sailed
      await this.visitRepository.updateVisitStatus(visitId, 'Sailed', recordedBy);
    });
  }

  /**
   * Cancels a visit and handles associated trips.
   * 
   * LOGIC:
   * 1. Fetches all trips for the visit.
   * 2. BLOCKS if any trip is confirmed (billing history protection).
   * 3. Deletes all unconfirmed trips.
   * 4. Updates Visit status to 'Cancelled'.
   * 
   * @returns Object describing what happened for UI feedback.
   */
  async cancelVisit(visitId: string): Promise<{ deletedTrips: number; warningLevel: 'NONE' | 'ACTIVE_DATA' }> {
    return runInInjectionContext(this.injector, async () => {
      const user = this.authService.currentUserSig();
      const recordedBy = user?.displayName || 'Unknown';

      // 1. Fetch all trips
      const trips = await this.tripRepository.getTripsByVisitIdOnce(visitId);

      // 2. Safety Check: Confirmed Trips
      const confirmedTrips = trips.filter(t => t.isConfirmed);
      if (confirmedTrips.length > 0) {
        throw new Error(`Cannot cancel visit: ${confirmedTrips.length} trip(s) are already Confirmed/Billed. Please unconfirm them first if this is a mistake.`);
      }

      // 3. Determine Warning Level
      // If any trip has a boarding date, it implies "active work" was started -> ACTIVE_DATA
      // If all trips are pending (boarding == null), it's just a skeleton -> NONE
      const hasActiveData = trips.some(t => t.boarding !== null);
      const warningLevel = hasActiveData ? 'ACTIVE_DATA' : 'NONE';

      // 4. Update Visit Status to Cancelled (Trips are KEPT for history as per user req)
      await this.visitRepository.updateVisitStatus(visitId, 'Cancelled', recordedBy);

      return { deletedTrips: 0, warningLevel };
    });
  }
}
