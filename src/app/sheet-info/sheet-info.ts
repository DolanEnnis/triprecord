import { Component, signal, inject, OnInit, DestroyRef, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { SystemSettingsRepository } from '../services/system-settings.repository';
import { VisitRepository } from '../services/visit.repository';
import { UserRepository } from '../services/user.repository';
import { Auth } from '@angular/fire/auth';
import { skip, filter, take, combineLatest } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PdfShip, ShipComparisonResult, ChangeType, ReconciliationResult, EnrichedVisit, VisitStatus, StatusListRow } from '../models';
import { Visit } from '../models/entities';
import { PilotService } from '../services/pilot.service';
import { TripRepository } from '../services/trip.repository';
import { UpdateEtaDialogComponent } from '../dialogs/update-eta-dialog/update-eta-dialog.component';


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
    MatSelectModule,
    MatSnackBarModule,
    MatMenuModule,
    MatTooltipModule,
    MatDialogModule
  ],
  templateUrl: './sheet-info.html',
  styleUrls: ['./sheet-info.css']
})
export class SheetInfoComponent implements OnInit {
  private functions = inject(Functions);
  private systemSettings = inject(SystemSettingsRepository);
  private visitRepo = inject(VisitRepository);
  private userRepo = inject(UserRepository);
  private auth = inject(Auth);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private destroyRef = inject(DestroyRef);
  private router = inject(Router);
  public pilotService = inject(PilotService);
  private tripRepo = inject(TripRepository);
 
  
  // PDF-related state
  pdfText = signal<string | null>(null);
  pdfLoading = signal(false);
  loadingStep = signal<string>(''); // Track current loading step
  pdfError = signal<string | null>(null);
  pdfShips = signal<PdfShip[]>([]);
  pdfShipsCount = signal(0);
  lastProcessed = signal<Date | null>(null); // Track when data was last updated
  rawTextExpanded = signal(false); // Track if raw text section is expanded
  pdfPublicationDate = signal<Date | null>(null); // Publication date from PDF
  
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
  
  // Active visits from our system with trip details (for reconciliation)
  activeVisits = signal<StatusListRow[]>([]);
  
  /**
   * Computed reconciliation between PDF ships and our active visits.
   * 
   * Compares PDF ships with active visits (Due, Awaiting Berth, Alongside)
   * to identify:
   * - Ships in PDF but not in our system (pdf-only)
   * - Ships in both with matching data (matched)
   * - Ships in both with different data (mismatch)
   * - Ships in our system but not in PDF (system-only)
   */
  reconciliationResults = computed(() => {
    return this.reconcileShipsWithVisits(this.pdfShips(), this.activeVisits());
  });
  
  /**
   * Ships requiring action - PDF-only ships FIRST (highest priority),
   * then ships with mismatches.
   */
  actionRequiredResults = computed(() => {
    const results = this.reconciliationResults();
    // Separate PDF-only and mismatch for priority ordering
    const pdfOnly = results.filter(r => r.matchType === 'pdf-only');
    const mismatches = results.filter(r => r.matchType === 'mismatch');
    // PDF-only ships first (not in our system), then mismatches
    return [...pdfOnly, ...mismatches];
  });
  
  /**
   * Ships that match perfectly between PDF and our system.
   */
  matchedResults = computed(() => {
    return this.reconciliationResults().filter(r => r.matchType === 'matched');
  });
  
  /**
   * Ships that exist in both but have data differences.
   */
  mismatchResults = computed(() => {
    return this.reconciliationResults().filter(r => r.matchType === 'mismatch');
  });
  
  /**
   * Ships in our system but not in the PDF.
   */
  systemOnlyResults = computed(() => {
    return this.reconciliationResults().filter(r => r.matchType === 'system-only');
  });
  
  /**
   * Ships in PDF but not in our system (need to be added).
   */
  pdfOnlyResults = computed(() => {
    return this.reconciliationResults().filter(r => r.matchType === 'pdf-only');
  });
  
