import { inject, Injectable, Injector, runInInjectionContext, computed } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  collection, collectionData, Firestore, query, where, Timestamp
} from '@angular/fire/firestore';
import { Observable, switchMap, of, map } from 'rxjs';
import { Visit, Trip, VisitStatus } from '../../models';
import { VisitRepository } from '../repositories/visit.repository';

/**
 * A Visit enriched with the trips we need for calendar markers.
 * Keeping the interface local avoids coupling the rest of the app to this view.
 */
export interface HydratedVisit extends Visit {
  /** The 'In' trip (inward boarding). Provides ETB time. */
  inwardTrip?: Trip | null;
  /** The 'Out' trip (outward boarding). Provides ETS time (future use). */
  outwardTrip?: Trip | null;
}

/**
 * RiverStateService manages real-time state of active vessel visits,
 * hydrated with their trip data for calendar display.
 *
 * WHY SIGNALS?
 * toSignal() handles Observable subscription/unsubscription automatically.
 * computed() derives filtered views without manual subscriptions.
 *
 * SINGLE-QUERY HYDRATION:
 * Instead of one Firestore read per ship, we issue ONE query:
 *   where('visitId', 'in', [...activeVisitIds])
 * This returns all trips for all active ships in a single round-trip,
 * then we join in memory.  Supports up to 30 active ships (Firestore 'in' limit).
 */
@Injectable({
  providedIn: 'root'
})
export class RiverStateService {
  private readonly firestore = inject(Firestore);
  private readonly visitRepository = inject(VisitRepository);
  private readonly injector = inject(Injector);

  /**
   * Real-time stream of active visits.
   * Kept as an Observable here so we can pipe it through switchMap for hydration.
   */
  private readonly _visits$: Observable<Visit[]> = runInInjectionContext(this.injector, () => {
    const activeStatuses: VisitStatus[] = ['Due', 'Awaiting Berth', 'Alongside'];
    const activeVisitsQuery = query(
      collection(this.firestore, 'visits_new'),
      where('currentStatus', 'in', activeStatuses)
    );
    return collectionData(activeVisitsQuery, { idField: 'id' }) as Observable<Visit[]>;
  });

  /**
   * Active visits hydrated with inward/outward trip data.
   *
   * Pipeline:
   *   active visits → switchMap (cancels previous) →
   *   single trip batch query → join in memory →
   *   Signal<HydratedVisit[]>
   *
   * WHY switchMap?
   * When the visit list changes (ship added/removed), switchMap cancels the
   * previous inner trip subscription and starts a fresh one automatically.
   * This prevents stale data leaking into the calendar.
   */
  readonly activeShipsWithTrips = runInInjectionContext(this.injector, () =>
    toSignal(
      this._visits$.pipe(
        switchMap(visits => {
          if (visits.length === 0) return of([] as HydratedVisit[]);

          const visitIds = visits.map(v => v.id!).filter(Boolean);

          // ONE Firestore query for all trips across all active visits.
          // Firestore 'in' supports up to 30 elements.
          const tripsQuery = query(
            collection(this.firestore, 'trips'),
            where('visitId', 'in', visitIds)
          );

          return (collectionData(tripsQuery, { idField: 'id' }) as Observable<Trip[]>).pipe(
            map(trips => {
              // Group trips by visitId in memory for O(1) lookup
              const tripMap = new Map<string, { inward?: Trip; outward?: Trip }>();
              for (const trip of trips) {
                if (!trip.visitId) continue;
                const group = tripMap.get(trip.visitId) ?? {};
                if (trip.typeTrip === 'In') group.inward = trip;
                if (trip.typeTrip === 'Out') group.outward = trip;
                tripMap.set(trip.visitId, group);
              }

              // Attach trip data to each visit
              return visits.map(v => ({
                ...v,
                inwardTrip:  tripMap.get(v.id!)?.inward  ?? null,
                outwardTrip: tripMap.get(v.id!)?.outward ?? null,
              } as HydratedVisit));
            })
          );
        })
      ),
      { initialValue: [] as HydratedVisit[] }
    )
  );

  /** Convenience alias — all active ships regardless of status */
  readonly activeShips = computed(() => this.activeShipsWithTrips());

  /** Due ships sorted by ETA */
  readonly dueShips = computed(() =>
    this.activeShipsWithTrips()
      .filter(v => v.currentStatus === 'Due')
      .sort((a, b) => this.compareTimestamps(a.initialEta, b.initialEta))
  );

  /** Awaiting-berth ships sorted by ETA */
  readonly awaitingBerthShips = computed(() =>
    this.activeShipsWithTrips()
      .filter(v => v.currentStatus === 'Awaiting Berth')
      .sort((a, b) => this.compareTimestamps(a.initialEta, b.initialEta))
  );

  /** Alongside ships sorted by ETA */
  readonly alongsideShips = computed(() =>
    this.activeShipsWithTrips()
      .filter(v => v.currentStatus === 'Alongside')
      .sort((a, b) => this.compareTimestamps(a.initialEta, b.initialEta))
  );

  private compareTimestamps(
    a: Timestamp | Date | string,
    b: Timestamp | Date | string
  ): number {
    const toMs = (v: Timestamp | Date | string) =>
      v instanceof Timestamp ? v.toMillis() : new Date(v).getTime();
    return toMs(a) - toMs(b);
  }
}


