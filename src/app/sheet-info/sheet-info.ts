import { Component, signal, inject, OnInit, DestroyRef, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { SystemSettingsRepository } from '../services/system-settings.repository';
import { VisitRepository } from '../services/visit.repository';
import { UserRepository } from '../services/user.repository';
import { Auth } from '@angular/fire/auth';
import { skip, filter, take } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PdfShip, ShipComparisonResult, ChangeType, ReconciliationResult, EnrichedVisit } from '../models';
import { Visit } from '../models/entities';

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
  private visitRepo = inject(VisitRepository);
  private userRepo = inject(UserRepository);
  private auth = inject(Auth);
  private snackBar = inject(MatSnackBar);
  private destroyRef = inject(DestroyRef);
  private router = inject(Router);
  
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
  
  // Active visits from our system (for reconciliation)
  activeVisits = signal<Visit[]>([]);
  
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
  
  // Helper methods for template
  hasDiscrepancy(result: ReconciliationResult, field: 'name' | 'eta' | 'status' | 'port'): boolean {
    return result.discrepancies.some(d => d.field === field);
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
  
  // Helper methods for system-only ships template
  getSystemGt(result: ReconciliationResult): number {
    return result.systemVisit?.grossTonnage || 0;
  }
  
  getSystemEta(result: ReconciliationResult): Date | null {
    return result.systemVisit?.initialEta?.toDate() || null;
  }
  
  getSystemPort(result: ReconciliationResult): string {
    return result.systemVisit?.berthPort || '-';
  }
  
  getSystemStatus(result: ReconciliationResult): string {
    return result.systemVisit?.currentStatus || '-';
  }
  
  // Table configuration - reordered to match status page
  displayedColumns = ['name', 'gt', 'eta', 'port', 'notes', 'status'] as const;
  
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
    
    // CRITICAL FIX: Load active visits FIRST before doing anything else
    // This prevents the race condition where reconciliation runs with empty visit data
    this.visitRepo.getActiveVisits()
      .pipe(
        take(1), // Take first emission to initialize data
        takeUntilDestroyed(this.destroyRef) // Then continue listening for updates
      )
      .subscribe(visits => {
        this.activeVisits.set(visits);
        console.log(`Loaded ${visits.length} active visits for reconciliation`);
        
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
    this.visitRepo.getActiveVisits()
      .pipe(
        skip(1), // Skip the first emission (we already handled it above)
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(visits => {
        this.activeVisits.set(visits);
        console.log(`Updated ${visits.length} active visits for reconciliation`);
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
   * @param visits - Active visits from our system
   * @returns Categorized reconciliation results
   */
  private reconcileShipsWithVisits(pdfShips: PdfShip[], visits: Visit[]): ReconciliationResult[] {
    const results: ReconciliationResult[] = [];
    
    // If no PDF data yet, return empty
    if (pdfShips.length === 0) {
      return results;
    }
    
    // Create map of visits by normalized ship name for exact matching
    const visitMap = new Map<string, Visit>();
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
      

      // If no exact match, try fuzzy matching (partial name)
      if (!visit) {

        for (const [systemName, systemVisit] of visitMap.entries()) {
          const isMatch = this.isPartialMatch(normalizedPdfName, systemName);

          if (isMatch) {
            visit = systemVisit;
            matchedSystemName = systemName;
            break;
          }
        }
      } else {

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
          systemVisit: null, // We'll use Visit for now, not EnrichedVisit
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
          systemVisit: null, // Will use Visit
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
   * @param visit - Visit from our system
   * @returns Array of field discrepancies
   */
  private detectVisitDiscrepancies(pdfShip: PdfShip, visit: Visit): import('../models/view/reconciliation.view').FieldDiscrepancy[] {
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
    if (pdfShip.eta && visit.initialEta) {
      const pdfDate = new Date(pdfShip.eta);
      const visitDate = visit.initialEta.toDate();
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
    if (pdfShip.status !== visit.currentStatus) {
      discrepancies.push({
        field: 'status',
        pdfValue: pdfShip.status,
        systemValue: visit.currentStatus
      });
    }
    
    // Compare port
    if (pdfShip.port !== visit.berthPort) {
      discrepancies.push({
        field: 'port',
        pdfValue: pdfShip.port,
        systemValue: visit.berthPort || 'Unknown'
      });
    }
    
    return discrepancies;
  }

  /**
   * Checks if two ship names are a partial match.
   * 
   * @remarks
   * This enables fuzzy matching where:
   * - "Nightingale Isl" matches "Nightingale Island" (trailing abbreviation)
   * - "Polstream" matches "Polstream Pile" (prefix match)
   * - "Federal Nakagaw" matches "Federal Nakagawa" (trailing truncation)
   * 
   * **Algorithm:**
   * 1. Try exact prefix match with word boundary
   * 2. Try matching all shared words (handles trailing abbreviations)
   * 3. Check for trailing letter differences (truncations like "Nakagaw" vs "Nakagawa")
   * 
   * **Why this matters:**
   * PDFs often truncate ship names due to space constraints, so we need
   * intelligent fuzzy matching to avoid false "PDF-ONLY" alerts.
   * 
   * @param name1 - First ship name (normalized/lowercase)
   * @param name2 - Second ship name (normalized/lowercase)
   * @returns true if names are partial matches
   */
  private isPartialMatch(name1: string, name2: string): boolean {
    const shorter = name1.length < name2.length ? name1 : name2;
    const longer = name1.length < name2.length ? name2 : name1;
    
    // Strategy 1: Simple prefix match with word boundary
    // Example: "Polstream" matches "Polstream Pile"
    if (longer.startsWith(shorter)) {
      // If exact match (same length), that's fine
      if (shorter.length === longer.length) {
        return true;
      }
      // If different length, make sure there's a word boundary
      if (longer.charAt(shorter.length) === ' ') {
        return true;
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
      
      // Words must either be exact match OR one is a prefix of the other
      // This handles "Isl" vs "Island", "Nakagaw" vs "Nakagawa"
      const isWordMatch = word1 === word2 || 
                          word1.startsWith(word2) || 
                          word2.startsWith(word1);
      
      if (!isWordMatch) {
        allWordsMatch = false;
        break;
      }
    }
    
    // If all compared words match, we have a fuzzy match
    if (allWordsMatch && minLength > 0) {
      return true;
    }
    
    return false;
  }

}
