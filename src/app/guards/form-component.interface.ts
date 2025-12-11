import { Observable } from 'rxjs';

/**
 * Interface for components that have forms and need unsaved changes protection.
 * 
 * WHY THIS INTERFACE EXISTS:
 * - Provides a contract that components must implement
 * - Enables the CanDeactivate guard to work with any component
 * - TypeScript ensures compile-time safety
 * 
 * FUNCTIONAL REACTIVE PROGRAMMING NOTE:
 * - Returns boolean OR Observable<boolean> to support both sync and async checks
 * - Observable allows waiting for user dialog responses
 */
export interface IFormComponent {
  /**
   * Determines if the user can safely navigate away from this component.
   * 
   * @returns true if safe to navigate (no unsaved changes), false otherwise
   */
  canDeactivate(): boolean | Observable<boolean>;
}
