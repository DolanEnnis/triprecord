import { inject, Injectable } from '@angular/core';
import { collection, collectionData, doc, Firestore, query, updateDoc, where, deleteDoc, setDoc, serverTimestamp, docData, Timestamp, limit } from '@angular/fire/firestore';
import { from, Observable } from 'rxjs';
import { UserInterface } from '../../auth/types/userInterface';

@Injectable({
  providedIn: 'root',
})
export class UserRepository {
  private readonly firestore: Firestore = inject(Firestore);
  private readonly USERS_COLLECTION = 'users';

  getPilots(): Observable<UserInterface[]> {
    const usersCollection = collection(this.firestore, this.USERS_COLLECTION);
    // SECURITY: The firestore.rules require a limit() for non-admin queries
    // We set a generous limit of 100 which is plenty for the number of pilots
    const pilotsQuery = query(usersCollection, where('userType', '==', 'pilot'), limit(100));
    return collectionData(pilotsQuery, { idField: 'uid' }) as Observable<UserInterface[]>;
  }

  getAllUsers(): Observable<UserInterface[]> {
    const usersCollection = collection(this.firestore, this.USERS_COLLECTION);
    const allUsersQuery = query(usersCollection);
    return collectionData(allUsersQuery, { idField: 'uid' }) as Observable<UserInterface[]>;
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
    const userDoc = doc(this.firestore, `users/${uid}`);
    await updateDoc(userDoc, {
      sheet_info_last_viewed: serverTimestamp()
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
    const userDocRef = doc(this.firestore, `users/${uid}`);
    return docData(userDocRef) as Observable<UserInterface>;
  }
}
