import { inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
import { collection, collectionData,  Firestore,  query, Timestamp, where } from '@angular/fire/firestore';
import { combineLatest, forkJoin,  map, Observable, of, switchMap } from 'rxjs';
import { Charge, ChargeableEvent, Trip as OldTrip, UnifiedTrip, Visit as OldVisit } from '../models/trip.model';

// Import the new models with explicit aliases to avoid naming collisions.
import { Trip as NewTrip, Visit as NewVisit } from '../models/data.model';

import { ChargeRepository } from './charge.repository';
import { TripRepository } from './trip.repository';
import { VisitRepository } from './visit.repository';

/**
 * UnifiedTripLogService is responsible for fetching and transforming trip-related data
 * from various sources (old visits, new trips, charges) into a unified view model (UnifiedTrip).
 * It orchestrates calls to lower-level repositories.
 */
@Injectable({
  providedIn: 'root',
})
export class UnifiedTripLogService {
  private readonly firestore: Firestore = inject(Firestore);
  private readonly chargeRepository: ChargeRepository = inject(ChargeRepository);
  private readonly tripRepository: TripRepository = inject(TripRepository);
  private readonly visitRepository: VisitRepository = inject(VisitRepository);
  private readonly injector = inject(Injector);

  /**
   * Fetches recent visits and maps their individual trips to ChargeableEvent objects.
   * This method now processes a 'trips' array for flexibility. (Old model logic)
   */
  getRecentTrips(): Observable<ChargeableEvent[]> {
    const visitsCollection = collection(this.firestore, 'visits');
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const recentVisitsQuery = query(
      visitsCollection,
      where('eta', '>=', threeMonthsAgo)
    );
    return (collectionData(recentVisitsQuery, { idField: 'docid' }) as Observable<OldVisit[]>).pipe(
      map((visits) => {
        const chargeableEvents: ChargeableEvent[] = [];
        for (const visit of visits) {
          // Check for the new 'trips' array first
          if (visit.trips && visit.trips.length > 0) {
            for (const trip of visit.trips as OldTrip[]) { // Cast for type safety
              // The direction is now the `typeTrip` field
              if (trip.boarding) {
                chargeableEvents.push(this.createChargeableEvent(visit, trip));
              }
            }
          } else {
            // Fallback for old documents (backward compatibility)
            if (visit.inward && visit.inward.boarding) { // visit.inward is an OldTrip
              chargeableEvents.push(this.createChargeableEvent(visit, visit.inward));
            }
            if (visit.outward && visit.outward.boarding) { // visit.outward is an OldTrip
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
   */
  getUnifiedTripLog(): Observable<UnifiedTrip[]> {
    return runInInjectionContext(this.injector, () => {
      const recentCharges$ = this.chargeRepository.getRecentCharges();
      const visitsCollection = collection(this.firestore, 'visits');
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      const recentVisitsQuery = query(visitsCollection, where('eta', '>=', threeMonthsAgo)); // This queries old model data
      const recentVisits$ = collectionData(recentVisitsQuery, { idField: 'docid' }) as Observable<OldVisit[]>;

      return combineLatest([recentCharges$, recentVisits$]).pipe(
        map(([charges, visits]) => {
          const chargesAsUnified: UnifiedTrip[] = charges.map(charge => ({
            id: charge.id,
            ship: charge.ship,
            gt: charge.gt,
            boarding: charge.boarding,
            port: charge.port,
            pilot: charge.pilot,
            typeTrip: charge.typeTrip,
            sailingNote: (charge as any).sailingNote || (charge as any).note || '',
            extra: charge.extra || '',
            source: 'Charge' as const,
            updatedBy: charge.createdBy || 'N/A',
            updateTime: charge.updateTime,
            isActionable: false,
          }));

          const visitsAsUnified: UnifiedTrip[] = [];
          for (const visit of visits) {
            // Defensive check: If a document is from the NEW model, it won't have `shipInfo`.
            // The v2GetUnifiedTripLog method is responsible for processing these.
            // This prevents the app from crashing on new data.
            if (!visit.shipInfo) {
              continue; // Skip this new-style document.
            }
            if (visit.trips && visit.trips.length > 0) {
              (visit.trips as OldTrip[]).forEach(trip => {
                const today = new Date();
                if (trip.boarding && !trip.confirmed && trip.boarding.toDate() <= today) {
                  const event = this.createChargeableEvent(visit, trip);
                  visitsAsUnified.push({
                    id: (trip as any).id, // Pass the trip ID if it exists on the old model trip
                    ...event,
                    source: 'Visit',
                    updatedBy: visit['updatedBy'] || 'N/A',
                    updateTime: visit['updateTime'] ? new Date(visit['updateTime']) : new Date(),
                    isActionable: true,
                    chargeableEvent: event
                  });
                }
              });
            } else {
              const processOldVisitLeg = (direction: 'inward' | 'outward') => {
                const trip = visit[direction];
                const today = new Date();
                const isConfirmed = direction === 'inward' ? visit.inwardConfirmed : visit.outwardConfirmed;

                if (trip && trip.boarding && !isConfirmed && trip.boarding.toDate() <= today) {
                  const event = this.createChargeableEvent(visit, trip);
                  visitsAsUnified.push({
                    id: (trip as any).id, // Pass the trip ID if it exists on the old model trip
                    ...event,
                    source: 'Visit',
                    updatedBy: visit['updatedBy'] || 'N/A',
                    updateTime: visit['updateTime'] ? new Date(visit['updateTime']) : new Date(),
                    isActionable: true,
                    chargeableEvent: event
                  });
                }
              };
              processOldVisitLeg('inward');
              processOldVisitLeg('outward');
            }
          }

          const combined = [...chargesAsUnified, ...visitsAsUnified];
          return combined.sort((a, b) => b.boarding.getTime() - a.boarding.getTime());
        })
      );
    });
  }

  /**
   * V2: Fetches trips and their associated visit data based on the new normalized schema.
   */
  v2GetUnifiedTripLog(): Observable<UnifiedTrip[]> {
    return runInInjectionContext(this.injector, () => {
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      const threeMonthsAgoTimestamp = Timestamp.fromDate(threeMonthsAgo);

      return this.tripRepository.getRecentTrips(threeMonthsAgoTimestamp).pipe(
        switchMap(trips => {
          if (trips.length === 0) return of([]);

          const visitIds = [...new Set(trips.map(trip => trip.visitId))];
          const visitObservables = visitIds.map(id => this.visitRepository.getVisitById(id).pipe(map(visit => ({ id, visit }))));

          return forkJoin(visitObservables).pipe(
            map((visitResults: { id: string; visit: NewVisit | undefined }[]) => {
              const visitsMap = new Map<string, NewVisit>();
              visitResults.forEach(v => v.visit && visitsMap.set(v.id, v.visit));

              return (trips as NewTrip[]).map(trip => {
                const visit = visitsMap.get(trip.visitId);
                const today = new Date();
                const isActionable = !trip.isConfirmed && trip.boarding.toDate() <= today;

                return {
                  // This is the new model trip, so trip.id is the tripId
                  id: trip.id,
                  ship: visit?.shipName || 'Unknown Ship',
                  gt: visit?.grossTonnage || 0,
                  boarding: trip.boarding.toDate(),
                  port: trip.toPort,
                  pilot: trip.pilot,
                  typeTrip: trip.typeTrip,
                  extra: trip.extraChargesNotes || '',
                  sailingNote: trip.pilotNotes || '',
                  source: isActionable ? 'Visit' : 'Charge',
                  updatedBy: trip.recordedBy,
                  updateTime: trip.recordedAt.toDate(),
                  isActionable: isActionable,
                  // CRITICAL FIX: The chargeableEvent object must be created for the dialog to work.
                  // We build it here from the new model's trip and visit data.
                  chargeableEvent: isActionable ? {
                    tripId: trip.id, // This is the crucial ID
                    visitDocId: trip.visitId,
                    ship: visit?.shipName || 'Unknown Ship',
                    gt: visit?.grossTonnage || 0,
                    boarding: trip.boarding.toDate(),
                    port: trip.toPort,
                    pilot: trip.pilot,
                    typeTrip: trip.typeTrip,
                    sailingNote: trip.pilotNotes || '',
                    extra: trip.extraChargesNotes || '',
                    tripDirection: trip.typeTrip === 'In' ? 'inward' : 'outward', // Best guess mapping
                    isConfirmed: trip.isConfirmed,
                  } : undefined,
                } as UnifiedTrip;
              });
            })
          );
        })
      );
    });
  }

  /**
   * Helper function to create a ChargeableEvent from an old Visit and Trip.
   * This remains here as it's part of the transformation logic for the old model.
   */
  private createChargeableEvent(visit: OldVisit, trip: OldTrip, tripDirection?: 'inward' | 'outward'): ChargeableEvent {
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
      // CRITICAL FIX: Pass the tripId from the old trip object into the event.
      tripId: (trip as any).id,
      visitDocId: visit.docid,
      ship: visit.shipInfo.ship,
      gt: visit.shipInfo.gt,
      boarding: trip.boarding.toDate(),
      port: trip.port,
      pilot: pilotName,
      typeTrip: trip.typeTrip,
      sailingNote: '',
      extra: trip.extra || '',
      tripDirection: tripDirection || (trip.typeTrip === 'In' ? 'inward' : 'outward'),
      isConfirmed: isConfirmed,
    };
  }
}
