import { Component, OnInit, ViewChild, inject, AfterViewInit, effect, signal } from '@angular/core';
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
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { toSignal } from '@angular/core/rxjs-interop';
import { SystemSettingsRepository } from '../services/repositories/system-settings.repository';
import { ShipRepository } from '../services/repositories/ship.repository';
import { ShipMergeService, MergeShipData } from '../services/workflows/ship-merge.service';
import { MergeShipsDialogComponent, MergeShipsDialogData } from '../dialogs/merge-ships-dialog.component';
import { Ship } from '../models';
import { CloudFunctionsService } from '../services/core/cloud-functions.service';

/**
 * Represents a group of duplicate ships.
 * Can be either IMO-based (same IMO number) or name-based (same ship name).
 */
interface DuplicateGroup {
  /** Type of match - IMO duplicates listed first */
  matchType: 'imo' | 'name';
  /** IMO number (only set if matchType is 'imo') */
  imoNumber?: number;
  /** Ship name (only set if matchType is 'name') */
  shipName?: string;
  /** Ships in this duplicate group */
  ships: Ship[];
}

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
    MatCardModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './admin.component.html',
  styleUrls: ['./admin.component.css']
})
export class AdminComponent implements OnInit, AfterViewInit {
  private readonly userRepository = inject(UserRepository);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly systemSettings = inject(SystemSettingsRepository);
  private readonly shipRepository = inject(ShipRepository);
  private readonly shipMergeService = inject(ShipMergeService);
  private readonly cloudFunctions = inject(CloudFunctionsService); // Injection

  // Using Signals for reactive state management
  users = toSignal(this.userRepository.getAllUsers(), { initialValue: [] });
  metadata = toSignal(this.systemSettings.getShannonMetadata$());

  // Ship deduplication state
  duplicateGroups = signal<DuplicateGroup[]>([]);
  isLoadingDuplicates = signal(false);
  hasCheckedDuplicates = signal(false);
  
  // Sync state
  isSyncingCharges = signal(false);

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

  // ========== Ship Deduplication Methods ==========

  /**
   * Finds all duplicate ships by IMO number AND by name.
   * IMO duplicates are listed first, then name duplicates (excluding ships already in IMO groups).
   * 
   * LEARNING: WHY COMBINE BOTH SEARCHES?
   * - IMO duplicates are the most reliable (unique vessel identifier)
   * - Name duplicates catch ships without IMO numbers
   * - Showing both in one view gives admin complete picture
   * - Excluding IMO-group ships from name search prevents double-counting
   */
  async findDuplicateShips(): Promise<void> {
    this.isLoadingDuplicates.set(true);
    this.hasCheckedDuplicates.set(true);
    
    try {
      const groups: DuplicateGroup[] = [];
      
      // Step 1: Find IMO duplicates (most important - listed first)
      const imoDuplicateMap = await this.shipRepository.findDuplicateShipsByImo();
      const shipsInImoGroups = new Set<string>();
      
      imoDuplicateMap.forEach((ships, imoNumber) => {
        groups.push({ 
          matchType: 'imo', 
          imoNumber, 
          ships 
        });
        // Track ship IDs to exclude from name search
        ships.forEach(s => shipsInImoGroups.add(s.id!));
      });
      
      // Step 2: Find name duplicates (excluding ships already in IMO groups)
      const nameDuplicateMap = await this.shipRepository.findDuplicateShipsByName(shipsInImoGroups);
      
      nameDuplicateMap.forEach((ships, shipName) => {
        // Use the first ship's actual name (preserves case)
        const displayName = ships[0]?.shipName || shipName;
        groups.push({ 
          matchType: 'name', 
          shipName: displayName, 
          ships 
        });
      });
      
      this.duplicateGroups.set(groups);
      
      // Provide detailed feedback
      const imoCount = imoDuplicateMap.size;
      const nameCount = nameDuplicateMap.size;
      
      if (groups.length === 0) {
        this.snackBar.open('No duplicate ships found!', 'Close', { duration: 3000 });
      } else {
        this.snackBar.open(
          `Found ${imoCount} IMO duplicate(s) and ${nameCount} name duplicate(s)`, 
          'Close', 
          { duration: 3000 }
        );
      }
    } catch (error: any) {
      console.error('Error finding duplicates:', error);
      this.snackBar.open(`Error: ${error.message}`, 'Close');
    } finally {
      this.isLoadingDuplicates.set(false);
    }
  }

