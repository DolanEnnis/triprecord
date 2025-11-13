import { inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
import { collection, collectionData, Firestore, query, where } from '@angular/fire/firestore';
import { Observable } from 'rxjs';

// Basic interface representing a user with a pilot role.
// This can be expanded if more user data is needed elsewhere.
export interface PilotUser {
  id: string;
  displayName: string;
}

@Injectable({
  providedIn: 'root',
})
export class UserRepository {
  private readonly firestore: Firestore = inject(Firestore);
  private readonly injector = inject(Injector);
  private readonly USERS_COLLECTION = 'users';

  /**
   * Fetches all users designated as pilots.
   * @returns An Observable array of PilotUser objects.
   */
  getPilots(): Observable<PilotUser[]> {
    return runInInjectionContext(this.injector, () => {
      const usersCollection = collection(this.firestore, this.USERS_COLLECTION);
      // Query for documents where userType is exactly 'pilot'
      const pilotsQuery = query(usersCollection, where('userType', '==', 'pilot'));
      // Use collectionData to get a real-time stream of the query results.
      // The { idField: 'id' } option automatically includes the document ID in the result.
      return collectionData(pilotsQuery, { idField: 'id' }) as Observable<PilotUser[]>;
    });
  }
}
