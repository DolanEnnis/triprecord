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
  doc,
  setDoc,
  updateDoc,
  serverTimestamp,
  docData
} from '@angular/fire/firestore';
import {from, Observable, map, switchMap, Subscription, of, catchError, shareReplay, filter, take} from 'rxjs';
import {UserInterface} from './types/userInterface';

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

  // New, specific permission signals
  public readonly canConfirmTrips = computed(() => {
    const userType = this.currentUserSig()?.userType?.toLowerCase();
    return userType === 'pilot' || userType === 'admin';
  });

  public readonly canCreateVisit = computed(() => {
    const userType = this.currentUserSig()?.userType?.toLowerCase();
    return userType === 'pilot' || userType === 'admin' || userType === 'sfpc';
  });

  public readonly isAdmin = computed(() => {
    const userType = this.currentUserSig()?.userType?.toLowerCase();
    return userType === 'admin';
  });

  constructor() {
    this.profile$ = this.user$.pipe(
      switchMap((user: User | null) => {
        if (user) {
          const docId = user.uid;
          return this.updateLastLogin(docId, user.uid).pipe(
            catchError(err => {
              console.error(`Failed to update last login...`, err);
              return of(null);
            }),
            switchMap(() => this.getUserProfileByDocId(docId))
          );
        } else {
          return of(null);
        }
      }),
      catchError(err => {
        console.error('A critical error occurred in the main auth pipe.', err);
        return of(null);
      }),
      shareReplay(1)
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

  private getUserProfileByDocId(docId: string): Observable<UserInterface | null> {
    return runInInjectionContext(this.injector, () => {
      const userDocRef = doc(this.firestore, `users/${docId}`);
      return docData(userDocRef).pipe(
        map(data => {
          if (data) {
            return data as UserInterface;
          } else {
            console.error(`Login failed: No profile document found for UID ${docId}. Logging out.`);
            this.logout().subscribe();
            return null;
          }
        })
      );
    });
  }

  private updateLastLogin(docId: string, authUid: string): Observable<void> {
    return runInInjectionContext(this.injector, () => {
      const userDocRef = doc(this.firestore, `users/${docId}`);
      const dataToUpdate = {
        lastLoginTrip: serverTimestamp(),
        uid: authUid
      };
      return from(updateDoc(userDocRef, dataToUpdate));
    });
  }

  register(email: string, password: string, displayName: string): Observable<void> {
    return runInInjectionContext(this.injector, () =>
      from(createUserWithEmailAndPassword(this.firebaseAuth, email, password)).pipe(
        switchMap(async (credentials: UserCredential) => {
          if (credentials.user) {
            await updateProfile(credentials.user, { displayName });
            const userDocRef = doc(this.firestore, 'users', credentials.user.uid);
            const newUserProfile = {
              uid: credentials.user.uid,
              email: credentials.user.email,
              displayName: displayName,
              userType: 'viewer',
            };
            await setDoc(userDocRef, newUserProfile);
          }
        })
      )
    );
  }

  login(email: string, password: string): Observable<UserInterface | null> {
    return runInInjectionContext(this.injector, () =>
      from(signInWithEmailAndPassword(this.firebaseAuth, email, password)).pipe(
        switchMap(() => this.profile$),
        filter(profile => profile !== null),
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
