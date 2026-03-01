import { inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
import { Firestore, query, Timestamp } from '@angular/fire/firestore';
import { combineLatest, forkJoin,  map, Observable, of, switchMap, firstValueFrom } from 'rxjs';
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
  // MIGRATION UPDATE: Removed ChargeRepository dependency.
  private readonly tripRepository: TripRepository = inject(TripRepository);
  private readonly visitRepository: VisitRepository = inject(VisitRepository);
  private readonly injector = inject(Injector);

  /**
   * Fetches the unified log of confirmed trips and actionable unconfirmed trips.
   * 
   * MIGRATION UPDATE (Step 5):
   * - Reads solely from /trips.
   * - Confirmed trips (isConfirmed=true) are treated as "Charges" and use their internal billing fields.
   * - Unconfirmed trips (isConfirmed=false) are joined with /visits to get ship metadata.
   */
  getUnifiedTripLog(): Observable<UnifiedTrip[]> {
    return runInInjectionContext(this.injector, () => {
      // 1. Fetch recent trips (last 3 months)
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      const threeMonthsAgoTimestamp = Timestamp.fromDate(threeMonthsAgo);
      const trips$ = combineLatest([
        this.tripRepository.getRecentTrips(threeMonthsAgoTimestamp)
      ]).pipe(
        map(([recent]) => {
          // RESTORED LEGACY BEHAVIOR: Only show "Recent" trips (those with a date within 3 months).
          // Removed 'Pending' (Undated) trips processing entirely as they should not appear in Trip Confirmation.
          
          // Safety: Deduplicate by ID just in case
          const uniqueTrips = Array.from(new Map(recent.map(t => [t.id, t])).values());
          
          return uniqueTrips;
        })
      );

      // 2. Perform the 'join' to fetch parent visit details for UNCONFIRMED trips
      // (Confirmed trips already have shipName/gt denormalized)
      return trips$.pipe(
        switchMap(trips => {
          if (trips.length === 0) return of([]);

          // Reverting optimization for safety: Fetch visits for ALL trips to ensure no data is missed.
          // We can re-introduce the filter later once data is consistent.
          const visitIds = [...new Set(
            trips
              .map(trip => trip.visitId)
              .filter((id): id is string => id !== undefined)
          )];

          // Fetch all unique Visit documents
          const visitObservables = visitIds.map(id =>
            this.visitRepository.getVisitById(id).pipe(map(visit => ({ id, visit })))
          );

          // If no visits to fetch (all standalone trips?), just return trips with empty map
          const visits$ = visitIds.length > 0 
            ? forkJoin(visitObservables).pipe(
                map(results => {
                  const map = new Map<string, NewVisit>();
                  results.forEach(r => {
                    if (r.visit) map.set(r.id, { ...r.visit, id: r.id });
                  });
                  return map;
                })
              )
            : of(new Map<string, NewVisit>());

          return combineLatest([of(trips), visits$]);
        }),
        map(([trips, visitsMap]) => {
          const unifiedTrips: UnifiedTrip[] = [];

          for (const trip of trips) {
            const visit = trip.visitId ? visitsMap.get(trip.visitId) : undefined;
            // Robust date conversion
            const tripDate = this.toSafeDate(trip.boarding);

            if (trip.isConfirmed) {
              // ===========================================
              // CONFIRMED TRIP (Equivalent to old 'Charge')
              // ===========================================
              const shipName = trip.shipName || visit?.shipName || 'Unknown Ship';
              const gt = trip.gt || visit?.grossTonnage || 0;
              
              unifiedTrips.push({
                id: trip.id!,
                visitId: trip.visitId,
                ship: shipName,
                gt: gt,
                boarding: tripDate, // Do NOT default to new Date() if missing. Let it be null.
                isPending: !trip.boarding, // Flag if original boarding date was null
                port: trip.port || null,
                pilot: trip.pilot || 'Unknown',
                typeTrip: trip.typeTrip,
                sailingNote: trip.pilotNotes || '',
                extra: trip.extraChargesNotes || '',
                source: 'Charge',
                updatedBy: trip.lastModifiedBy || trip.confirmedBy || trip.recordedBy || 'System',
                updateTime: this.toSafeDate(trip.lastModifiedAt) || this.toSafeDate(trip.confirmedAt) || tripDate || new Date(),
                isActionable: false,
                pilotNo: trip.pilotNo,
                monthNo: trip.monthNo,
                good: trip.good,
                car: trip.car,
                docketUrl: trip.docketUrl,
                docketPath: trip.docketPath,
                docketType: trip.docketType,
              });

            } else {
              // ===========================================
              // UNCONFIRMED TRIP (Actionable)
              // ===========================================
              // Reverting to End of Day to include Today's active trips (User verified "lazy workaround" was bad)
              const today = new Date();
              today.setHours(23, 59, 59, 999);

              // Include ONLY if it has a date AND that date is today or in the past.
              // Pending trips (null date) or Future trips (Tomorrow+) are excluded.
              if (tripDate && tripDate <= today) {
                const shipName = visit?.shipName || (trip.visitId ? `[Visit: ${trip.visitId}]` : 'Unknown Ship (Standalone)');
                const gt = visit?.grossTonnage || 0;

                const event = this.createChargeableEvent(visit, trip, shipName, gt);

                unifiedTrips.push({
                  id: trip.id!,
                  visitId: trip.visitId,
                  ship: shipName,
                  gt: gt,
                  boarding: tripDate,
                  isPending: !trip.boarding, // Flag if original boarding date was null
                  port: trip.port || visit?.berthPort || null,
                  pilot: trip.pilot || '',
                  typeTrip: trip.typeTrip,
                  sailingNote: trip.pilotNotes || '',
                  extra: trip.extraChargesNotes || '',
                  source: 'Visit',
                  updatedBy: trip.lastModifiedBy || trip.recordedBy || 'System',
                  updateTime: this.toSafeDate(trip.lastModifiedAt) || this.toSafeDate(trip.recordedAt, tripDate),
                  isActionable: true,
                  chargeableEvent: event,
                  pilotNo: trip.pilotNo,
                  monthNo: trip.monthNo,
                  good: trip.good,
                  car: trip.car,
                  docketUrl: trip.docketUrl,
                  docketPath: trip.docketPath,
                  docketType: trip.docketType,
                });
              }
            }
          }

          // Sort by date descending, BUT put Pending items (no boarding date yet) at the bottom.
          return unifiedTrips.sort((a, b) => {
            if (a.isPending && !b.isPending) return 1; // A is pending -> A goes bottom
            if (!a.isPending && b.isPending) return -1; // B is pending -> B goes bottom
            // TypeScript check: both have dates if not pending
            const dateA = a.boarding ? a.boarding.getTime() : 0;
            const dateB = b.boarding ? b.boarding.getTime() : 0;
            return dateB - dateA;
          });
        })
      );
    });
  }

  /**
   * Helper to safely convert Firestore timestamps or Dates to JS Date.
   * Handles Timestamp, Date, string, or returns fallback.
   */
  private toSafeDate(val: any, fallback: Date | null = null): Date | null {
    if (!val) return fallback;
    if (val instanceof Timestamp) return val.toDate();
    if (val instanceof Date) return val;
    // Handle duck-typing for Timestamp objects that lost prototype
    if (typeof val === 'object' && typeof val.seconds === 'number' && typeof val.toDate === 'function') {
      return val.toDate();
    }
    return fallback;
  }

  /**
   * Helper function to create a ChargeableEvent from the NEW Visit and Trip models.
   */
  private createChargeableEvent(
    visit: NewVisit | undefined, 
    trip: NewTrip, 
    shipName: string, 
    gt: number
  ): ChargeableEvent {
    let tripDirection: 'inward' | 'outward' | 'other' = 'other';
    if (trip.typeTrip === 'In') {
      tripDirection = 'inward';
    } else if (trip.typeTrip === 'Out') {
      tripDirection = 'outward';
    }

    const boardingDate = this.toSafeDate(trip.boarding);

    return {
      tripId: trip.id!,
      visitId: visit?.id || trip.visitId!, 
      ship: shipName,
      gt: gt,
      boarding: boardingDate || null, // Ensure it's null if undefined
      port: trip.port || visit?.berthPort || null,
      pilot: trip.pilot || 'Unknown Pilot',
      typeTrip: trip.typeTrip as TripType,
      sailingNote: trip.pilotNotes || '',
      extra: trip.extraChargesNotes || '',
      tripDirection: tripDirection,
      isConfirmed: false,
      docketUrl: trip.docketUrl,
      docketPath: trip.docketPath,
      docketType: trip.docketType,
      pilotNo: trip.pilotNo,
      monthNo: trip.monthNo,
      good: trip.good,
      car: trip.car,
    };
  }

  /**
   * One-time repair utility to fix recent trips that are missing shipName/gt.
   * This denormalizes the data so the new optimization works for everything.
   */
  async repairRecentTrips(): Promise<number> {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const threeMonthsAgoTimestamp = Timestamp.fromDate(threeMonthsAgo);
    
    // 1. Get recent trips
    const trips = await firstValueFrom(this.tripRepository.getRecentTrips(threeMonthsAgoTimestamp));
    
    // 2. Filter for those missing data
    const brokenTrips = trips.filter(t => !t.isConfirmed && (!t.shipName || !t.gt) && t.visitId);
    
    if (brokenTrips.length === 0) return 0;
    
    console.log(`Found ${brokenTrips.length} trips to repair.`);
    
    // 3. Update them one by one
    let repairedCount = 0;
    const uniqueVisitIds = [...new Set(brokenTrips.map(t => t.visitId!))];
    
    for (const visitId of uniqueVisitIds) {
      const visit = await firstValueFrom(this.visitRepository.getVisitById(visitId));
      if (visit) {
        const tripsForVisit = brokenTrips.filter(t => t.visitId === visitId);
        
        for (const trip of tripsForVisit) {
            await this.tripRepository.updateTrip(trip.id!, {
                shipName: visit.shipName,
                gt: visit.grossTonnage
            });
            repairedCount++;
        }
      }
    }
    
    return repairedCount;
  }
}
