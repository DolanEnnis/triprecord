import { inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
import { collection, collectionData, doc, Firestore, query, updateDoc, where, deleteDoc, setDoc, serverTimestamp, docData, Timestamp } from '@angular/fire/firestore';
import { from, Observable } from 'rxjs';
import { UserInterface } from '../auth/types/userInterface';

@Injectable({
  providedIn: 'root',
})
export class UserRepository {
  private readonly firestore: Firestore = inject(Firestore);
  private readonly injector = inject(Injector);
  private readonly USERS_COLLECTION = 'users';

  getPilots(): Observable<UserInterface[]> {
    return runInInjectionContext(this.injector, () => {
      const usersCollection = collection(this.firestore, this.USERS_COLLECTION);
      const pilotsQuery = query(usersCollection, where('userType', '==', 'pilot'));
      return collectionData(pilotsQuery, { idField: 'uid' }) as Observable<UserInterface[]>;
    });
  }

  getAllUsers(): Observable<UserInterface[]> {
    return runInInjectionContext(this.injector, () => {
      const usersCollection = collection(this.firestore, this.USERS_COLLECTION);
      const allUsersQuery = query(usersCollection);
      return collectionData(allUsersQuery, { idField: 'uid' }) as Observable<UserInterface[]>;
    });
  }

  updateUserType(uid: string, userType: UserInterface['userType']): Observable<void> {
    const userDocRef = doc(this.firestore, this.USERS_COLLECTION, uid);
    return from(updateDoc(userDocRef, { userType }));
  }

  deleteUser(uid: string): Observable<void> {
    console.log(`Request to delete user ${uid}. Deleting from Firestore...`);
    const userDocRef = doc(this.firestore, this.USERS_COLLECTION, uid);
    return from(deleteDoc(userDocRef));
  }

  /**
   * Mark that a user has viewed the Sheet-Info page.
   * Updates the sheet_info_last_viewed timestamp in the user's document.
   * 
   * @param uid - User ID
   * @returns Promise that resolves when the timestamp is updated
   */
  async markSheetInfoViewed(uid: string): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      const userDoc = doc(this.firestore, `users/${uid}`);
      await updateDoc(userDoc, {
        sheet_info_last_viewed: serverTimestamp()
      });
    });
  }

  /**
   * Get real-time stream of user data including activity tracking.
   * Use this to check when a user last viewed Sheet-Info.
   * 
   * @param uid - User ID
   * @returns Observable of user data
   */
  getUser$(uid: string): Observable<UserInterface> {
    return runInInjectionContext(this.injector, () => {
      const userDocRef = doc(this.firestore, `users/${uid}`);
      return docData(userDocRef) as Observable<UserInterface>;
    });
  }
}
