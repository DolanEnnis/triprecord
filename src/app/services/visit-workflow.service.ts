import { inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
import { serverTimestamp, Timestamp, doc, updateDoc } from '@angular/fire/firestore';
import { AuthService } from '../auth/auth';
import { NewVisitData, Trip, TripType, Visit, VisitStatus, Charge } from '../models';
import { ShipRepository } from './ship.repository';
import { VisitRepository } from './visit.repository';
import { TripRepository } from './trip.repository';


@Injectable({
  providedIn: 'root',
})
export class VisitWorkflowService {
  private readonly authService: AuthService = inject(AuthService);
  private readonly shipRepository: ShipRepository = inject(ShipRepository);
  private readonly visitRepository: VisitRepository = inject(VisitRepository);
  private readonly tripRepository: TripRepository = inject(TripRepository);
  private readonly injector = inject(Injector);

  async createNewVisit(data: NewVisitData): Promise<string> {
    return runInInjectionContext(this.injector, async () => {
      const user = this.authService.currentUserSig();
      const now = serverTimestamp();
      const recordedBy = user?.displayName || 'Unknown';
      const initialEtaTimestamp = Timestamp.fromDate(data.initialEta);

      const shipId = await this.shipRepository.findOrCreateShip(data);

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
        boarding: null,  // ETB not yet known
        pilot: data.pilot ?? '',
        port: data.berthPort,
        pilotNotes: data.visitNotes || '',
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
      };
      await this.tripRepository.addTrip(inwardTrip);

      // Create OUTWARD Trip with boarding = null (ETS not yet known)
      const outwardTrip: Omit<Trip, 'id'> = {
        visitId: visitId,
        shipId: shipId,
        typeTrip: 'Out' as TripType,
        boarding: null,  // ETS not yet known
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
        timeOff: null,
        good: null,
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
        visitNotes: `Trip confirmed directly by pilot: ${chargeData.pilot}`,
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
        isConfirmed: true,
        recordedBy: recordedBy,
        recordedAt: now,
        ownNote: null,
        pilotNo: null,
        monthNo: null,
        car: null,
        timeOff: null,
        good: null,
      };
      return this.tripRepository.addTrip(newTrip);
    });
  }

  async arriveShip(visitId: string, port: any): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      const user = this.authService.currentUserSig();
      const now = serverTimestamp();
      const updatedBy = user?.displayName || 'Unknown';

      // Update Visit Status
      await this.visitRepository.updateVisitStatus(visitId, 'Alongside', updatedBy);
    });
  }

  async shiftShip(visitId: string, fromPort: any, toPort: any, pilot: string): Promise<void> {
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
      };
      await this.tripRepository.addTrip(outTrip);

      // 2. Update Visit Status to Sailed
      await this.visitRepository.updateVisitStatus(visitId, 'Sailed', recordedBy);
    });
  }
}
