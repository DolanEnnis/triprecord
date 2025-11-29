import { inject, Injectable, Injector, runInInjectionContext, Signal, signal, computed } from '@angular/core';
import { collection, collectionData, Firestore, query, where, orderBy, Timestamp } from '@angular/fire/firestore';
import { Observable, Subscription } from 'rxjs';
import { map } from 'rxjs/operators';
import { Visit, VisitStatus } from '../models/data.model';
import { VisitRepository } from './visit.repository';

@Injectable({
  providedIn: 'root'
})
export class RiverStateService {
  private readonly firestore = inject(Firestore);
  private readonly visitRepository = inject(VisitRepository);
  private readonly injector = inject(Injector);

  // Internal state signals
  private _visits = signal<Visit[]>([]);

  // Public computed signals for the dashboard
  readonly dueShips = computed(() => 
    this._visits().filter(v => v.currentStatus === 'Due')
      .sort((a, b) => this.compareTimestamps(a.initialEta, b.initialEta))
  );

  readonly awaitingBerthShips = computed(() => 
    this._visits().filter(v => v.currentStatus === 'Awaiting Berth')
      .sort((a, b) => this.compareTimestamps(a.initialEta, b.initialEta))
  );

  readonly alongsideShips = computed(() => 
    this._visits().filter(v => v.currentStatus === 'Alongside')
      .sort((a, b) => this.compareTimestamps(a.initialEta, b.initialEta))
  );

  // Subscription management
  private visitsSubscription?: Subscription;

  constructor() {
    this.initRealtimeUpdates();
  }

  private initRealtimeUpdates() {
    // We want all "Active" visits. 
    // "Sailed" and "Cancelled" are NOT considered active for the dashboard.
    const activeStatuses: VisitStatus[] = ['Due', 'Awaiting Berth', 'Alongside'];
    
    const visitsCollection = collection(this.firestore, 'visits_new');
    const activeVisitsQuery = query(
      visitsCollection,
      where('currentStatus', 'in', activeStatuses)
    );

    // Using runInInjectionContext to ensure we can use injection if needed within the stream setup,
    // though strictly for collectionData it's not always required, it's good practice with our repo pattern.
    runInInjectionContext(this.injector, () => {
      this.visitsSubscription = (collectionData(activeVisitsQuery, { idField: 'id' }) as Observable<Visit[]>)
        .pipe(
          map(visits => {
            // We might need to join with Trip data here if we want the "Pilot" column to be accurate 
            // for the dashboard (e.g. Inward Pilot for Due ships, Outward Pilot for Sailed/Alongside).
            // For now, we'll store the raw visits and let the component or a computed signal handle the "View Model" mapping
            // or we can enhance this service to fetch the "Active Trip" for each visit.
            
            // Given the requirement for a "Pilot" column in the table, we should probably fetch the relevant trip.
            // However, doing N+1 queries in a real-time stream can be expensive.
            // A better approach for Firestore is often to denormalize the "Current Pilot" onto the Visit document 
            // when the Trip is created/updated.
            // 
            // CHECK: Visit model has `inwardPilot`. 
            // For 'Alongside' ships, the pilot might be the one who brought it in, or the one assigned to take it out?
            // Usually "Pilot" on the dashboard means "Assigned Pilot".
            // 
            // For this implementation, we will use the data available on the Visit.
            return visits;
          })
        )
        .subscribe(visits => {
          this._visits.set(visits);
        });
    });
  }

  // Helper for sorting Timestamps/Dates
  private compareTimestamps(a: Timestamp | any, b: Timestamp | any): number {
    const dateA = a instanceof Timestamp ? a.toDate() : new Date(a);
    const dateB = b instanceof Timestamp ? b.toDate() : new Date(b);
    return dateA.getTime() - dateB.getTime();
  }

  ngOnDestroy() {
    this.visitsSubscription?.unsubscribe();
  }
}
