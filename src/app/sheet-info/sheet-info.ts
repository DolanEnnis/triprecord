import { Component, signal, inject, OnInit, DestroyRef, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { SystemSettingsRepository } from '../services/system-settings.repository';
import { UserRepository } from '../services/user.repository';
import { Auth } from '@angular/fire/auth';
import { skip, filter, take } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PdfShip, ShipComparisonResult, ChangeType } from '../models';

@Component({
  selector: 'app-sheet-info',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatIconModule,
    MatTableModule,
    MatSnackBarModule
  ],
  templateUrl: './sheet-info.html',
  styleUrls: ['./sheet-info.css']
})
export class SheetInfoComponent implements OnInit {
  private functions = inject(Functions);
  private systemSettings = inject(SystemSettingsRepository);
  private userRepo = inject(UserRepository);
  private auth = inject(Auth);
  private snackBar = inject(MatSnackBar);
  private destroyRef = inject(DestroyRef);
  
  // PDF-related state
  pdfText = signal<string | null>(null);
  pdfLoading = signal(false);
  loadingStep = signal<string>(''); // Track current loading step
  pdfError = signal<string | null>(null);
  pdfShips = signal<PdfShip[]>([]);
  pdfShipsCount = signal(0);
  lastProcessed = signal<Date | null>(null); // Track when data was last updated
  
  // Previous PDF data (for change detection)
  previousShips = signal<PdfShip[]>([]);
  previousProcessed = signal<Date | null>(null);
  
  /**
   * Computed comparison between current and previous ship lists.
   * 
   * This automatically recalculates whenever previousShips() or pdfShips() changes.
   * Returns a merged list containing:
   * - New ships (in current, not in previous) - marked as 'new'
   * - Removed ships (in previous, not in current) - marked as 'removed'
   * - Modified ships (in both, with field changes) - marked as 'modified'
   * - Unchanged ships - marked as 'unchanged'
   */
  shipComparisons = computed(() => {
    return this.compareShipLists(this.previousShips(), this.pdfShips());
  });
  
  // Table configuration - defined once to avoid repetition in template
  displayedColumns = ['name', 'gt', 'port', 'status', 'eta'] as const;
  
  // Create the Cloud Function callable during initialization
  private fetchDailyDiaryCallable = httpsCallable<void, { 
    text: string; 
    numPages: number;
    ships: PdfShip[];
    shipsCount: number;
  }>(
    this.functions,
    'fetchDailyDiaryPdf'
  );

  ngOnInit(): void {
    // Mark that user viewed this page (for green nav indicator)
    this.markAsViewed();
    
    // Check if we need to fetch new data or can use cached version
    this.systemSettings.getShannonMetadata$()
      .pipe(take(1))
      .subscribe(metadata => {
        if (metadata?.update_available) {
          // New data available - fetch and process PDF
          console.log('New PDF data available, fetching...');
          this.fetchPdf();
        } else if (metadata?.cached_ships && metadata.cached_ships.length > 0) {
          // No update - load cached data instantly from Firestore
          console.log('Loading cached ship data from Firestore...');
          this.pdfText.set(metadata.cached_text || '');
          this.pdfShips.set(metadata.cached_ships);
          this.pdfShipsCount.set(metadata.cached_ships.length);
          this.pdfLoading.set(false);
          
          // Set last processed timestamp if available
          if (metadata.last_processed) {
            this.lastProcessed.set(metadata.last_processed.toDate());
          }
          
          // Load previous data for change detection
          if (metadata.previous_ships && metadata.previous_ships.length > 0) {
            this.previousShips.set(metadata.previous_ships);
            if (metadata.previous_processed) {
              this.previousProcessed.set(metadata.previous_processed.toDate());
            }
          }
        } else {
          // No cached data - first time, fetch PDF
          console.log('No cached data found, performing initial fetch...');
          this.fetchPdf();
        }
      });
    
    // Watch for real-time updates while user is on page
    this.watchForUpdates();
  }


  /**
   * Mark that the current user has viewed the Sheet-Info page.
   * This updates the user_activity collection with the current timestamp.
   */
  private async markAsViewed(): Promise<void> {
    const userId = this.auth.currentUser?.uid;
    if (userId) {
      await this.userRepo.markSheetInfoViewed(userId);
    }
  }

  /**
   * Subscribe to metadata changes and show notification when new data is available.
   * Skips the initial load and only reacts to subsequent changes.
   * Also prevents notification if PDF is already being fetched.
   * 
   * Uses takeUntilDestroyed() to automatically cleanup the subscription when the
   * component is destroyed, preventing memory leaks.
   */
  private watchForUpdates(): void {
    this.systemSettings.getShannonMetadata$()
      .pipe(
        skip(1),  // Ignore initial value (we just loaded)
        filter(metadata => metadata.update_available === true),
        filter(() => !this.pdfLoading()),  // Don't notify if already loading
        takeUntilDestroyed(this.destroyRef)  // ✅ Auto-cleanup when component destroyed
      )
      .subscribe(() => {
        // Show snackbar notification with refresh action
        this.snackBar.open(
          'New daily diary data available',
          'Refresh',
          {
            duration: 0,  // Stay until dismissed or action clicked
            horizontalPosition: 'center'
          }
        ).onAction().subscribe(() => {
          this.fetchPdf();  // Reload data when user clicks refresh
        });
      });
  }

