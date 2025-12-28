import { Injectable, inject } from '@angular/core';
import { Firestore, collection, addDoc, serverTimestamp, query, orderBy, limit, collectionData } from '@angular/fire/firestore';
import { Distance } from '../models';
import { Observable } from 'rxjs';


@Injectable({
  providedIn: 'root'
})
export class DistanceRepository {
  private firestore = inject(Firestore);
  private readonly collectionName = 'distance';

  async addDistance(distance: Omit<Distance, 'id'>): Promise<string> {
    const colRef = collection(this.firestore, this.collectionName);
    const docRef = await addDoc(colRef, {
      ...distance,
      timestamp: serverTimestamp() // Add server timestamp for sorting/filtering
    });
    return docRef.id;
  }

  getHistory(): Observable<Distance[]> {
    const colRef = collection(this.firestore, this.collectionName);
    const q = query(colRef, orderBy('timestamp', 'desc'), limit(10));
    return collectionData(q, { idField: 'id' }) as Observable<Distance[]>;
  }
}
