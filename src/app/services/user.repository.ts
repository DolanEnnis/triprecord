import { inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
import { collection, collectionData, doc, Firestore, query, updateDoc, where, deleteDoc } from '@angular/fire/firestore';
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

  updateUserType(uid: string, userType: 'pilot' | 'admin' | 'sfpc' | 'other'): Observable<void> {
    const userDocRef = doc(this.firestore, this.USERS_COLLECTION, uid);
    return from(updateDoc(userDocRef, { userType }));
  }

  deleteUser(uid: string): Observable<void> {
    console.log(`Request to delete user ${uid}. Deleting from Firestore...`);
    const userDocRef = doc(this.firestore, this.USERS_COLLECTION, uid);
    return from(deleteDoc(userDocRef));
  }
}
