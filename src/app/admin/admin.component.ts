import { Component, OnInit, ViewChild, inject, AfterViewInit } from '@angular/core';
import { UserRepository } from '../services/user.repository';
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
    MatSnackBarModule
  ],
  templateUrl: './admin.component.html',
  styleUrls: ['./admin.component.css']
})
export class AdminComponent implements OnInit, AfterViewInit {
  private readonly userRepository = inject(UserRepository);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  displayedColumns: string[] = ['displayName', 'email', 'lastLoginTrip', 'userType', 'actions'];
  dataSource = new MatTableDataSource<UserInterface>();

  @ViewChild(MatSort) sort!: MatSort;

  ngOnInit(): void {
    this.userRepository.getAllUsers().subscribe(users => {
      this.dataSource.data = users;
    });
  }

  ngAfterViewInit(): void {
    this.dataSource.sort = this.sort;
    this.dataSource.sortingDataAccessor = (item, property) => {
      switch (property) {
        case 'lastLoginTrip': return item.lastLoginTrip ? item.lastLoginTrip.toDate().getTime() : 0;
        default: return (item as any)[property];
      }
    };
  }

  applyFilter(event: Event) {
    const filterValue = (event.target as HTMLInputElement).value;
    this.dataSource.filter = filterValue.trim().toLowerCase();
  }

  updateUserType(user: UserInterface): void {
    this.userRepository.updateUserType(user.uid, user.userType).subscribe({
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

    dialogRef.afterClosed().subscribe(confirmed => {
      if (confirmed) {
        this.userRepository.deleteUser(user.uid).subscribe({
          next: () => {
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
}
