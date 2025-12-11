import { inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { IFormComponent } from './form-component.interface';
import { ConfirmationDialogComponent } from '../shared/confirmation-dialog/confirmation-dialog.component';

/**
 * Route guard that prevents navigation away from a component with unsaved changes.
 * 
 * HOW ANGULAR GUARDS WORK:
 * - Guards are functions called by the Router BEFORE navigation happens
 * - Return true = allow navigation
 * - Return false = block navigation
 * - Return Observable<boolean> = wait for async operation (like a dialog)
 * 
 * FUNCTIONAL GUARD (Modern Angular):
 * - Using CanDeactivateFn instead of class-based guards
 * - Simpler, more functional approach
 * - Can use inject() function for dependency injection
 * 
 * @param component - The component being navigated away from
 * @returns boolean or Observable<boolean> indicating if navigation is allowed
 */
export const canDeactivateGuard: CanDeactivateFn<IFormComponent> = (
  component: IFormComponent
): boolean | Observable<boolean> => {
  
  // First, ask the component if it's safe to leave
  // This is POLYMORPHISM in action - we don't care what type of component it is,
  // as long as it implements IFormComponent
  const canLeave = component.canDeactivate();
  
  // If component says it's safe to leave (returns true), allow navigation immediately
  if (canLeave === true) {
    return true;
  }
  
  // If component says there are unsaved changes (returns false), show confirmation dialog
  // We inject MatDialog here using Angular's inject() function
  // WHY inject() INSTEAD OF CONSTRUCTOR?
  // - This is a functional guard, not a class
  // - inject() is the modern way to get dependencies in functions
  const dialog = inject(MatDialog);
  
  // Open Material dialog asking user to confirm leaving
  const dialogRef = dialog.open(ConfirmationDialogComponent, {
    width: '400px',
    disableClose: true, // User MUST click a button (can't click backdrop to close)
    data: {
      title: 'Unsaved Changes',
      message: 'You have unsaved changes. Are you sure you want to leave? All unsaved data will be lost.',
      confirmText: 'Leave Anyway',
      cancelText: 'Stay on Page'
    }
  });
  
  // The dialog returns an Observable<boolean>
  // - true if user clicked "Confirm" (wants to leave)
  // - false if user clicked "Cancel" (wants to stay)
  // 
  // We use RxJS's map operator to convert undefined to false
  // (in case dialog is closed in an unexpected way)
  return dialogRef.afterClosed().pipe(
    map(result => !!result) // Convert to boolean: true = leave, false = stay
  );
};
