import { Component, OnInit, ViewChild, inject, AfterViewInit, effect } from '@angular/core';
import { UserRepository } from '../services/repositories/user.repository';
import { CommonModule } from '@angular/common';
import { UserInterface } from '../auth/types/userInterface';
import { FormsModule } from '@angular/forms';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { ConfirmationDialogComponent } from '../shared/confirmation-dialog/confirmation-dialog.component';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatCardModule } from '@angular/material/card';
import { toSignal } from '@angular/core/rxjs-interop';
import { SystemSettingsRepository } from '../services/repositories/system-settings.repository';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatTableModule,
    MatSortModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatDialogModule,
    MatSnackBarModule,
    MatTooltipModule,
    MatSlideToggleModule,
    MatCardModule
  ],
  templateUrl: './admin.component.html',
  styleUrls: ['./admin.component.css']
})
export class AdminComponent implements OnInit, AfterViewInit {
  private readonly userRepository = inject(UserRepository);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly systemSettings = inject(SystemSettingsRepository);

  // Using Signals for reactive state management
  users = toSignal(this.userRepository.getAllUsers(), { initialValue: [] });
  metadata = toSignal(this.systemSettings.getShannonMetadata$());

  displayedColumns: string[] = ['displayName', 'email', 'lastLoginTrip', 'lastSheetView', 'userType', 'actions'];
  dataSource = new MatTableDataSource<UserInterface>();

  @ViewChild(MatSort) sort!: MatSort;

  // Effect to automatically update dataSource when users Signal changes
  constructor() {
    effect(() => {
      this.dataSource.data = this.users();
    });
  }

  ngOnInit(): void {
    // Data loading is now handled by the Signal
  }

  ngAfterViewInit(): void {
    this.dataSource.sort = this.sort;
    // Type-safe sorting accessor - no 'as any' needed!
    this.dataSource.sortingDataAccessor = (item, property) => {
      switch (property) {
        case 'lastLoginTrip': 
          return item.lastLoginTrip ? item.lastLoginTrip.toDate().getTime() : 0;
        case 'displayName': 
          return item.displayName?.toLowerCase() ?? '';
        case 'email': 
          return item.email?.toLowerCase() ?? '';
        case 'userType': 
          return item.userType ?? '';
        default: 
          return '';
      }
    };
  }

  applyFilter(event: Event) {
    const filterValue = (event.target as HTMLInputElement).value;
    this.dataSource.filter = filterValue.trim().toLowerCase();
  }

  updateUserType(user: UserInterface): void {
    this.userRepository.updateUserType(user.uid, user.userType)
      .subscribe({
        next: () => {
          this.snackBar.open(`User ${user.displayName} updated successfully.`, 'Close', { duration: 3000 });
        },
        error: (err) => {
          this.snackBar.open(`Error updating user: ${err.message}`, 'Close');
          // Optionally, you could revert the change in the UI here
        }
      });
  }

  deleteUser(user: UserInterface): void {
    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      data: {
        title: 'Confirm Deletion',
        message: `Are you sure you want to delete user ${user.displayName}? This action cannot be undone.`
      }
    });

    dialogRef.afterClosed()
      .subscribe(confirmed => {
        if (confirmed) {
          this.userRepository.deleteUser(user.uid)
            .subscribe({
              next: () => {
                // The Signal will automatically refresh the data, but we can filter for immediate UI update
                this.dataSource.data = this.dataSource.data.filter(u => u.uid !== user.uid);
                this.snackBar.open(`User ${user.displayName} deleted.`, 'Close', { duration: 3000 });
              },
              error: (err) => {
                this.snackBar.open(`Error deleting user: ${err.message}`, 'Close');
              }
            });
        }
      });
  }


  /**
   * Toggle watchtower monitoring on/off.
   */
  async toggleWatchtower(enabled: boolean): Promise<void> {
    try {
      await this.systemSettings.toggleWatchtower(enabled);
      this.snackBar.open(
        `Watchtower ${enabled ? 'enabled' : 'paused'}`,
        'Close',
        { duration: 3000 }
      );
    } catch (error: any) {
      this.snackBar.open(
        `Error toggling watchtower: ${error.message}`,
        'Close'
      );
    }
  }
}