  /**
   * Opens the merge dialog for a group of duplicate ships.
   */
  openMergeDialog(group: DuplicateGroup): void {
    // MergeShipsDialogData needs to handle both IMO and name groups
    const dialogData: MergeShipsDialogData = {
      ships: group.ships,
      // For IMO groups, pass the IMO number; for name groups, use 0 as placeholder
      imoNumber: group.imoNumber ?? 0,
      // Pass ship name for name-based groups
      matchType: group.matchType,
      shipName: group.shipName
    };
    
    const dialogRef = this.dialog.open(MergeShipsDialogComponent, {
      data: dialogData,
      disableClose: true  // Prevent accidental closure
    });
    
    dialogRef.afterClosed().subscribe(async (mergeData: MergeShipData | null) => {
      if (mergeData) {
        await this.executeMerge(mergeData);
      }
    });
  }

  /**
   * Executes the ship merge operation.
   */
  private async executeMerge(mergeData: MergeShipData): Promise<void> {
    this.isLoadingDuplicates.set(true);
    
    try {
      const result = await this.shipMergeService.mergeShips(mergeData);
      
      this.snackBar.open(
        `Merged successfully! ${result.visitsMigrated} visits and ${result.tripsMigrated} trips moved.`,
        'Close',
        { duration: 5000 }
      );
      
      // Refresh the duplicate list
      await this.findDuplicateShips();
      
    } catch (error: any) {
      console.error('Error merging ships:', error);
      this.snackBar.open(`Merge failed: ${error.message}`, 'Close');
      this.isLoadingDuplicates.set(false);
    }
  }

  /**
   * Manual trigger for Gap Fill (Legacy Data Sync).
   */
  syncLegacyCharges(): void {
    this.isSyncingCharges.set(true);
    this.cloudFunctions.runGapFill().subscribe({
      next: (result: any) => {
        const data = result.data || result; // Handle callable result wrapper
        this.snackBar.open(
          `Sync Complete: Processed ${data.processed}, Created ${data.tripsCreated}, Updated ${data.tripsUpdated}`, 
          'Close', 
          { duration: 5000 }
        );
        this.isSyncingCharges.set(false);
      },
      error: (err) => {
        console.error('Sync failed:', err);
        this.snackBar.open(`Sync Failed: ${err.message}`, 'Close');
        this.isSyncingCharges.set(false);
      }
    });
  }

  // ========== Environmental Data Import Methods ==========

  selectedTideFile: File | null = null;
  isUploadingTides = signal(false);

  /**
   * Handles file selection from the hidden input.
   */
  onTideFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.selectedTideFile = input.files[0];
    }
  }

  /**
   * Reads the CSV file and sends it to the Cloud Function.
   */
  uploadTideData(): void {
    if (!this.selectedTideFile) return;

    this.isUploadingTides.set(true);

    const reader = new FileReader();
    reader.onload = (e) => {
      const csvString = e.target?.result as string;
      
      this.cloudFunctions.importTides(csvString).subscribe({
        next: (result: any) => {
          const data = result.data || result;
          this.snackBar.open(`Success: ${data.message || 'Tide data imported'}`, 'Close', { duration: 5000 });
          this.selectedTideFile = null; // Reset
          this.isUploadingTides.set(false);
        },
        error: (err) => {
          console.error('Error importing tides:', err);
          this.snackBar.open(`Error: ${err.message}`, 'Close', { duration: 7000 });
          this.isUploadingTides.set(false);
        }
      });
    };

    reader.onerror = () => {
      this.snackBar.open('Error reading file. Please try again.', 'Close');
      this.isUploadingTides.set(false);
    };

    reader.readAsText(this.selectedTideFile);
  }
}



