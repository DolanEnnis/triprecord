import { Injectable, inject } from '@angular/core';
import { Firestore, collection, addDoc, serverTimestamp, query, orderBy, where, collectionData, Timestamp } from '@angular/fire/firestore';
import { Distance } from '../../models';
import { Observable } from 'rxjs';


@Injectable({
  providedIn: 'root'
})
export class DistanceRepository {
  private firestore = inject(Firestore);
  private readonly collectionName = 'distance';

  /** Number of days to keep in history - records older than this are not loaded */
  private readonly HISTORY_DAYS = 7;

  async addDistance(distance: Omit<Distance, 'id'>): Promise<string> {
    const colRef = collection(this.firestore, this.collectionName);
    const docRef = await addDoc(colRef, {
      ...distance,
      timestamp: serverTimestamp() // Add server timestamp for sorting/filtering
    });
    return docRef.id;
  }

  /**
   * Retrieves distance calculations from the last 7 days.
   * 
   * Uses a Firestore `where` clause to filter on the server side,
   * so we only download recent records - efficient and cost-effective.
   */
  getHistory(): Observable<Distance[]> {
    const colRef = collection(this.firestore, this.collectionName);
    
    // Calculate the cutoff date (7 days ago from now)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.HISTORY_DAYS);
    
    // Convert to Firestore Timestamp for accurate comparison
    const cutoffTimestamp = Timestamp.fromDate(cutoffDate);
    
    // Query: records newer than cutoff, ordered newest first
    const q = query(
      colRef,
      where('timestamp', '>=', cutoffTimestamp),
      orderBy('timestamp', 'desc')
    );
    
    return collectionData(q, { idField: 'id' }) as Observable<Distance[]>;
  }
}
