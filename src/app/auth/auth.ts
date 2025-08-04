import { Injectable } from '@angular/core';
import { Auth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, User } from '@angular/fire/auth';
import { Subject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  // Use a Subject to track and emit changes in authentication state
  authChange = new Subject<boolean>();
  private user: User | null = null;

  constructor(private auth: Auth) {
    // Listen for changes in the authentication state
    onAuthStateChanged(this.auth, user => {
      this.user = user;
      if (user) {
        this.authChange.next(true);
      } else {
        this.authChange.next(false);
      }
    });
  }

  // Method to register a new user
  registerUser(authData: { email: string, password: string }) {
    createUserWithEmailAndPassword(this.auth, authData.email, authData.password)
      .then(result => {
        console.log(result);
      })
      .catch(error => {
        console.log(error);
      });
  }

  // Method to log in a user
  login(authData: { email: string, password: string }) {
    signInWithEmailAndPassword(this.auth, authData.email, authData.password)
      .then(result => {
        console.log(result);
      })
      .catch(error => {
        console.log(error);
      });
  }

  // Method to log out the current user
  logout() {
    signOut(this.auth);
  }

  // Method to check if a user is authenticated
  isAuth(): boolean {
    return this.user != null;
  }
}
