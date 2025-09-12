import { inject, Injectable } from '@angular/core';
import {
  addDoc,
  collection,
  collectionData,
  doc,
  Firestore,
  query,
  getDocs,
  serverTimestamp,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import { combineLatest, from, map, Observable, of } from 'rxjs';
import { Charge, ChargeableEvent, UnifiedTrip, Visit } from '../models/trip.model';
import { ChargesService } from './charges.service';
import { AuthService } from '../auth/auth';

@Injectable({
  providedIn: 'root',
})
export class DataService {
  private readonly firestore: Firestore = inject(Firestore);
  private readonly authService: AuthService = inject(AuthService);
  private readonly chargesService: ChargesService = inject(ChargesService);

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
    const recentCharges$ = this.chargesService.getRecentCharges();

    const visitsCollection = collection(this.firestore, 'visits');
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const recentVisitsQuery = query(visitsCollection, where('eta', '>=', threeMonthsAgo));
    const recentVisits$ = collectionData(recentVisitsQuery, { idField: 'docid' }) as Observable<Visit[]>;

    return combineLatest([recentCharges$, recentVisits$]).pipe(
      map(([charges, visits]) => {
        const chargesAsUnified: UnifiedTrip[] = charges.map(charge => ({
          ship: charge.ship,
          gt: charge.gt,
          boarding: charge.boarding,
          port: charge.port,
          pilot: charge.pilot,
          typeTrip: charge.typeTrip,
          note: charge.note || '',
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
              visitsAsUnified.push({ ...event, source: 'Visit', updatedBy: visit['updatedBy'] || 'N/A', updateTime: new Date(visit['updateTime']), isActionable: true, chargeableEvent: event });
            }
          };
          processVisitLeg('inward');
          processVisitLeg('outward');
        }

        const combined = [...chargesAsUnified, ...visitsAsUnified];
        return combined.sort((a, b) => b.boarding.getTime() - a.boarding.getTime());
      })
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
  }

  /**
   * Creates a new document in the 'charges' collection without an associated visit.
   * @param chargeData - The data for the new charge, from the form.
   */
  async createStandaloneCharge(chargeData: Omit<Charge, 'updateTime' | 'createdBy' | 'createdById'>): Promise<void> {
    const chargesCollection = collection(this.firestore, 'charges');
    const newCharge = {
      ...chargeData,
      updateTime: serverTimestamp(),
      createdBy: this.authService.currentUserSig()?.displayName || 'Unknown',
      createdById: this.authService.currentUserSig()?.uid || 'Unknown',
    };
    await addDoc(chargesCollection, newCharge);
  }

  /**
   * Updates an existing charge document in Firestore.
   * @param chargeId The ID of the charge document to update.
   * @param chargeData The new data for the charge.
   */
  async updateCharge(chargeId: string, chargeData: Partial<Charge>): Promise<void> {
    const chargeDocRef = doc(this.firestore, `charges/${chargeId}`);
    await updateDoc(chargeDocRef, {
      ...chargeData,
      // Overwrite updateTime and the 'by' fields on every edit.
      updateTime: serverTimestamp(),
      createdBy: this.authService.currentUserSig()?.displayName || 'Unknown',
      createdById: this.authService.currentUserSig()?.uid || 'Unknown',
    });
  }

  /**
   * Checks if a charge that matches the given criteria already exists to prevent duplicates.
   * @param chargeData The core fields of the charge to check for.
   */
  async doesChargeExist(chargeData: { ship: string; boarding: Date; typeTrip: string }): Promise<boolean> {
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
      note: trip.note || '',
      extra: trip.extra || '',
      tripDirection: direction,
      isConfirmed: isConfirmed,
    };
  }
}
