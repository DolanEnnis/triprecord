import { Component, signal, inject, OnInit, DestroyRef } from '@angular/core';
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
import { PdfShip } from '../models';

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

}