  /**
   * Fetches the daily diary PDF from CarGoPro via our Cloud Function.
   * 
   * Why we're using a Cloud Function instead of fetching directly:
   * 1. CORS restrictions - The PDF domain may block browser requests
   * 2. Heavy processing - PDF parsing is CPU-intensive, better on server
   * 3. Consistent results - Server environment is predictable
   */
  async fetchPdf(): Promise<void> {
    this.pdfLoading.set(true);
    this.pdfError.set(null);
    
    try {
      // Step 1: Downloading
      this.loadingStep.set('Downloading PDF from server...');
      
      // Step 2: Processing (the Cloud Function handles parsing and AI)
      this.loadingStep.set('Parsing and extracting ship data with AI...');
      
      // Call the Cloud Function using the callable we created at class level
      // This avoids the "called outside injection context" error
      const result = await this.fetchDailyDiaryCallable();
      
      // Step 3: Finalizing
      this.loadingStep.set('Finalizing results...');
      
      // Extract the data from the result
      this.pdfText.set(result.data.text);
      this.pdfShips.set(result.data.ships || []);
      this.pdfShipsCount.set(result.data.shipsCount || 0);
      
      // Set last processed timestamp to now
      this.lastProcessed.set(new Date());
      
      console.log(`Successfully loaded ${result.data.shipsCount} ships from PDF`);
    } catch (error) {
      console.error('Error fetching PDF:', error);
      // Use type guard to safely extract error message
      const errorMessage = error instanceof Error 
        ? error.message 
        : 'Failed to load PDF. Please try again.';
      this.pdfError.set(errorMessage);
    } finally {
      this.pdfLoading.set(false);
      this.loadingStep.set('');
    }
  }

  /**
   * Compare two ship lists and identify changes.
   * 
   * @remarks
   * Ships are matched by name using case-insensitive comparison.
   * 
   * **Algorithm:**
   * 1. Create a map of previous ships by normalized name (lowercase)
   * 2. Iterate through current ships:
   *    - If not in previous → 'new'
   *    - If in previous → compare fields to detect 'modified' or 'unchanged'$
   * 3. Add remaining previous ships as 'removed'
   * 
   * **Why case-insensitive matching?**
   * PDF extraction can have capitalization variations, so "MSC OSCAR" and "Msc Oscar"
   * should be treated as the same ship.
   * 
   * @param previous - Ships from the previous PDF
   * @param current - Ships from the current PDF
   * @returns Array of comparison results with change type and modified fields
   */
  private compareShipLists(previous: PdfShip[], current: PdfShip[]): ShipComparisonResult[] {
    const results: ShipComparisonResult[] = [];
    
    // If no previous data, all current ships are "new" (but don't highlight on first load)
    if (previous.length === 0) {
      return current.map(ship => ({
        ship,
        changeType: 'unchanged' as ChangeType,
        changedFields: new Set<keyof PdfShip>()
      }));
    }
    
    // Create a map of previous ships by normalized name
    const previousMap = new Map<string, PdfShip>();
    for (const ship of previous) {
      previousMap.set(ship.name.toLowerCase(), ship);
    }
    
    // Track which previous ships we've matched
    const matchedPreviousShips = new Set<string>();
    
    // Process current ships
    for (const currentShip of current) {
      const normalizedName = currentShip.name.toLowerCase();
      const previousShip = previousMap.get(normalizedName);
      
      if (!previousShip) {
        // New ship
        results.push({
          ship: currentShip,
          changeType: 'new',
          changedFields: new Set<keyof PdfShip>()
        });
      } else {
        // Ship exists in both - check for changes
        matchedPreviousShips.add(normalizedName);
        const changedFields = this.detectChangedFields(previousShip, currentShip);
        
        results.push({
          ship: currentShip,
          changeType: changedFields.size > 0 ? 'modified' : 'unchanged',
          changedFields
        });
      }
    }
    
    // Add removed ships (in previous but not in current)
    for (const [normalizedName, ship] of previousMap.entries()) {
      if (!matchedPreviousShips.has(normalizedName)) {
        results.push({
          ship,
          changeType: 'removed',
          changedFields: new Set<keyof PdfShip>()
        });
      }
    }
    
    return results;
  }

  /**
   * Detect which fields changed between two ship records.
   * 
   * @remarks
   * Compares all fields except 'source' (which is metadata, not ship data).
   * 
   * **Field Comparison:**
   * - String fields (name, port, status): Exact match
   * - Number fields (gt): Strict equality
   * - ETA: ISO string comparison (null is handled)
   * 
   * @param previous - Previous ship data
   * @param current - Current ship data
   * @returns Set of field names that changed
   */
  private detectChangedFields(previous: PdfShip, current: PdfShip): Set<keyof PdfShip> {
    const changedFields = new Set<keyof PdfShip>();
    
    // Compare each field
    if (previous.name !== current.name) changedFields.add('name');
    if (previous.gt !== current.gt) changedFields.add('gt');
    if (previous.port !== current.port) changedFields.add('port');
    if (previous.status !== current.status) changedFields.add('status');
    if (previous.eta !== current.eta) changedFields.add('eta');
    
    return changedFields;
  }

}
