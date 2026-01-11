import { inject, Injectable, Injector, runInInjectionContext, computed } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { collection, collectionData, Firestore, query, where, Timestamp } from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { Visit, VisitStatus } from '../../models';
import { VisitRepository } from '../repositories/visit.repository';

/**
 * RiverStateService manages the real-time state of active vessel visits.
 * 
 * WHY SIGNALS?
 * - This service uses Angular Signals for reactive state management
 * - toSignal() automatically handles Observable subscription/unsubscription
 * - No manual memory management needed (no ngOnDestroy required)
 * - Computed signals derive filtered/sorted views automatically
 * 
 * MEMORY SAFETY:
 * - Previous implementation had a manual subscription that could leak
 * - toSignal() cleans up automatically when the service is destroyed
 * - This is the recommended Angular 17+ pattern for Observable → Signal conversion
 */
@Injectable({
  providedIn: 'root'
})
export class RiverStateService {
  private readonly firestore = inject(Firestore);
  private readonly visitRepository = inject(VisitRepository);
  private readonly injector = inject(Injector);

  /**
   * Real-time stream of active visits converted to a Signal.
   * 
   * WHY toSignal() HERE?
   * - Firestore collectionData() returns an Observable that stays open
   * - toSignal() subscribes to it and automatically unsubscribes on cleanup
   * - No need for manual subscription management or ngOnDestroy
   * - The Signal updates automatically when Firestore data changes
   */
  private readonly _visits = runInInjectionContext(this.injector, () => {
    const activeStatuses: VisitStatus[] = ['Due', 'Awaiting Berth', 'Alongside'];
    const visitsCollection = collection(this.firestore, 'visits_new');
    const activeVisitsQuery = query(
      visitsCollection,
      where('currentStatus', 'in', activeStatuses)
    );

    // toSignal() handles the Observable → Signal conversion
    // initialValue ensures we have a value immediately (empty array)
    return toSignal(
      collectionData(activeVisitsQuery, { idField: 'id' }) as Observable<Visit[]>,
      { initialValue: [] as Visit[] }
    );
  });

  /**
   * Computed Signal: All visits with "Due" status, sorted by ETA.
   * Automatically recalculates when _visits updates.
   */
  readonly dueShips = computed(() => 
    this._visits().filter(v => v.currentStatus === 'Due')
      .sort((a, b) => this.compareTimestamps(a.initialEta, b.initialEta))
  );

  /**
   * Computed Signal: All visits with "Awaiting Berth" status, sorted by ETA.
   * Automatically recalculates when _visits updates.
   */
  readonly awaitingBerthShips = computed(() => 
    this._visits().filter(v => v.currentStatus === 'Awaiting Berth')
      .sort((a, b) => this.compareTimestamps(a.initialEta, b.initialEta))
  );

  /**
   * Computed Signal: All visits with "Alongside" status, sorted by ETA.
   * Automatically recalculates when _visits updates.
   */
  readonly alongsideShips = computed(() => 
    this._visits().filter(v => v.currentStatus === 'Alongside')
      .sort((a, b) => this.compareTimestamps(a.initialEta, b.initialEta))
  );

  /**
   * Helper for sorting Timestamps/Dates.
   * 
   * TYPE SAFETY FIX:
   * - Changed from `any` to proper union type
   * - Now TypeScript can verify we're handling all expected types
   * - Handles Firestore Timestamp, JS Date, and string date formats
   */
  private compareTimestamps(
    a: Timestamp | Date | string, 
    b: Timestamp | Date | string
  ): number {
    const dateA = a instanceof Timestamp ? a.toDate() : new Date(a);
    const dateB = b instanceof Timestamp ? b.toDate() : new Date(b);
    return dateA.getTime() - dateB.getTime();
  }

  // 🎉 NO ngOnDestroy NEEDED!
  // toSignal() automatically cleans up the subscription when Angular destroys this service.
  // This is one of the key benefits of the modern Signal-based approach.
}
