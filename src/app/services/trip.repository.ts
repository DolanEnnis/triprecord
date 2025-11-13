import { inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
import {
  addDoc,
  collection,
  collectionData,
  doc,
  Firestore,
  query,
  Timestamp,
  updateDoc,
  where,
  orderBy,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { Trip } from '../models/data.model';

/**
 * TripRepository handles all direct data access operations for the '/trips' Firestore collection.
 * It's responsible for creating, fetching, and updating trip records.
 */
@Injectable({
  providedIn: 'root',
})
export class TripRepository {
  private readonly firestore: Firestore = inject(Firestore);
  private readonly injector = inject(Injector);

  async addTrip(trip: Omit<Trip, 'id'>): Promise<string> {
    return runInInjectionContext(this.injector, async () => {
      try { // 🚀 ADDED: Try/Catch block to expose errors
        const tripsCollection = collection(this.firestore, 'trips');
        console.log('Attempting to add trip:', trip); // 🚀 ADDED: Log payload
        const docRef = await addDoc(tripsCollection, trip);
        console.log('Trip successfully added with ID:', docRef.id); // 🚀 ADDED: Success log
        return docRef.id;
      } catch (error: any) {
        // 🛑 CRITICAL: Log the error and the payload to debug
        console.error('CRITICAL ERROR: Failed to add trip document.', error, 'Payload:', trip);
        // Re-throw the error with a meaningful message to break the chain
        throw new Error(`Database error during trip creation: ${error.message || 'Unknown error'}`);
      }
    });
  }

  async updateTrip(tripId: string, data: Partial<Trip>): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      const tripDocRef = doc(this.firestore, `trips/${tripId}`);
      await updateDoc(tripDocRef, data);
    });
  }

  getRecentTrips(threeMonthsAgoTimestamp: Timestamp): Observable<Trip[]> {
    return runInInjectionContext(this.injector, () => {
      const tripsCollection = collection(this.firestore, 'trips');
      const recentTripsQuery = query(tripsCollection, where('boarding', '>=', threeMonthsAgoTimestamp), orderBy('boarding', 'desc'));
      return collectionData(recentTripsQuery, { idField: 'id' }) as Observable<Trip[]>;
    });
  }
}
