import { Injectable, NgZone, computed, inject } from '@angular/core'; // 1. Import NgZone
import { toSignal } from '@angular/core/rxjs-interop';
import {
  Auth,
  authState,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  User
} from '@angular/fire/auth';
import { Router } from '@angular/router';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private auth: Auth = inject(Auth);
  private router: Router = inject(Router);
  private zone: NgZone = inject(NgZone); // 2. Inject NgZone using the inject() function

  private user$ = authState(this.auth);
  user = toSignal(this.user$);

  isAuthenticated = computed(() => this.user() !== null);
  displayName = computed(() => this.user()?.email ?? 'Not Logged In');

  registerUser(authData: { email: string, password: string }) {
    // 3. Wrap the Firebase call in this.zone.run()
    return this.zone.run(() =>
      createUserWithEmailAndPassword(this.auth, authData.email, authData.password)
    );
  }

  login(authData: { email: string, password: string }) {
    // 3. Wrap the Firebase call in this.zone.run()
    return this.zone.run(() =>
      signInWithEmailAndPassword(this.auth, authData.email, authData.password)
    );
  }

  logout() {
    // 3. Wrap the Firebase call in this.zone.run()
    this.zone.run(() => {
      signOut(this.auth).then(() => {
        this.router.navigate(['/']);
      });
    });
  }
}