  /**
   * Ships in both PDF and system (for comparison display).
   * 
   * Sorted by number of discrepancies (descending):
   * - Ships with most differences appear FIRST (highest priority for review)
   * - Ships with no differences appear LAST
   * 
   * This client-side sorting is trivial performance-wise since we typically
   * have only 10-50 ships, making the O(n log n) sort negligible.
   */
  comparisonResults = computed(() => {
    const results = this.reconciliationResults().filter(r => 
      r.matchType === 'matched' || r.matchType === 'mismatch'
    );
    
    // Sort by number of discrepancies (descending)
    // Ships with MORE differences appear FIRST
    return results.sort((a, b) => {
      const aCount = a.discrepancies.length;
      const bCount = b.discrepancies.length;
      return bCount - aCount; // Descending order
    });
  });
  
  /**
   * Ships that were in previous PDF but not in current PDF (likely sailed).
   */
  removedFromPdfResults = computed(() => {
    const currentShips = this.pdfShips();
    const previousShips = this.previousShips();
    
    if (previousShips.length === 0) return [];
    
    const currentShipNames = new Set(currentShips.map(s => s.name.toLowerCase()));
    
    return previousShips.filter((prevShip: PdfShip) => 
      !currentShipNames.has(prevShip.name.toLowerCase())
    );
  });
  
  // Helper methods for template
  hasDiscrepancy(result: ReconciliationResult, field: 'name' | 'eta' | 'status' | 'port' | 'gt' | 'notes' | 'assignedPilot'): boolean {
    return result.discrepancies.some(d => d.field === field);
  }
  
  /**
   * Get all ships that appear in both PDF and system (matched + mismatched).
   */
  getAllComparisonResults(): ReconciliationResult[] {
    return this.reconciliationResults().filter(r => 
      r.matchType === 'matched' || r.matchType === 'mismatch'
    );
  }
  
  /**
   * Navigate to new-visit page with pre-filled data from PDF ship.
   */
  createVisitFromPdf(pdfShip: PdfShip): void {
    this.router.navigate(['/new-visit'], {
      state: {
        pdfData: {
          shipName: pdfShip.name,
          grossTonnage: pdfShip.gt,
          eta: pdfShip.eta,
          port: pdfShip.port,
          status: pdfShip.status
        }
      }
    });
  }
  
  /**
   * Navigate to edit-trip page for a visit
   */
  editVisit(result: ReconciliationResult): void {
    if (result.systemVisit?.visitId) {
      this.router.navigate(['/edit', result.systemVisit.visitId], {
        queryParams: { returnUrl: '/sheet-info' }
      });
    }
  }
  
  /**
   * Open dialog to update ETA/ETB/ETS
   */
  openEtaDialog(result: ReconciliationResult): void {
    if (!result.systemVisit) return;
    
    const dialogRef = this.dialog.open(UpdateEtaDialogComponent, {
      data: {
        shipName: result.systemVisit.shipName,
        currentEta: result.systemVisit.date,
        status: result.systemVisit.status
      }
    });

    dialogRef.afterClosed().subscribe(async (newDate: Date | undefined) => {
      if (newDate && result.systemVisit) {
        const currentUser = this.auth.currentUser?.displayName || 'Unknown';
        try {
          await this.visitRepo.updateVisitDate(
            result.systemVisit.visitId,
            result.systemVisit.tripId,
            result.systemVisit.status,
            newDate,
            currentUser
          );
          
          this.snackBar.open(
            `✓ ${result.systemVisit.shipName} time updated successfully`,
            'Close',
            {
              duration: 4000,
              horizontalPosition: 'center',
              verticalPosition: 'bottom',
              panelClass: ['success-snackbar']
            }
          );
        } catch (error) {
          console.error('Failed to update date:', error);
          this.snackBar.open(
            `✗ Failed to update ${result.systemVisit.shipName} time. Please try again.`,
            'Close',
            {
              duration: 5000,
              horizontalPosition: 'center',
              verticalPosition: 'bottom',
              panelClass: ['error-snackbar']
            }
          );
        }
      }
    });
  }
  
