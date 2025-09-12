import { inject, Injectable } from '@angular/core';
import {
  addDoc,
  collection,
  collectionData,
  doc,
  Firestore,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import { map, Observable } from 'rxjs';
import { Charge, ChargeableEvent, Visit } from '../models/trip.model';

@Injectable({
  providedIn: 'root',
})
export class DataService {
  private readonly firestore: Firestore = inject(Firestore);

  /**
   * Fetches recent visits and maps their inward/outward legs to ChargeableEvent objects,
   * noting which ones are already confirmed.
   */
  getRecentTrips(): Observable<ChargeableEvent[]> {
    const visitsCollection = collection(this.firestore, 'visits');

    // Calculate the date 3 months ago to limit the documents we fetch.
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    // Create a query to fetch only visits where the ETA is in the last 3 months.
    // This is vastly more performant and cost-effective than fetching the whole collection.
    // NOTE: This requires a Firestore index on the 'eta' field. The console will provide a link to create it.
    const recentVisitsQuery = query(
      visitsCollection,
      where('eta', '>=', threeMonthsAgo)
    );

    return (collectionData(recentVisitsQuery, { idField: 'docid' }) as Observable<Visit[]>).pipe(
      map((visits) => {
        const chargeableEvents: ChargeableEvent[] = [];
        for (const visit of visits) {
          // Process inward trip only if it exists and has a boarding time
          if (visit.inward && visit.inward.boarding) {
            chargeableEvents.push(this.createChargeableEvent(visit, 'inward'));
          }
          // Process outward trip only if it exists and has a boarding time
          if (visit.outward && visit.outward.boarding) {
            chargeableEvents.push(this.createChargeableEvent(visit, 'outward'));
          }
        }
        // Sort by boarding date, the most recent first
        return chargeableEvents.sort((a, b) => b.boarding.getTime() - a.boarding.getTime());
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
    chargeData: Omit<Charge, 'updateTime'>,
    visitDocId: string,
    tripDirection: 'inward' | 'outward'
  ) {
    // 1. Add a new document to 'charges' collection with a server-generated timestamp.
    const chargesCollection = collection(this.firestore, 'charges');
    await addDoc(chargesCollection, {
      ...chargeData,
      updateTime: serverTimestamp(),
    });

    // 2. Update the original visit document to confirm the trip.
    const visitDocRef = doc(this.firestore, `visits/${visitDocId}`);
    const updateData = tripDirection === 'inward' ? { inwardConfirmed: true } : { outwardConfirmed: true };
    await updateDoc(visitDocRef, updateData);
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
