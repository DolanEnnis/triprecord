import { Component, Inject, inject, OnInit, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Timestamp } from '@angular/fire/firestore';

import { AuditLog } from '../models';
import { TripRepository } from '../services/repositories/trip.repository';
import { VisitRepository } from '../services/repositories/visit.repository';
import { ShipRepository } from '../services/repositories/ship.repository';
import { TimeAgoPipe } from '../shared/pipes/time-ago.pipe';

// -------------------------------------------------------
// Dialog input data interface
// -------------------------------------------------------
export interface AuditHistoryDialogData {
  /** The Firestore document ID to fetch history for */
  documentId: string;
  /** Which collection this document belongs to — determines which repository to call */
  collectionName: 'trips' | 'visits_new' | 'ships';
  /** Human-readable label for the dialog header (e.g., "Inward Trip", "MV Limerick") */
  displayLabel?: string;
}

// -------------------------------------------------------
// Helpers
// -------------------------------------------------------

/**
 * LEARNING: Firestore Timestamps vs JavaScript Dates
 * Firestore stores timestamps as an object with `seconds` and `nanoseconds`.
 * When we retrieve data the type is Timestamp, but after JSON round-tripping
 * it may just be a plain object. The AuditLog entity types `timestamp` as
 * `Timestamp | FieldValue` because FieldValue.serverTimestamp() is used when
 * WRITING. By the time we READ a document, Firestore has resolved it to a
 * concrete Timestamp. We accept `unknown` here so TypeScript doesn't complain
 * about the union — our runtime checks handle all actual shapes safely.
 */
function toDate(ts: unknown): Date | null {
  if (!ts) return null;
  // AngularFire Timestamp class instance
  if (ts instanceof Timestamp) return ts.toDate();
  // Plain { seconds, nanoseconds } object (after JSON round-trip)
  if (typeof ts === 'object' && ts !== null && 'seconds' in ts) {
    return new Date((ts as { seconds: number }).seconds * 1000);
  }
  return null;
}

/**
 * Computes the keys that changed between two state snapshots.
 * Used to show a meaningful "what changed" diff in the history list.
 */
function getChangedKeys(
  prev: Record<string, unknown> | null,
  next: Record<string, unknown> | null
): string[] {
  if (!prev || !next) return [];

  // Combine keys from both states, then filter to only those that differ
  const allKeys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  return Array.from(allKeys).filter(key => {
    // JSON.stringify handles nested objects and arrays safely
    return JSON.stringify(prev[key]) !== JSON.stringify(next[key]);
  });
}

// -------------------------------------------------------
// Component
// -------------------------------------------------------