  /**
   * Update pilot assignment
   */
  async updatePilot(result: ReconciliationResult, newPilot: string): Promise<void> {
    const visitId = result.systemVisit?.tripId;
    if (!visitId) {
      this.snackBar.open('✗ Cannot update pilot: Trip not found', 'Close', {
        duration: 5000,
        panelClass: ['error-snackbar']
      });
      return;
    }

    try {
      await this.tripRepo.updateTrip(visitId, { pilot: newPilot });
      this.snackBar.open(`✓ Pilot updated to ${newPilot || 'Unassigned'}`, 'Close', {
        duration: 3000,
        panelClass: ['success-snackbar']
      });
    } catch (error) {
      console.error('Failed to update pilot:', error);
      this.snackBar.open('✗ Failed to update pilot. Please try again.', 'Close', {
        duration: 5000,
        panelClass: ['error-snackbar']
      });
    }
  }

  /**
   * Update visit status
   */
  async updateStatus(result: ReconciliationResult, newStatus: VisitStatus): Promise<void> {
    const visitId = result.systemVisit?.visitId;
    if (!visitId) {
      this.snackBar.open('✗ Cannot update status: Visit not found', 'Close', {
        duration: 5000,
        panelClass: ['error-snackbar']
      });
      return;
    }

    const currentUser = this.auth.currentUser?.displayName || 'Unknown';
    try {
      // Update the status and set source = "Sheet" (representing updates from sheet/diary)
      await this.visitRepo.updateVisitStatus(visitId, newStatus, currentUser);
      
      // Update the source field separately to track that this was updated from Sheet-Info page
      await this.visitRepo.updateVisit(visitId, { source: 'Sheet' });
      
      this.snackBar.open(`✓ ${result.shipName} status changed to ${newStatus}`, 'Close', {
        duration: 3000,
        panelClass: ['success-snackbar']
      });
    } catch (error) {
      console.error('Failed to update status:', error);
      this.snackBar.open('✗ Failed to change status. Please try again.', 'Close', {
        duration: 5000,
        panelClass: ['error-snackbar']
      });
    }
  }

  /**
   * Get the next valid statuses based on current status
   */
  getNextStatuses(currentStatus: VisitStatus): VisitStatus[] {
    switch (currentStatus) {
      case 'Due':
        return ['Awaiting Berth', 'Cancelled'];
      case 'Awaiting Berth':
        return ['Alongside', 'Cancelled'];
      case 'Alongside':
        return ['Sailed', 'Cancelled'];
      case 'Sailed':
        return ['Cancelled'];
      case 'Cancelled':
        return [];
      default:
        return [];
    }
  }
  
  /**
   * Get current status + next statuses for dropdown (shows current selection)
   */
  getAllStatusOptions(currentStatus: VisitStatus): VisitStatus[] {
    return [currentStatus, ...this.getNextStatuses(currentStatus)];
  }
  
  // Helper methods for system-only ships template
  getSystemGt(result: ReconciliationResult): number {
    return result.systemVisit?.grossTonnage || 0;
  }
  
  getSystemEta(result: ReconciliationResult): Date | null {
    // StatusListRow.date contains the active date
    return result.systemVisit?.date || null;
  }
  
  getSystemPort(result: ReconciliationResult): string {
    return result.systemVisit?.port || '-';
  }
  
  getSystemStatus(result: ReconciliationResult): VisitStatus {
    return result.systemVisit?.status || 'Due';
  }
  
  getSystemNotes(result: ReconciliationResult): string {
    return result.systemVisit?.note || '-';
  }
  
  getSystemPilot(result: ReconciliationResult): string {
    return result.systemVisit?.pilot || '-';
  }
  
