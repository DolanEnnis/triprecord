import { Injectable, inject } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { collection, query, where, orderBy, getDocs } from 'firebase/firestore';
import { from, Observable, map } from 'rxjs';
import { EnvironmentalEvent } from '../../models';

@Injectable({
  providedIn: 'root'
})
export class EnvironmentalRepository {
  private readonly firestore = inject(Firestore);
  private readonly collectionName = 'environmental_events';

  /**
   * Retrieves all environmental events for a specific date (YYYY-MM-DD),
   * sorted by timestamp. Used for the calendar day view.
   * Uses a one-time fetch (getDocs) rather than real-time subscription.
   */
  getEventsByDate(dateKey: string): Observable<EnvironmentalEvent[]> {
    const eventsRef = collection(this.firestore, this.collectionName);
    const q = query(
      eventsRef,
      where('dateKey', '==', dateKey),
      orderBy('timestamp', 'asc')
    );

    return from(getDocs(q)).pipe(
      map(snapshot => 
        snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        } as EnvironmentalEvent))
      )
    );
  }

  /**
   * Retrieves the Foynes high/low tidal cycle for a specific date.
   * Used for rendering the clean SVG wave graph.
   */
  getFoynesTidalCycle(dateKey: string): Observable<EnvironmentalEvent[]> {
    const eventsRef = collection(this.firestore, this.collectionName);
    const q = query(
      eventsRef,
      where('dateKey', '==', dateKey),
      where('port', '==', 'foynes'),
      where('type', 'in', ['high', 'low']),
      orderBy('timestamp', 'asc')
    );

    return from(getDocs(q)).pipe(
      map(snapshot => 
        snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        } as EnvironmentalEvent))
      )
    );
  }

  /**
   * Retrieves specialized actionable pilotage windows (Boarding, Flood, Standby)
   * for sidebars or summary lists.
   */
  getPilotageWindows(dateKey: string): Observable<EnvironmentalEvent[]> {
    const actionableTypes = [
      'boarding_limerick', 
      'airport_boarding', 
      'standby_airport',
      'flood_start_augh', 
      'last_xover_augh'
    ];
    
    const eventsRef = collection(this.firestore, this.collectionName);
    const q = query(
      eventsRef,
      where('dateKey', '==', dateKey),
      where('type', 'in', actionableTypes),
      orderBy('timestamp', 'asc')
    );

    return from(getDocs(q)).pipe(
      map(snapshot => 
        snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        } as EnvironmentalEvent))
      )
    );
  }
}
