import { inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
import {
  addDoc,
  collection,
  collectionData,
  deleteDoc,
  doc,
  Firestore,
  query,
  getDocs,
  limit,
  orderBy,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  getDoc,
} from '@angular/fire/firestore';
import { combineLatest, from, map, Observable, of, switchMap, forkJoin } from 'rxjs';
import { Charge, ChargeableEvent, Trip, UnifiedTrip, Visit } from '../models/trip.model';
// Import new models with aliases to prevent naming conflicts during transition
import {
  Trip as NewTrip,
  Visit as NewVisit,
  Ship as NewShip,
  TripType
} from '../models/data.model';
import { AuthService } from '../auth/auth';

@Injectable({
  providedIn: 'root',
})
export class DataService {
  private readonly firestore: Firestore = inject(Firestore);
  private readonly authService: AuthService = inject(AuthService);
  private readonly injector = inject(Injector);

  /**
   * Fetches recent visits and maps their individual trips to ChargeableEvent objects.
   * This method now processes a 'trips' array for flexibility.
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

  getUnifiedTripLog(): Observable<UnifiedTrip[]> {
    return runInInjectionContext(this.injector, () => {
      const recentCharges$ = this.getRecentCharges();
      const visitsCollection = collection(this.firestore, 'visits');
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      const recentVisitsQuery = query(visitsCollection, where('eta', '>=', threeMonthsAgo));
      const recentVisits$ = collectionData(recentVisitsQuery, { idField: 'docid' }) as Observable<Visit[]>;

      return combineLatest([recentCharges$, recentVisits$]).pipe(
        map(([charges, visits]) => {
          // Step 1: Process charges. These are always the source of truth for confirmed trips.
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

          // Step 2: Process visits, but ONLY if they are not confirmed yet.
          const visitsAsUnified: UnifiedTrip[] = [];
          for (const visit of visits) {
            // First, process the new 'trips' array if it exists
            if (visit.trips && visit.trips.length > 0) {
              visit.trips.forEach(trip => {
                const today = new Date();
                // We only process trips that are not confirmed and have a past boarding date.
                if (trip.boarding && !trip.confirmed && trip.boarding.toDate() <= today) {
                  const event = this.createChargeableEvent(visit, trip);
                  visitsAsUnified.push({
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
              // Fallback for old documents (backward compatibility)
              const processOldVisitLeg = (direction: 'inward' | 'outward') => {
                const trip = visit[direction];
                const today = new Date();
                const isConfirmed = direction === 'inward' ? visit.inwardConfirmed : visit.outwardConfirmed;

                if (trip && trip.boarding && !isConfirmed && trip.boarding.toDate() <= today) {
                  const event = this.createChargeableEvent(visit, trip);
                  visitsAsUnified.push({
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

          // Step 3: Combine and sort. No need for de-duplication logic here, as we have handled it above.
          const combined = [...chargesAsUnified, ...visitsAsUnified];
          return combined.sort((a, b) => b.boarding.getTime() - a.boarding.getTime());
        })
      );
    });
  }

  /**
   * Fetches charge documents from the last 60 days.
   * This logic was merged from the former ChargesService.
   */
  private getRecentCharges(): Observable<Charge[]> {
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    const sixtyDaysAgoTimestamp = Timestamp.fromDate(sixtyDaysAgo);

    const chargesRef = collection(this.firestore, 'charges');
    const q = query(
      chargesRef,
      where('boarding', '>=', sixtyDaysAgoTimestamp),
      where('boarding', '<=', Timestamp.now()), // Exclude future-dated charges
      orderBy('boarding', 'desc')
    );

    return from(getDocs(q)).pipe(
      map((snapshot) =>
        snapshot.docs.map((doc): Charge => {
          const data = doc.data();
          // Manually construct the Charge object, converting Timestamps to Dates. We include a
          // check for the existence of the .toDate method to handle potential data
          // inconsistencies where a field might not be a Firestore Timestamp.
          const boardingDate = data['boarding'] && typeof data['boarding'].toDate === 'function' ? data['boarding'].toDate() : new Date();
          const updateDate = data['updateTime'] && typeof data['updateTime'].toDate === 'function' ? data['updateTime'].toDate() : new Date();

          return {
            id: doc.id,
            ship: data['ship'],
            gt: data['gt'],
            port: data['port'],
            pilot: data['pilot'],
            typeTrip: data['typeTrip'],
            // Handle legacy `note` field and new `sailingNote` field for backward compatibility.
            sailingNote: data['sailingNote'] || data['note'] || '',
            extra: data['extra'],
            boarding: boardingDate,
            updateTime: updateDate,
            createdBy: data['createdBy'] || '',
            createdById: data['createdById'] || '',
          };
        })
      )
    );
  }

  /**
   * Creates a new document in the 'charges' collection and updates the
   * corresponding 'visits' document to mark the trip as confirmed.
   * @param chargeData - The data for the new charge, from the form.
   * @param visitDocId - The ID of the visit document to update.
   * @param tripDirection - The direction of the trip ('inward' or 'outward') to confirm.
   */
  async createChargeAndUpdateVisit(
    chargeData: Omit<Charge, 'updateTime' | 'createdBy' | 'createdById'>,
    visitDocId: string,
    tripDirection: 'inward' | 'outward'
  ) {
    return runInInjectionContext(this.injector, async () => {
      // 1. Add a new document to 'charges' collection with a server-generated timestamp.
      const chargesCollection = collection(this.firestore, 'charges');
      await addDoc(chargesCollection, {
        ...chargeData,
        updateTime: serverTimestamp(),
        createdBy: this.authService.currentUserSig()?.displayName || 'Unknown',
        createdById: this.authService.currentUserSig()?.uid || 'Unknown',
      });

      // 2. Update the original visit document to confirm the trip.
      const visitDocRef = doc(this.firestore, `visits/${visitDocId}`);
      const updateData = tripDirection === 'inward' ? { inwardConfirmed: true } : { outwardConfirmed: true };
      await updateDoc(visitDocRef, updateData);
    });
  }

  /**
   * Creates a new document in the 'charges' collection without an associated visit.
   * @param chargeData - The data for the new charge, from the form.
   */
  async createStandaloneCharge(chargeData: Omit<Charge, 'updateTime' | 'createdBy' | 'createdById'>): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      const chargesCollection = collection(this.firestore, 'charges');
      const newCharge = {
        ...chargeData,
        updateTime: serverTimestamp(),
        createdBy: this.authService.currentUserSig()?.displayName || 'Unknown',
        createdById: this.authService.currentUserSig()?.uid || 'Unknown',
      };
      await addDoc(chargesCollection, newCharge);
    });
  }

  /**
   * Updates an existing charge document in Firestore.
   * @param chargeId The ID of the charge document to update.
   * @param chargeData The new data for the charge.
   */
  async updateCharge(chargeId: string, chargeData: Partial<Charge>): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      const chargeDocRef = doc(this.firestore, `charges/${chargeId}`);
      await updateDoc(chargeDocRef, {
        ...chargeData,
        // Overwrite updateTime and the 'by' fields on every edit.
        updateTime: serverTimestamp(),
        createdBy: this.authService.currentUserSig()?.displayName || 'Unknown',
        createdById: this.authService.currentUserSig()?.uid || 'Unknown',
      });
    });
  }

  /**
   * Deletes a charge document from Firestore.
   * @param chargeId The ID of the charge document to delete.
   */
  async deleteCharge(chargeId: string): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      const chargeDocRef = doc(this.firestore, `charges/${chargeId}`);
      await deleteDoc(chargeDocRef);
    });
  }

  /**
   * Checks if a charge that matches the given criteria already exists to prevent duplicates.
   * @param chargeData The core fields of the charge to check for.
   */
  async doesChargeExist(chargeData: { ship: string; boarding: Date; typeTrip: string }): Promise<boolean> {
    return runInInjectionContext(this.injector, async () => {
      const chargesCollection = collection(this.firestore, 'charges');

      // To check for duplicates on the same day, we create a date range for the query.
      const startOfDay = new Date(chargeData.boarding);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(chargeData.boarding);
      endOfDay.setHours(23, 59, 59, 999);

      // NOTE: This query requires a composite index in Firestore.
      // The browser console will log an error with a link to create it automatically.
      const q = query(
        chargesCollection,
        where('ship', '==', chargeData.ship),
        where('typeTrip', '==', chargeData.typeTrip),
        where('boarding', '>=', startOfDay),
        where('boarding', '<=', endOfDay)
      );

      const querySnapshot = await getDocs(q);
      return !querySnapshot.empty;
    });
  }

  /**
   * Gets ship name and GT suggestions from recent visits for autocomplete.
   * @param search The string to search for.
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
   * V2: Fetches trips and their associated visit data based on the new normalized schema.
   * This will replace getUnifiedTripLog once the data migration is complete.
   */
  v2GetUnifiedTripLog(): Observable<UnifiedTrip[]> {
    return runInInjectionContext(this.injector, () => {
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      const threeMonthsAgoTimestamp = Timestamp.fromDate(threeMonthsAgo);

      // 1. Query the top-level 'trips' collection for recent trips.
      const tripsCollection = collection(this.firestore, 'trips');
      const recentTripsQuery = query(
        tripsCollection,
        where('boarding', '>=', threeMonthsAgoTimestamp),
        orderBy('boarding', 'desc')
      );

      return (collectionData(recentTripsQuery, { idField: 'id' }) as Observable<NewTrip[]>).pipe(
        // 2. For each batch of trips, fetch their parent visit documents.
        switchMap(trips => {
          if (trips.length === 0) {
            return of([]); // No trips, no need to fetch visits.
          }

          // Create a unique set of visit IDs to fetch.
          const visitIds = [...new Set(trips.map(trip => trip.visitId))];

          // Create an observable for each visit document lookup.
          const visitDocObservables = visitIds.map(id => {
            const visitDocRef = doc(this.firestore, `visits/${id}`);
            return from(getDoc(visitDocRef)).pipe(
              map(docSnap => ({ id, data: docSnap.data() as NewVisit | undefined }))
            );
          });

          // 3. Execute all visit lookups and combine results.
          return forkJoin(visitDocObservables).pipe(
            map(visitDocs => {
              // Create a Map for quick lookup of visit data by ID.
              const visitsMap = new Map<string, NewVisit>();
              visitDocs.forEach(v => {
                if (v.data) {
                  visitsMap.set(v.id, v.data);
                }
              });

              // 4. Map the trips to the UnifiedTrip view model.
              return trips.map(trip => {
                const visit = visitsMap.get(trip.visitId);
                const today = new Date();

                // An unconfirmed trip from the new model is "actionable" if its boarding time is in the past.
                const isActionable = !trip.isConfirmed && trip.boarding.toDate() <= today;

                return {
                  id: trip.id,
                  ship: visit?.shipName || 'Unknown Ship',
                  gt: visit?.grossTonnage || 0,
                  boarding: trip.boarding.toDate(),
                  port: trip.toPort, // Using 'toPort' from the new model
                  pilot: trip.pilot,
                  typeTrip: trip.typeTrip,
                  extra: trip.extraChargesNotes || '',
                  sailingNote: trip.pilotNotes || '',
                  source: isActionable ? 'Visit' : 'Charge', // Conceptual mapping
                  updatedBy: trip.recordedBy,
                  updateTime: trip.recordedAt.toDate(),
                  isActionable: isActionable,
                  // chargeableEvent would be built here if needed for the dialog
                } as UnifiedTrip;
              });
            })
          );
        })
      );
    });
  }

  /**
   * V2: Gets ship name and GT suggestions from the master '/ships' collection.
   * This is more efficient and accurate than querying historical visits.
   * @param search The string to search for.
   */
  v2GetShipSuggestions(search: string): Observable<{ ship: string, gt: number }[]> {
    if (!search || search.length < 2) {
      return of([]);
    }

    const shipsCollection = collection(this.firestore, 'ships');
    // NOTE: This query requires an index on 'shipName'.
    const q = query(
      shipsCollection,
      where('shipName', '>=', search),
      where('shipName', '<=', search + '\uf8ff'),
      orderBy('shipName'),
      limit(10)
    );

    return (collectionData(q) as Observable<NewShip[]>).pipe(
      map(ships => ships.map(ship => ({ ship: ship.shipName, gt: ship.grossTonnage })))
    );
  }
}
