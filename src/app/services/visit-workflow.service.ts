import { inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
import { serverTimestamp, Timestamp, doc, updateDoc } from '@angular/fire/firestore';
import { AuthService } from '../auth/auth';
import { NewVisitData, Trip, TripType, Visit, VisitStatus } from '../models/data.model';
import { Charge } from '../models/trip.model';
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

      const newVisit: Omit<Visit, 'id'> = {
        shipId: shipId,
        shipName: data.shipName,
        grossTonnage: data.grossTonnage,
        currentStatus: 'Due' as VisitStatus,
        initialEta: initialEtaTimestamp,
        berthPort: data.berthPort,
        visitNotes: data.visitNotes,
        statusLastUpdated: now,
        updatedBy: recordedBy,
      };
      const visitId = await this.visitRepository.addVisit(newVisit);

      const initialTrip: Omit<Trip, 'id'> = {
        visitId: visitId,
        shipId: shipId,
        typeTrip: 'In' as TripType,
        boarding: initialEtaTimestamp,
        pilot: data.pilot ?? user?.displayName ?? '',
        fromPort: null,
        toPort: data.berthPort,
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
      await this.tripRepository.addTrip(initialTrip);

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
        fromPort: chargeData.typeTrip === 'In' ? null : chargeData.port,
        toPort: chargeData.typeTrip === 'Out' ? null : chargeData.port,
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
        fromPort: fromPort,
        toPort: toPort,
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
        fromPort: visit.berthPort,
        toPort: null,
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