  /**
   * Get the appropriate time label based on status (ETA/ETB/ETS)
   */
  getTimeLabel(result: ReconciliationResult): string {
    const status = result.systemVisit?.status;
    if (status === 'Due') return 'ETA';
    if (status === 'Awaiting Berth') return 'ETB';
    if (status === 'Alongside') return 'ETS';
    return 'Time';
  }
  
  /**
   * Returns system ship name if there's a name discrepancy, otherwise 'Current Data:'
   */
  getSystemLabel(result: ReconciliationResult): string {
    if (this.hasDiscrepancy(result, 'name')) {
      return result.systemVisit?.shipName || 'Current Data:';
    }
    return 'Current Data:';
  }
  
  // Table configuration - reordered to match status page
  displayedColumns = ['name', 'gt', 'eta', 'port', 'notes', 'assignedPilot', 'status'] as const;
  
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
    
    // CRITICAL FIX: Load active visits with trip details FIRST
    // We need to combine all three status queries to get complete data
    combineLatest([
      this.visitRepo.getVisitsWithTripDetails('Due'),
      this.visitRepo.getVisitsWithTripDetails('Awaiting Berth'),
      this.visitRepo.getVisitsWithTripDetails('Alongside')
    ]).pipe(
        take(1), // Take first emission to initialize data
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(([due, awaitingBerth, alongside]) => {
        const allVisits = [...due, ...awaitingBerth, ...alongside];
        this.activeVisits.set(allVisits);
        console.log(`Loaded ${allVisits.length} active visits for reconciliation`);
        
        // NOW that we have visit data, load PDF data
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
              
              // Extract publication date from cached text
              if (metadata.cached_text) {
                const pubDate = this.extractPublicationDate(metadata.cached_text);
                if (pubDate) {
                  this.pdfPublicationDate.set(pubDate);
                }
              }
              
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
      });
    
    // Watch for real-time updates while user is on page
    this.watchForUpdates();
    
    // Continue listening for visit updates (reactive)
    combineLatest([
      this.visitRepo.getVisitsWithTripDetails('Due'),
      this.visitRepo.getVisitsWithTripDetails('Awaiting Berth'),
      this.visitRepo.getVisitsWithTripDetails('Alongside')
    ]).pipe(
        skip(1), // Skip the first emission (we already handled it above)
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(([due, awaitingBerth, alongside]) => {
        const allVisits = [...due, ...awaitingBerth, ...alongside];
        this.activeVisits.set(allVisits);
        console.log(`Updated ${allVisits.length} active visits for reconciliation`);
      });
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
      
      // Extract publication date from PDF text (second line format: "Date:08/01/2026 17:00:46")
      if (result.data.text) {
        const pubDate = this.extractPublicationDate(result.data.text);
        if (pubDate) {
          this.pdfPublicationDate.set(pubDate);
        }
      }
      
      // Set last processed timestamp to now
      this.lastProcessed.set(new Date());
      
      // IMPORTANT: Reload metadata from Firestore to get the previous_ships data
      // The Cloud Function saved it, but we need to fetch it to enable change detection
      this.systemSettings.getShannonMetadata$()
        .pipe(take(1))
        .subscribe(metadata => {
          if (metadata?.previous_ships && metadata.previous_ships.length > 0) {
            this.previousShips.set(metadata.previous_ships);
            if (metadata.previous_processed) {
              this.previousProcessed.set(metadata.previous_processed.toDate());
            }
            console.log(`Loaded ${metadata.previous_ships.length} ships from previous version for comparison`);
          }
        });
      
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
   * Extracts publication date from PDF text.
   * 
   * @remarks
   * The PDF text second line contains: "Date:08/01/2026 17:00:46"
   * We need to extract this and convert it to a Date object.
   * 
   * Format: Date:DD/MM/YYYY HH:MM:SS
   * 
   * @param pdfText - Raw PDF text
   * @returns Date object or null if not found
   */
  private extractPublicationDate(pdfText: string): Date | null {
    try {
      // Look for pattern "Date:DD/MM/YYYY HH:MM:SS" in the PDF text
      const dateMatch = pdfText.match(/Date:(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
      
      if (dateMatch) {
        const [, day, month, year, hour, minute, second] = dateMatch;
        // JavaScript Date months are 0-indexed
        const date = new Date(
          parseInt(year),
          parseInt(month) - 1,
          parseInt(day),
          parseInt(hour),
          parseInt(minute),
          parseInt(second)
        );
        return date;
      }
    } catch (error) {
      console.error('Failed to extract publication date from PDF:', error);
    }
    
    return null;
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
    if (previous.notes !== current.notes) changedFields.add('notes');
    if (previous.assignedPilot !== current.assignedPilot) changedFields.add('assignedPilot');
    if (previous.ets !== current.ets) changedFields.add('ets');
    
    return changedFields;
  }

  /**
   * Reconcile PDF ships with system visits to identify discrepancies.
   * 
   * @remarks
   * This is the core reconciliation algorithm that compares external PDF data
   * with our internal visit records.
   * 
   * **Matching Strategy:**
   * - Case-insensitive ship name comparison
   * - Only compare with active visits (Due, Awaiting Berth, Alongside)
   * 
   * **Discrepancy Detection:**
   * - ETA: Allow 2-hour tolerance (PDF/system might differ slightly)
   * - Status: Must match exactly
   * - Port: Must match exactly
   * 
   * @param pdfShips - Ships from CarGoPro PDF
   * @param visits - Active visits from our system (with trip details)
   * @returns Categorized reconciliation results
   */
  private reconcileShipsWithVisits(pdfShips: PdfShip[], visits: StatusListRow[]): ReconciliationResult[] {
    const results: ReconciliationResult[] = [];
    
    // If no PDF data yet, return empty
    if (pdfShips.length === 0) {
      return results;
    }
    
    // Create map of visits by normalized ship name for exact matching
    const visitMap = new Map<string, StatusListRow>();
    for (const visit of visits) {
      visitMap.set(visit.shipName.toLowerCase(), visit);
    }
    

    // Track which visits we've matched
    const matchedVisits = new Set<string>();
    
    // 1. Process PDF ships
    for (const pdfShip of pdfShips) {
      const normalizedPdfName = pdfShip.name.toLowerCase();
      
      // Try exact match first
      let visit = visitMap.get(normalizedPdfName);
      let matchedSystemName = normalizedPdfName;

      // If no exact match, try fuzzy matching (partial name) with GT validation
      if (!visit) {
        for (const [systemName, systemVisit] of visitMap.entries()) {
          const isMatch = this.isPartialMatch(
            normalizedPdfName, 
            systemName, 
            pdfShip.gt, 
            systemVisit.grossTonnage
          );

          if (isMatch) {
            visit = systemVisit;
            matchedSystemName = systemName;
            break;
          }
        }
      }
      
      if (!visit) {
        // PDF-only: Ship in PDF but not in our system
        results.push({
          matchType: 'pdf-only',
          pdfShip,
          systemVisit: null,
          discrepancies: [],
          shipName: pdfShip.name
        });
      } else {
        // Ship exists in both - check for discrepancies
        matchedVisits.add(matchedSystemName);
        const discrepancies = this.detectVisitDiscrepancies(pdfShip, visit);

        results.push({
          matchType: discrepancies.length > 0 ? 'mismatch' : 'matched',
          pdfShip,
          systemVisit: visit, // Pass the actual visit object
          discrepancies,
          shipName: pdfShip.name
        });
      }
    }
    
    // 2. Find system-only visits (not matched)
    for (const visit of visits) {
      const normalizedName = visit.shipName.toLowerCase();
      if (!matchedVisits.has(normalizedName)) {
        results.push({
          matchType: 'system-only',
          pdfShip: null,
          systemVisit: visit, // Actually pass the visit object
          discrepancies: [],
          shipName: visit.shipName
        });
      }
    }
    
    return results;
  }

  /**
   * Detect discrepancies between PDF ship data and system visit data.
   * 
   * @param pdfShip - Ship from PDF
   * @param visit - Visit from our system (StatusListRow with trip data)
   * @returns Array of field discrepancies
   */
  private detectVisitDiscrepancies(pdfShip: PdfShip, visit: StatusListRow): import('../models/view/reconciliation.view').FieldDiscrepancy[] {
    const discrepancies: import('../models/view/reconciliation.view').FieldDiscrepancy[] = [];
    
    // Compare ship names (exact match required to avoid discrepancy)
    if (pdfShip.name.toLowerCase() !== visit.shipName.toLowerCase()) {
      discrepancies.push({
        field: 'name',
        pdfValue: pdfShip.name,
        systemValue: visit.shipName
      });
    }
    
    // Compare ETA (allow 2 hour tolerance)
    // StatusListRow.date contains the active date (ETA/ETB/ETS)
    if (pdfShip.eta && visit.date) {
      const pdfDate = new Date(pdfShip.eta);
      const visitDate = visit.date;
      const hoursDiff = Math.abs(pdfDate.getTime() - visitDate.getTime()) / (1000 * 60 * 60);
      
      if (hoursDiff > 2) {
        discrepancies.push({
          field: 'eta',
          pdfValue: pdfShip.eta,
          systemValue: visitDate.toISOString()
        });
      }
    }
    
    // Compare status
    if (pdfShip.status !== visit.status) {
      discrepancies.push({
        field: 'status',
        pdfValue: pdfShip.status,
        systemValue: visit.status
      });
    }
    
    // Compare port
    if (pdfShip.port !== visit.port) {
      discrepancies.push({
        field: 'port',
        pdfValue: pdfShip.port,
        systemValue: visit.port || 'Unknown'
      });
    }
    
    return discrepancies;
  }

  /**
   * Checks if two ship names are a partial match with optional GT validation.
   * 
   * @remarks
   * **Dual-Layer Matching Strategy:**
   * 
   * **Layer 1: Name Matching**
   * - "Nightingale Isl" matches "Nightingale Island" (trailing abbreviation)
   * - "Polstream" matches "Polstream Pile" (prefix match)
   * - "Federal Nakagaw" matches "Federal Nakagawa" (trailing truncation)
   * - Requires at least 4 characters OR 50% of word length
   * 
   * **Layer 2: GT Validation (Safety Net)**
   * - If name fuzzy matches AND GT values provided, check tonnage difference
   * - Reject match if GT differs by more than ±10%
   * - Prevents false positives like "Star" (5,000 GT) matching "Star Princess" (85,000 GT)
   * 
   * **Why This Matters:**
   * PDFs truncate ship names, but GT rarely changes. Using both layers gives
   * accurate matching while preventing false positives with sister ships or
   * similarly-named vessels.
   * 
   * @param name1 - First ship name (normalized/lowercase)
   * @param name2 - Second ship name (normalized/lowercase)
   * @param gt1 - Optional gross tonnage for first ship
   * @param gt2 - Optional gross tonnage for second ship
   * @returns true if names are partial matches AND GT validates (if provided)
   */
  private isPartialMatch(name1: string, name2: string, gt1?: number, gt2?: number): boolean {
    // Minimum characters required for a prefix match to be valid
    const MIN_MATCH_LENGTH = 4;
    // Minimum percentage of word that must match (50% - lowered to support "Isl" → "Island")
    const MIN_MATCH_PERCENTAGE = 0.5;
    // Maximum GT difference percentage (10%)
    const MAX_GT_DIFFERENCE = 0.1;
    
    const shorter = name1.length < name2.length ? name1 : name2;
    const longer = name1.length < name2.length ? name2 : name1;
    
    // Strategy 1: Simple prefix match with word boundary
    // Example: "Polstream" matches "Polstream Pile"
    // But now requires at least MIN_MATCH_LENGTH chars
    if (longer.startsWith(shorter) && shorter.length >= MIN_MATCH_LENGTH) {
      // If exact match (same length), that's fine
      if (shorter.length === longer.length) {
        return this.validateGT(gt1, gt2, MAX_GT_DIFFERENCE);
      }
      // If different length, make sure there's a word boundary
      if (longer.charAt(shorter.length) === ' ') {
        return this.validateGT(gt1, gt2, MAX_GT_DIFFERENCE);
      }
    }
    
    // Strategy 2: Word-by-word comparison (handles trailing abbreviations)
    // Example: "Nightingale Isl" matches "Nightingale Island"
    const words1 = name1.split(' ');
    const words2 = name2.split(' ');
    const minLength = Math.min(words1.length, words2.length);
    
    // Check if all words up to the shorter name match
    let allWordsMatch = true;
    for (let i = 0; i < minLength; i++) {
      const word1 = words1[i];
      const word2 = words2[i];
      
      // Exact match is always OK
      if (word1 === word2) {
        continue;
      }
      
      // For prefix matching, enforce stricter rules
      const shorterWord = word1.length < word2.length ? word1 : word2;
      const longerWord = word1.length < word2.length ? word2 : word1;
      
      // Check if one is a prefix of the other
      const isPrefix = longerWord.startsWith(shorterWord);
      
      if (!isPrefix) {
        allWordsMatch = false;
        break;
      }
      
      // CRITICAL FIX: Require minimum match length OR percentage
      // This prevents "K" from matching "Kelly" (1/5 = 20%)
      // But allows "Isl" to match "Island" (3/6 = 50%)
      const matchPercentage = shorterWord.length / longerWord.length;
      const hasMinLength = shorterWord.length >= MIN_MATCH_LENGTH;
      const hasMinPercentage = matchPercentage >= MIN_MATCH_PERCENTAGE;
      
      if (!hasMinLength && !hasMinPercentage) {
        // Match is too short/weak, reject it
        allWordsMatch = false;
        break;
      }
    }
    
    // If all compared words match, validate with GT (if provided)
    if (allWordsMatch && minLength > 0) {
      return this.validateGT(gt1, gt2, MAX_GT_DIFFERENCE);
    }
    
    return false;
  }

  /**
   * Validates that two ships' gross tonnage values are within acceptable tolerance.
   * 
   * @remarks
   * This is a secondary validation layer for fuzzy name matches.
   * If GT values aren't provided, validation passes (assumes name match is sufficient).
   * If GT values are provided, they must be within MAX_GT_DIFFERENCE percentage.
   * 
   * **Example:**
   * - validateGT(35000, 35200, 0.1) → true (0.5% difference, within 10%)
   * - validateGT(5000, 85000, 0.1) → false (94% difference, exceeds 10%)
   * 
   * @param gt1 - First ship's gross tonnage (optional)
   * @param gt2 - Second ship's gross tonnage (optional)
   * @param maxDifference - Maximum allowed percentage difference (0.1 = 10%)
   * @returns true if GT validates or no GT provided, false if GT differs too much
   */
  private validateGT(gt1?: number, gt2?: number, maxDifference: number = 0.1): boolean {
    // If either GT is missing, can't validate - assume match is OK based on name alone
    if (gt1 === undefined || gt2 === undefined || gt1 === 0 || gt2 === 0) {
      return true;
    }
    
    // Calculate percentage difference
    const larger = Math.max(gt1, gt2);
    const smaller = Math.min(gt1, gt2);
    const difference = (larger - smaller) / larger;
    
    const isValid = difference <= maxDifference;
    
    if (!isValid) {
      console.log(`  🚫 GT validation failed: ${gt1} vs ${gt2} (${(difference * 100).toFixed(1)}% difference, max ${(maxDifference * 100)}%)`);
    }
    
    return isValid;
  }

}
