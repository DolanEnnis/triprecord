import { inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
import { serverTimestamp, Timestamp, doc, updateDoc } from '@angular/fire/firestore';
import { AuthService } from '../../auth/auth';
import { AuditablePayload, NewVisitData, Trip, TripType, Visit, VisitStatus, Charge, Port } from '../../models';
import { ShipRepository } from '../repositories/ship.repository';
import { VisitRepository } from '../repositories/visit.repository';
import { TripRepository } from '../repositories/trip.repository';


/**
 * Determines the correct Visit status for a manually-entered (standalone) trip.
 *
 * WHY THIS EXISTS:
 * When a pilot enters a trip via the "New Trip" dialog, we only know the typeTrip
 * and the boarding date. We cannot blindly set 'Alongside' for all 'In' trips
 * because the pilot may be recording a trip from earlier in the month — in which
 * case the ship is NOT currently active on the river.
 *
 * RULES:
 *  - typeTrip === 'Out'  → always 'Sailed'  (ship has left regardless of date)
 *  - typeTrip === 'In' AND boarding is today → 'Alongside' (ship is genuinely active)
 *  - typeTrip === 'In' AND boarding is in the past → 'Undefined' (archival; hidden from Status List)
 *
 * 'Undefined' is intentionally excluded from all activeStatuses arrays so these
 * historical entries never pollute the live Status List view.
 */
function resolveHistoricalStatus(typeTrip: string, boarding: Date): VisitStatus {
  if (typeTrip === 'Out') return 'Sailed';

  const today = new Date();
  const isToday =
    boarding.getFullYear() === today.getFullYear() &&
    boarding.getMonth() === today.getMonth() &&
    boarding.getDate() === today.getDate();

  return isToday ? 'Alongside' : 'Undefined';
}

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
   * @param auditStamp Optional metadata attached to every Firestore write so the Cloud
   *                   Function trigger can identify who made the change and from where.
   */
  async createNewVisit(
    data: NewVisitData,
    forceNewShip: boolean = false,
    auditStamp?: AuditablePayload
  ): Promise<string> {
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
      const visitId = await this.visitRepository.addVisit({
        ...newVisit,
        ...(auditStamp ?? {}), // Triggers onVisitWritten Cloud Function
      });

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
        // LEARNING: Use `null` not `undefined` for Firestore.
        // `undefined` is a JS concept meaning "not set" — Firestore's SDK
        // cannot serialize it and will throw. `null` is the correct sentinel
        // for "this field exists but has no value yet".
        ownNote: null,
        pilotNo: null,
        monthNo: null,
        car: null,
        good: null,
        // Denormalized Ship Data
        shipName: data.shipName,
        gt: data.grossTonnage,
      };
      await this.tripRepository.addTrip({
        ...inwardTrip,
        ...(auditStamp ?? {}), // Triggers onTripWritten Cloud Function
      });

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
        ownNote: null,
        pilotNo: null,
        monthNo: null,
        car: null,
        good: null,

        // Denormalized Ship Data
        shipName: data.shipName,
        gt: data.grossTonnage,
      };
      await this.tripRepository.addTrip({
        ...outwardTrip,
        ...(auditStamp ?? {}), // Triggers onTripWritten Cloud Function
      });

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
        // Use the helper to decide: live trip (Alongside/Sailed) vs archival (Undefined)
        currentStatus: resolveHistoricalStatus(chargeData.typeTrip, chargeData.boarding),
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
        // IMPORTANT: Firestore rejects JavaScript 'undefined' — use 'null' for optional fields
        // that are intentionally empty. null is stored as a Firestore null type, undefined crashes.
        isConfirmed: false,
        confirmedBy: null,
        confirmedById: null,
        confirmedAt: null,
        
        recordedBy: recordedBy,
        recordedAt: now,
        ownNote: null,
        pilotNo: null,
        monthNo: null,
        car: null,
        good: null,
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
