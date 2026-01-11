import { Injectable, inject, signal, computed } from '@angular/core';
import { UserRepository } from '../repositories/user.repository';
import { UserInterface } from '../../auth/types/userInterface';

/**
 * Service to manage the list of pilots.
 * 
 * This service fetches pilots once from Firestore and caches them in a Signal.
 * It provides both the full pilot objects and just their display names for easy binding.
 * 
 * WHY SIGNALS?
 * - Automatic reactivity: Components using this service will auto-update if pilots change
 * - No manual subscriptions: Unlike RxJS, we don't need to worry about memory leaks
 * - Computed values: pilotNames is derived automatically from pilots Signal
 * - Modern Angular: This is the recommended pattern going forward
 */
@Injectable({
  providedIn: 'root'
})
export class PilotService {
  private userRepository = inject(UserRepository);

  // Signal holding the full list of pilot user objects
  // We use a writable signal so we can update it when pilots are fetched
  pilots = signal<UserInterface[]>([]);

  // Computed Signal - automatically derives pilot names from the pilots Signal
  // This demonstrates FUNCTIONAL PROGRAMMING: pilotNames is a pure transformation of pilots
  // Whenever pilots changes, pilotNames automatically recalculates
  // We sort alphabetically for better UX
  pilotNames = computed(() => 
    this.pilots()
      .map(pilot => pilot.displayName)
      .sort((a, b) => a.localeCompare(b))
  );

  constructor() {
    // Fetch pilots when service is first created
    // Since this service is providedIn: 'root', it's a singleton and only loads once
    this.loadPilots();
  }

  /**
   * Loads pilots from Firestore via UserRepository.
   * 
   * WHY SUBSCRIBE HERE?
   * - We need to convert the Observable from UserRepository to a Signal
   * - The subscription stays active, so if pilots are added/removed, we'll know
   * - Since this is a root service, it won't cause memory leaks
   */
  private loadPilots(): void {
    this.userRepository.getPilots().subscribe({
      next: (pilots) => {
        // Update the Signal with the new pilot list
        // This will automatically trigger updates in any components using pilotNames()
        this.pilots.set(pilots);
      },
      error: (err) => {
        console.error('Error loading pilots:', err);
        // Keep the Signal as empty array on error (fail gracefully)
      }
    });
  }

  /**
   * Validates if a given name is a valid pilot display name.
   * 
   * This is used for form validation to ensure users can only save valid pilot names.
   * We also allow empty strings to support "Unassigned" state.
   * 
   * @param name - The pilot name to validate
   * @returns true if the name is valid (exists in pilot list or is empty)
   */
  isPilotValid(name: string | null | undefined): boolean {
    if (!name || name.trim() === '' || name === 'Unassigned') {
      return true; // Allow empty/unassigned
    }
    return this.pilotNames().includes(name);
  }
}