@Component({
  selector: 'app-audit-history-dialog',
  standalone: true,
  imports: [
    CommonModule, DatePipe, TimeAgoPipe,
    MatDialogModule, MatButtonModule, MatIconModule,
    MatProgressSpinnerModule, MatDividerModule, MatChipsModule, MatTooltipModule,
  ],
  template: `
    <!-- Dialog Header -->
    <h2 mat-dialog-title class="dialog-title">
      <mat-icon class="title-icon">history</mat-icon>
      Change History
      @if (data.displayLabel) {
        <span class="title-label">— {{ data.displayLabel }}</span>
      }
    </h2>

    <div mat-dialog-content class="dialog-content">

      <!-- Loading State -->
      @if (loading()) {
        <div class="loading-state">
          <mat-spinner diameter="40"></mat-spinner>
          <p>Loading history...</p>
        </div>
      }

      <!-- Error State -->
      @if (error()) {
        <div class="error-state">
          <mat-icon>error_outline</mat-icon>
          <p>{{ error() }}</p>
        </div>
      }

      <!-- Empty State -->
      @if (!loading() && !error() && logs().length === 0) {
        <div class="empty-state">
          <mat-icon>library_books</mat-icon>
          <p>No history found for this record.</p>
          <small>Changes made after the audit system was deployed will appear here.</small>
        </div>
      }

      <!-- Log Timeline -->
      @if (!loading() && logs().length > 0) {
        <div class="timeline">
          @for (log of logs(); track log.id) {
            <div class="timeline-entry" [class.entry-create]="log.action === 'CREATE'" [class.entry-delete]="log.action === 'DELETE'">

              <!-- Action Badge + Timestamp -->
              <div class="entry-header">
                <span class="action-badge" [class]="'badge-' + log.action.toLowerCase()">
                  {{ log.action }}
                </span>
                <span class="entry-time" [matTooltip]="toDate(log.timestamp) | date:'medium'">
                  {{ toDate(log.timestamp) | timeAgo }}
                </span>
              </div>

              <!-- Who + Where -->
              <div class="entry-meta">
                <span class="meta-item">
                  <mat-icon class="meta-icon">person</mat-icon>
                  {{ log.modifiedBy || 'Unknown' }}
                </span>
                <span class="meta-item">
                  <mat-icon class="meta-icon">link</mat-icon>
                  {{ log.modifiedFrom || 'Unknown' }}
                </span>
              </div>

              <!-- Changed Fields Diff (UPDATE only) -->
              @if (log.action === 'UPDATE') {
                @let changedKeys = getChangedKeys(log.previousState, log.newState);
                @if (changedKeys.length > 0) {
                  <div class="diff-section">
                    <p class="diff-title">Changed fields ({{ changedKeys.length }}):</p>
                    <div class="diff-table">
                      @for (key of changedKeys; track key) {
                        <div class="diff-row">
                          <span class="diff-key">{{ key }}</span>
                          <span class="diff-before" [matTooltip]="'Previous: ' + formatValue(log.previousState?.[key])">
                            {{ formatValue(log.previousState?.[key]) }}
                          </span>
                          <mat-icon class="diff-arrow">arrow_forward</mat-icon>
                          <span class="diff-after" [matTooltip]="'New: ' + formatValue(log.newState?.[key])">
                            {{ formatValue(log.newState?.[key]) }}
                          </span>
                        </div>
                      }
                    </div>
                  </div>
                }
              }

              <!-- CREATE: show what was set -->
              @if (log.action === 'CREATE' && log.newState) {
                <p class="entry-note">Record created with {{ objectKeys(log.newState).length }} fields.</p>
              }

              <!-- DELETE: show what was removed -->
              @if (log.action === 'DELETE' && log.previousState) {
                <p class="entry-note warn-note">Record deleted ({{ objectKeys(log.previousState).length }} fields removed).</p>
              }

            </div>
          }
        </div>
      }

    </div>

    <!-- Dialog Actions -->
    <div mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Close</button>
    </div>
  `,
  styles: [`
    .dialog-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 1.1rem;
    }
    .title-icon { color: #5c6bc0; font-size: 22px; }
    .title-label { color: #666; font-size: 0.95rem; font-weight: 400; }

    .dialog-content {
      min-height: 120px;
      max-height: 65vh;
      overflow-y: auto;
      padding: 8px 4px;
    }

    /* States */
    .loading-state, .error-state, .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 40px 16px;
      color: #666;
      text-align: center;
    }
    .error-state mat-icon { color: #f44336; font-size: 36px; }
    .empty-state mat-icon { font-size: 40px; color: #bbb; }
    .empty-state small { color: #aaa; font-size: 0.8rem; }

    /* Timeline */
    .timeline {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .timeline-entry {
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      padding: 12px 14px;
      background: #fafafa;
      border-left: 4px solid #5c6bc0;
    }
    .entry-create { border-left-color: #43a047; }
    .entry-delete { border-left-color: #e53935; }

    .entry-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 6px;
    }

    .action-badge {
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.5px;
      padding: 2px 8px;
      border-radius: 12px;
      text-transform: uppercase;
    }
    .badge-update { background: #e3f2fd; color: #1565c0; }
    .badge-create { background: #e8f5e9; color: #2e7d32; }
    .badge-delete { background: #ffebee; color: #b71c1c; }

    .entry-time {
      font-size: 0.82rem;
      color: #777;
      cursor: default;
    }

    .entry-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 8px;
    }
    .meta-item {
      display: flex;
      align-items: center;
      gap: 3px;
      font-size: 0.82rem;
      color: #444;
    }
    .meta-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
      color: #888;
    }

    /* Diff Table */
    .diff-section { margin-top: 6px; }
    .diff-title {
      font-size: 0.78rem;
      color: #666;
      margin: 0 0 6px;
      font-weight: 500;
    }
    .diff-table {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-height: 180px;
      overflow-y: auto;
    }
    .diff-row {
      display: grid;
      grid-template-columns: 140px 1fr 20px 1fr;
      align-items: center;
      gap: 6px;
      font-size: 0.78rem;
      background: #fff;
      padding: 3px 6px;
      border-radius: 4px;
      border: 1px solid #eee;
    }
    .diff-key {
      font-weight: 600;
      color: #333;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .diff-before {
      color: #c62828;
      font-family: monospace;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .diff-arrow { font-size: 14px; color: #aaa; }
    .diff-after {
      color: #2e7d32;
      font-family: monospace;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .entry-note {
      font-size: 0.8rem;
      color: #666;
      margin: 4px 0 0;
    }
    .warn-note { color: #b71c1c; }
  `]
})
export class AuditHistoryDialogComponent implements OnInit {
  // LEARNING: inject() is the modern Angular DI pattern for standalone components.
  // It replaces constructor injection and works well with OnInit lifecycle hooks.
  private readonly tripRepo = inject(TripRepository);
  private readonly visitRepo = inject(VisitRepository);
  private readonly shipRepo = inject(ShipRepository);

  // Angular Signals for reactive state (preferred over BehaviorSubject in modern Angular)
  readonly logs = signal<AuditLog[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  // Expose helpers to the template
  readonly toDate = toDate;
  readonly getChangedKeys = getChangedKeys;
  readonly objectKeys = Object.keys;

  constructor(
    public dialogRef: MatDialogRef<AuditHistoryDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: AuditHistoryDialogData
  ) {}

  async ngOnInit(): Promise<void> {
    try {
      // LEARNING: Dispatch to the correct repository based on collectionName.
      // This makes the dialog fully generic — the same component works for
      // trips, visits, and ships just by passing different collectionName + documentId.
      let history: AuditLog[];

      if (this.data.collectionName === 'trips') {
        history = await this.tripRepo.getAuditHistory(this.data.documentId);
      } else if (this.data.collectionName === 'visits_new') {
        history = await this.visitRepo.getAuditHistory(this.data.documentId);
      } else {
        history = await this.shipRepo.getAuditHistory(this.data.documentId);
      }

      this.logs.set(history);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error loading history.';
      this.error.set(`Could not load audit history: ${message}`);
      console.error('[AuditHistoryDialog] Failed to load history:', err);
    } finally {
      // Always stop the spinner, whether we succeeded or failed
      this.loading.set(false);
    }
  }

  /**
   * Formats a raw Firestore field value for display in the diff table.
   * Handles Timestamps, null, objects, and primitives.
   */
  formatValue(value: unknown): string {
    if (value === null || value === undefined) return '—';
    // Firestore Timestamp objects have a seconds property
    if (typeof value === 'object' && 'seconds' in (value as object)) {
      const d = toDate(value as { seconds: number; nanoseconds: number });
      return d ? d.toLocaleDateString('en-IE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
    }
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }
}
