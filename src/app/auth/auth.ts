import {Injectable, inject, OnDestroy, signal, computed, EnvironmentInjector, runInInjectionContext} from '@angular/core';
import {
  Auth,
  user,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signOut,
  User,
  UserCredential,
} from '@angular/fire/auth';
import {
  Firestore,
  addDoc,
  doc,
  updateDoc,
  serverTimestamp,
  docData,
  collection,
  query,
  where,
  limit,
  getDocs, QueryDocumentSnapshot, DocumentData
} from '@angular/fire/firestore';
import {from, Observable, map, switchMap, Subscription, of, catchError, shareReplay, filter, take} from 'rxjs';
import {UserInterface} from './types/userInterface';
//TODO: Security Rule Fix see line 125
@Injectable({
  providedIn: 'root',
})
export class AuthService implements OnDestroy {
  firebaseAuth = inject(Auth);
  firestore = inject(Firestore);
  private readonly injector = inject(EnvironmentInjector);
  readonly user$ = user(this.firebaseAuth);
  private readonly userSubscription: Subscription;

  /** A public observable that emits the user profile once it's resolved. Ideal for guards. */
  public readonly profile$: Observable<UserInterface | null>;

  // A writable signal for the current user's profile
  public readonly currentUserSig = signal<UserInterface | null>(null);
  public readonly isAuthenticated = computed(() => this.currentUserSig() !== null);
  public readonly isPrivilegedUser = computed(() => {
    // Make the check case-insensitive to match the guard and database values.
    const userType = this.currentUserSig()?.userType?.toLowerCase();
    return userType === 'pilot' || userType === 'admin';
  });

  constructor() {
    this.profile$ = this.user$.pipe(
      switchMap((user: User | null) => {
        if (user && user.email) {
          // New strategy: Find the user document by their email address.
          return this.findUserDocByEmail(user.email).pipe(
            switchMap(userDoc => {
              if (userDoc) {
                const docId = userDoc.id;
                // We found the document. Now, update its login timestamp...
                return this.updateLastLogin(docId, user.uid).pipe(
                  catchError(err => {
                    console.error(`Failed to update last login for doc ${docId}, but proceeding...`, err);
                    return of(null); // Continue even if update fails.
                  }),
                  // ...and then get a real-time stream of the profile data.
                  switchMap(() => this.getUserProfileByDocId(docId))
                );
              } else {
                // This is a critical failure: the user is authenticated but has no profile.
                // Log them out to prevent the app from being in a broken state.
                console.error(`Login failed: No profile document found for email ${user.email}. Logging out.`);
                this.logout().subscribe();
                return of(null);
              }
            })
          );
        } else {
          // If no user is authenticated, or they don't have an email, emit null.
          return of(null);
        }
      }),
      catchError(err => {
          console.error('A critical error occurred in the main auth pipe.', err);
          return of(null);
      }),
      shareReplay(1) // Cache the last emitted profile and share it with new subscribers.
    );

    this.userSubscription = this.profile$.subscribe((profile: UserInterface | null) => {
      this.currentUserSig.set(profile);
    });
  }

  ngOnDestroy(): void {
    if (this.userSubscription) {
      this.userSubscription.unsubscribe();
    }
  }

  private findUserDocByEmail(email: string): Observable<QueryDocumentSnapshot<DocumentData> | null> {
    // Wrap in injection context to prevent warnings from `getDocs()`
    return runInInjectionContext(this.injector, () => {
      const usersRef = collection(this.firestore, 'users');
      // Create a query to find documents where the 'email' field matches.
      const q = query(usersRef, where("email", "==", email), limit(1));
      // Execute the query once.
      return from(getDocs(q)).pipe(
        map(querySnapshot => {
          return querySnapshot.empty ? null : querySnapshot.docs[0];
        })
      );
    });
  }

  private getUserProfileByDocId(docId: string): Observable<UserInterface | null> {
    // By wrapping this in `runInInjectionContext`, we ensure that `docData` (which uses `inject` internally)
    // is called within a valid injection context, even when triggered from an async RxJS operator.
    return runInInjectionContext(this.injector, () => {
      const userDocRef = doc(this.firestore, `users/${docId}`);
      return docData(userDocRef).pipe(
        map(data => (data ? (data as UserInterface) : null))
      );
    });
  }
//todo remove the uid: authUid update from AuthService.updateLastLogin
  private updateLastLogin(docId: string, authUid: string): Observable<void> {
    // Wrap in injection context to prevent warnings from `serverTimestamp()`
    return runInInjectionContext(this.injector, () => {
      const userDocRef = doc(this.firestore, `users/${docId}`);
      // The existing security rule `request.resource.data.uid == request.auth.uid`
      // requires that the `uid` field be present in the write operation.
      // We include it here to comply with the rule of the shared database.
      const dataToUpdate = {
        lastLoginTrip: serverTimestamp(),
        uid: authUid // Comply with the security rule
      };
      return from(updateDoc(userDocRef, dataToUpdate));
    });
  }

  register(email: string, password: string, displayName: string): Observable<void> {
    return runInInjectionContext(this.injector, () =>
      from(createUserWithEmailAndPassword(this.firebaseAuth, email, password)).pipe(
        switchMap(async (credentials: UserCredential) => {
          if (credentials.user) {
            // 1. Update the Firebase Auth user profile with the display name.
            await updateProfile(credentials.user, { displayName });

            // 2. Create a corresponding user profile document in Firestore.
            // This follows the pattern of finding users by email on login.
            const usersCollection = collection(this.firestore, 'users');
            const newUserProfile = {
              uid: credentials.user.uid,
              email: credentials.user.email,
              displayName: displayName,
              // Assign a default, non-privileged role.
              userType: 'viewer',
            };
            await addDoc(usersCollection, newUserProfile);
          }
        })
      )
    );
  }

  login(email: string, password: string): Observable<UserInterface | null> {
    // This method now returns an observable that completes only after the
    // user's profile has been successfully fetched and loaded.
    return runInInjectionContext(this.injector, () =>
      from(signInWithEmailAndPassword(this.firebaseAuth, email, password)).pipe(
        // After sign-in, don't complete. Instead, switch to the profile$ stream.
        switchMap(() => this.profile$),
        // Wait for the profile$ stream to emit a valid, non-null profile.
        // This confirms the entire profile lookup/update process is complete.
        filter(profile => profile !== null),
        // Take just the first valid profile emission and then complete the stream.
        take(1)
      )
    );
  }

  logout(): Observable<void> {
    return runInInjectionContext(this.injector, () =>
      from(signOut(this.firebaseAuth))
    );
  }

  getCurrentUser(): User | null {
    return this.firebaseAuth.currentUser;
  }
}
