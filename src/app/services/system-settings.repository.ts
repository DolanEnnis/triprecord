import { inject, Injectable } from '@angular/core';
import { Firestore, doc, docData } from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { Timestamp } from '@angular/fire/firestore';

/**
 * Metadata for Shannon Daily Diary monitoring system.
 * Tracks PDF update status and processing state.
 */
export interface ShannonMetadata {
  /** Flag indicating new PDF data is available but not yet processed */
  update_available: boolean;
  
  /** Timestamp when PDF was last successfully processed */
  last_processed: Timestamp;
  
  /** Timestamp when watchtower last checked for updates */
  last_check: Timestamp;
  
  /** Last-Modified header value from PDF server */
  current_last_modified: string;
  
  /** Lock to prevent concurrent processing */
  processing: boolean;
  
  /** When processing lock was acquired (for timeout detection) */
  processing_started_at: Timestamp | null;
  
  /** Admin control: enable/disable watchtower monitoring */
  watchtower_enabled: boolean;
  
  /** Cached ship data from last PDF processing (for instant frontend display) */
  cached_ships?: any[];
  
  /** Cached raw PDF text */
  cached_text?: string;
  
  /** Cached page count from last PDF */
  cached_page_count?: number;
}

/**
 * Repository for accessing system-wide settings and metadata.
 * Currently focused on Shannon Daily Diary monitoring.
 */
@Injectable({
  providedIn: 'root'
})
export class SystemSettingsRepository {
  private firestore = inject(Firestore);
  private metadataDoc = doc(this.firestore, 'system_settings/shannon_diary_metadata');

  /**
   * Get real-time stream of Shannon Daily Diary metadata.
   * Subscribe to this to react to PDF updates.
   * 
   * @returns Observable of metadata updates
   */
  getShannonMetadata$(): Observable<ShannonMetadata> {
    return docData(this.metadataDoc) as Observable<ShannonMetadata>;
  }

  /**
   * Toggle watchtower monitoring on/off.
   * When disabled, scheduled functions exit early without checking PDF.
   * 
   * @param enabled - true to enable monitoring, false to pause
   * @returns Promise that resolves when update is complete
   */
  async toggleWatchtower(enabled: boolean): Promise<void> {
    const { updateDoc } = await import('@angular/fire/firestore');
    await updateDoc(this.metadataDoc, {
      watchtower_enabled: enabled
    });
  }
}
