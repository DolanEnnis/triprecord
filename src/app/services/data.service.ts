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
  orderBy,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import { combineLatest, from, map, Observable, of } from 'rxjs';
import { Charge, ChargeableEvent, UnifiedTrip, Visit } from '../models/trip.model';
import { AuthService } from '../auth/auth';

@Injectable({
  providedIn: 'root',
})
export class DataService {
  private readonly firestore: Firestore = inject(Firestore);
  private readonly authService: AuthService = inject(AuthService);
  private readonly injector = inject(Injector);

  /**
   * Fetches recent visits and maps their inward/outward legs to ChargeableEvent objects,
   * noting which ones are already confirmed.
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
          if (visit.inward && visit.inward.boarding) {
            chargeableEvents.push(this.createChargeableEvent(visit, 'inward'));
          }
          if (visit.outward && visit.outward.boarding) {
            chargeableEvents.push(this.createChargeableEvent(visit, 'outward'));
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
          const chargesAsUnified: UnifiedTrip[] = charges.map(charge => ({
            id: charge.id,
            ship: charge.ship,
            gt: charge.gt,
            boarding: charge.boarding,
            port: charge.port,
            pilot: charge.pilot,
            typeTrip: charge.typeTrip,
            // Handle legacy `note` field and new `sailingNote` field from charges.
            sailingNote: (charge as any).sailingNote || (charge as any).note || '',
            extra: charge.extra || '',
            source: 'Charge' as const,
            updatedBy: charge.createdBy || 'N/A',
            updateTime: charge.updateTime,
            isActionable: false,
          }));

          const visitsAsUnified: UnifiedTrip[] = [];
          for (const visit of visits) {
            const processVisitLeg = (direction: 'inward' | 'outward') => {
              const trip = visit[direction];
              const today = new Date();
              const isConfirmed = direction === 'inward' ? visit.inwardConfirmed : visit.outwardConfirmed;
              // We only care about trips that have happened.
              if (trip && trip.boarding && !isConfirmed && trip.boarding.toDate() <= today) {
                const event = this.createChargeableEvent(visit, direction);
                visitsAsUnified.push({
                  ...event,
                  source: 'Visit',
                  updatedBy: visit['updatedBy'] || 'N/A',
                  // The updateTime from a visit might not exist, provide a fallback.
                  updateTime: visit['updateTime'] ? new Date(visit['updateTime']) : new Date(),
                  isActionable: true,
                  chargeableEvent: event });
              }
            };
            processVisitLeg('inward');
            processVisitLeg('outward');
          }

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
      where('ship', '>=', search),
      where('ship', '<=', search + '\uf8ff') // Standard prefix search trick
    );

    return from(getDocs(q)).pipe(
      map(snapshot => {
        // Use a Map to ensure ship names are unique in the suggestion list.
        const ships = new Map<string, number>();
        snapshot.docs.forEach(doc => {
          const data = doc.data();
          ships.set(data['ship'], data['gt']);
        });
        // Return an array of objects, limiting to the top 10 results.
        return Array.from(ships, ([ship, gt]) => ({ ship, gt })).slice(0, 10);
      })
    );
  }

  /**
   * Helper to transform a Visit and a trip direction into a ChargeableEvent.
   */
  private createChargeableEvent(visit: Visit, direction: 'inward' | 'outward'): ChargeableEvent {
    const trip = visit[direction]!; // Non-null assertion is safe due to prior check
    const isConfirmed = direction === 'inward' ? visit.inwardConfirmed === true : visit.outwardConfirmed === true;

    // A map to handle pilot name replacements. This is a good place for data cleaning.
    const pilotNameMap: { [key: string]: string } = {
      'Fergal': 'WMcN',
      'Fintan': 'Matt',
    };
    const originalPilot = trip.pilot || '';
    const pilotName = pilotNameMap[originalPilot] || originalPilot;

    return {
      visitDocId: visit.docid,
      ship: visit.ship,
      gt: visit.gt,
      boarding: trip.boarding.toDate(), // Convert Firestore Timestamp to JS Date
      port: trip.port,
      pilot: pilotName,
      typeTrip: trip.typeTrip,
      sailingNote: '', // This is for user input about the sailing, starts empty.
      extra: trip.extra || '',
      tripDirection: direction,
      isConfirmed: isConfirmed,
    };
  }
}
