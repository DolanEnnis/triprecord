import { inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
import { Firestore, query, Timestamp } from '@angular/fire/firestore';
import { combineLatest, forkJoin,  map, Observable, of, switchMap } from 'rxjs';
import { 
  Charge, 
  ChargeableEvent, 
  UnifiedTrip,
  Trip as NewTrip, 
  Visit as NewVisit, 
  TripType, 
  Port 
} from '../../models';

import { ChargeRepository } from '../repositories/charge.repository';
import { TripRepository } from '../repositories/trip.repository';
import { VisitRepository } from '../repositories/visit.repository';


/**
 * UnifiedTripLogService is responsible for fetching and transforming trip-related data
 * from /charges (confirmed) and /trips (unconfirmed) into a unified view model (UnifiedTrip).
 * It orchestrates calls to lower-level repositories.
 */
@Injectable({
  providedIn: 'root',
})
export class UnifiedTripLogService {
  private readonly chargeRepository: ChargeRepository = inject(ChargeRepository);
  private readonly tripRepository: TripRepository = inject(TripRepository);
  private readonly visitRepository: VisitRepository = inject(VisitRepository);
  private readonly injector = inject(Injector);

  // 🛑 REMOVED: getRecentTrips() - Only for old model access
  // 🛑 REMOVED: getUnifiedTripLog() - Only for old model access (Replaced by the new logic below)

  /**
   * Fetches the unified log of confirmed charges (from /charges) and actionable unconfirmed trips (from /trips).
   * This is the canonical method for the new normalized data structure.
   */
  getUnifiedTripLog(): Observable<UnifiedTrip[]> {
    return runInInjectionContext(this.injector, () => {
      const recentCharges$ = this.chargeRepository.getRecentCharges();
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      const threeMonthsAgoTimestamp = Timestamp.fromDate(threeMonthsAgo);

      // 1. Fetch all Trips from the new 'trips' collection
      const trips$ = this.tripRepository.getRecentTrips(threeMonthsAgoTimestamp);

      // 2. Perform the 'join' to fetch parent visit details (shipName/GT)
      const tripsWithVisits$ = trips$.pipe(
        switchMap(trips => {
          if (trips.length === 0) return of({ trips: [], visitsMap: new Map<string, NewVisit>() });

          // Deduplicate visit IDs for lookup
          const visitIds = [...new Set(trips.map(trip => trip.visitId))];

          // Fetch all unique Visit documents (by their Document ID = visitId field from trip)
          const visitObservables = visitIds.map(id =>
            this.visitRepository.getVisitById(id).pipe(map(visit => ({ id, visit })))
          );

          return forkJoin(visitObservables).pipe(
            map((visitResults: { id: string; visit: NewVisit | undefined }[]) => {
              // The visit objects from the repository don't have their own ID.
              // We must create a map where the value is the visit object *with* its ID attached.
              const visitsMap = new Map<string, NewVisit>();
              visitResults.forEach(result => {
                if (result.visit) {
                  visitsMap.set(result.id, { ...result.visit, id: result.id });
                }
              });
              return { trips: trips as NewTrip[], visitsMap };
            })
          );
        })
      );

      // 3. Combine Charges, Trips, and VisitsMap and process
      return combineLatest([recentCharges$, tripsWithVisits$]).pipe(
        map(([charges, { trips, visitsMap }]) => {
          // A. Process Charges (Confirmed items are authoritative)
          const chargesAsUnified: UnifiedTrip[] = charges.map(charge => ({
            id: charge.id,
            ship: charge.ship,
            gt: charge.gt,
            boarding: charge.boarding,
            port: charge.port,
            pilot: charge.pilot,
            typeTrip: charge.typeTrip,
            sailingNote: charge.sailingNote,
            extra: charge.extra,
            source: 'Charge' as const,
            updatedBy: charge.createdBy || 'N/A',
            updateTime: charge.updateTime,
            isActionable: false,
          }));

          // B. Add only UNCONFIRMED trips from the /trips collection
          const tripsAsUnified: UnifiedTrip[] = [];
          for (const trip of trips) {
            const visit = visitsMap.get(trip.visitId);
            const today = new Date();

            // Only process trips that are NOT confirmed, have a boarding time, and are in the past
            if (visit && trip.id && !trip.isConfirmed && trip.boarding && trip.boarding.toDate() <= today) {
              const event = this.createChargeableEvent(visit, trip);

              // If shipName is missing on the visit, fall back to the visitId for debugging.
              // This is better than 'Unknown Ship' as it provides a reference to the corrupt data.
              const shipName = visit.shipName || `[VisitID: ${visit.id}]`;
              const grossTonnage = visit.grossTonnage || 0;
              // We must cast here. When reading from Firestore, a serverTimestamp is always returned as a Timestamp.
              // TypeScript only knows the model's union type (Timestamp | FieldValue), so we assert our knowledge.
              const recordedAt = trip.recordedAt ? (trip.recordedAt as Timestamp).toDate() : new Date();

              tripsAsUnified.push({
                id: trip.id, // The trip document ID
                ship: shipName,
                gt: grossTonnage,
                boarding: trip.boarding.toDate(),
                // Use explicit trip ports, fallback to visit berth
                port: trip.port || visit.berthPort || null,
                pilot: trip.pilot,
                typeTrip: trip.typeTrip,
                extra: trip.extraChargesNotes || '',
                sailingNote: trip.pilotNotes || '',
                source: 'Visit' as const,
                updatedBy: trip.recordedBy,
                updateTime: recordedAt,
                isActionable: true,
                chargeableEvent: event
              });
            }
          }

          // C. Combine and sort.
          const combined = [...chargesAsUnified, ...tripsAsUnified];
          return combined.sort((a, b) => b.boarding.getTime() - a.boarding.getTime());
        })
      );
    });
  }

  // 🛑 REMOVED: v2GetUnifiedTripLog() - Merged logic into getUnifiedTripLog()

  /**
   * Helper function to create a ChargeableEvent from the NEW Visit and Trip models.
   */
  private createChargeableEvent(visit: NewVisit, trip: NewTrip): ChargeableEvent {
    let tripDirection: 'inward' | 'outward' | 'other' = 'other';
    if (trip.typeTrip === 'In') {
      tripDirection = 'inward';
    } else if (trip.typeTrip === 'Out') {
      tripDirection = 'outward';
    }

    // 🛑 CRITICAL FIX: Ensure robust field access from the Visit document
    const shipName = visit.shipName || 'Unknown Ship';
    const grossTonnage = visit.grossTonnage || 0;

    // boarding should not be null here since we check in the caller, but add safety check
    const boardingDate = trip.boarding ? trip.boarding.toDate() : new Date();

    return {
      tripId: trip.id!,
      visitId: visit.id!, // New Visit document ID
      ship: shipName,
      gt: grossTonnage,
      boarding: boardingDate,
      port: trip.port || visit.berthPort || null,
      pilot: trip.pilot || 'Unknown Pilot',
      typeTrip: trip.typeTrip as TripType,
      sailingNote: trip.pilotNotes || '',
      extra: trip.extraChargesNotes || '',
      tripDirection: tripDirection,
      isConfirmed: trip.isConfirmed,
    };
  }
}
