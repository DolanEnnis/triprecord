import { Component, Inject, inject, OnInit, signal } from '@angular/core';
import { CommonModule, DatePipe, KeyValuePipe } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
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
  documentId: string;
  collectionName: 'trips' | 'visits_new' | 'ships';
  displayLabel?: string;
}

// -------------------------------------------------------
// Helpers
// -------------------------------------------------------

/**
 * LEARNING: Firestore Timestamps vs JavaScript Dates
 *
 * By the time client code reads an audit log, Firestore has already resolved
 * FieldValue.serverTimestamp() into a concrete Timestamp object with `.toDate()`.
 * We accept `unknown` here because the AuditLog.timestamp union type includes
 * legacy possibilities — our runtime guards handle all real shapes safely.
 */
function toDate(ts: unknown): Date | null {
  if (!ts) return null;
  if (ts instanceof Timestamp) return ts.toDate();
  if (typeof ts === 'object' && ts !== null && 'seconds' in ts) {
    return new Date((ts as { seconds: number }).seconds * 1000);
  }
  return null;
}

/**
 * Formats a raw Firestore value for readable display in the diff table.
 * Handles Timestamps, nulls, objects, and primitives.
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object' && 'seconds' in (value as object)) {
    const d = toDate(value);
    return d ? d.toLocaleDateString('en-IE', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    }) : '—';
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// -------------------------------------------------------
// Component
// -------------------------------------------------------

@Component({
  selector: 'app-audit-history-dialog',
  standalone: true,
  imports: [
    CommonModule, DatePipe, KeyValuePipe, TimeAgoPipe,
    MatDialogModule, MatButtonModule, MatIconModule,
    MatProgressSpinnerModule, MatTooltipModule,
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
        <div class="state-box">
          <mat-spinner diameter="36"></mat-spinner>
          <p>Loading history...</p>
        </div>
      }

      <!-- Error State -->
      @if (error()) {
        <div class="state-box error">
          <mat-icon>error_outline</mat-icon>
          <p>{{ error() }}</p>
        </div>
      }

      <!-- Empty State -->
      @if (!loading() && !error() && logs().length === 0) {
        <div class="state-box empty">
          <mat-icon>library_books</mat-icon>
          <p>No history found for this record.</p>
          <small>Changes made after the audit system was deployed will appear here.</small>
        </div>
      }

      <!-- ═══════════════════════════════════════════════════════════════
           LOG TIMELINE
           ═══════════════════════════════════════════════════════════════ -->
      @if (!loading() && logs().length > 0) {
        <div class="timeline">
          @for (log of logs(); track log.id) {
            <div class="entry" [class.entry-create]="log.action === 'CREATE'" [class.entry-delete]="log.action === 'DELETE'">

              <!-- Header row: badge + time -->
              <div class="entry-header">
                <span class="badge" [class]="'badge-' + log.action.toLowerCase()">
                  {{ log.action }}
                </span>
                <span class="entry-time" [matTooltip]="toDate(log.timestamp) | date:'medium'">
                  {{ toDate(log.timestamp) | timeAgo }}
                </span>
              </div>

              <!-- Who + where -->
              <div class="entry-meta">
                <span class="meta-item">
                  <mat-icon class="meta-icon">person</mat-icon>{{ log.modifiedBy || 'Unknown' }}
                </span>
                <span class="meta-item">
                  <mat-icon class="meta-icon">link</mat-icon>{{ log.modifiedFrom || 'Unknown' }}
                </span>
              </div>

              <!-- ─────────────────────────────────────────────────────────
                   DELTA FORMAT (new logs): iterate over the changes map.

                   LEARNING: KeyValuePipe + @for
                   The changes property is a plain JS object (Record<string, ...>).
                   Angular's @for directive needs an iterable (array/Map), not an
                   object. KeyValuePipe (| keyvalue) converts the object into an
                   array of {key, value} pairs so @for can iterate over it cleanly.
                   ───────────────────────────────────────────────────────── -->
              @if (log.changes) {
                @let entries = log.changes | keyvalue;
                @if (entries.length > 0) {
                  <div class="diff-section">
                    <p class="diff-title">{{ entries.length }} field{{ entries.length === 1 ? '' : 's' }} changed:</p>
                    <div class="diff-table">
                      @for (entry of entries; track entry.key) {
                        <div class="diff-row">
                          <span class="diff-key">{{ entry.key }}</span>
                          <span class="diff-old" [matTooltip]="'Was: ' + formatValue(entry.value.old)">
                            {{ formatValue(entry.value.old) }}
                          </span>
                          <mat-icon class="diff-arrow">arrow_forward</mat-icon>
                          <span class="diff-new" [matTooltip]="'Now: ' + formatValue(entry.value.new)">
                            {{ formatValue(entry.value.new) }}
                          </span>
                        </div>
                      }
                    </div>
                  </div>
                }
              }

              <!-- ─────────────────────────────────────────────────────────
                   LEGACY FORMAT (pre-migration logs): show simplified view.
                   These logs have previousState/newState instead of changes.
                   ───────────────────────────────────────────────────────── -->
              @if (!log.changes && log.action === 'UPDATE') {
                <div class="legacy-note">
                  <mat-icon class="legacy-icon">history_edu</mat-icon>
                  Legacy log — full-state snapshot (pre-delta migration).
                </div>
              }

              <!-- CREATE/DELETE: no diff to show, action speaks for itself -->
              @if (log.action === 'CREATE') {
                <p class="entry-note">Record created.</p>
              }
              @if (log.action === 'DELETE') {
                <p class="entry-note warn-note">Record deleted.</p>
              }

            </div>
          }
        </div>
      }

    </div>

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
    .title-label { color: #777; font-size: 0.9rem; font-weight: 400; }

    .dialog-content {
      min-height: 120px;
      max-height: 65vh;
      overflow-y: auto;
      padding: 4px 2px;
    }

    /* ── States ──────────────────────────── */
    .state-box {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      padding: 40px 16px;
      color: #666;
      text-align: center;
    }
    .state-box.error mat-icon { color: #f44336; font-size: 36px; }
    .state-box.empty mat-icon { font-size: 40px; color: #bbb; }
    .state-box.empty small { color: #aaa; font-size: 0.8rem; }

    /* ── Timeline ────────────────────────── */
    .timeline { display: flex; flex-direction: column; gap: 10px; }

    .entry {
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      padding: 10px 14px;
      background: #fafafa;
      border-left: 4px solid #5c6bc0;
    }
    .entry-create { border-left-color: #43a047; }
    .entry-delete { border-left-color: #e53935; }

    .entry-header { display: flex; align-items: center; gap: 10px; margin-bottom: 5px; }

    .badge {
      font-size: 0.68rem;
      font-weight: 700;
      letter-spacing: 0.5px;
      padding: 2px 7px;
      border-radius: 10px;
      text-transform: uppercase;
    }
    .badge-update { background: #e3f2fd; color: #1565c0; }
    .badge-create { background: #e8f5e9; color: #2e7d32; }
    .badge-delete { background: #ffebee; color: #b71c1c; }

    .entry-time { font-size: 0.8rem; color: #888; cursor: default; }

    .entry-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 6px;
    }
    .meta-item {
      display: flex;
      align-items: center;
      gap: 3px;
      font-size: 0.8rem;
      color: #555;
    }
    .meta-icon { font-size: 13px; width: 13px; height: 13px; color: #999; }

    /* ── Delta Diff Table ────────────────── */
    .diff-section { margin-top: 4px; }
    .diff-title { font-size: 0.76rem; color: #777; margin: 0 0 5px; font-weight: 500; }

    .diff-table {
      display: flex;
      flex-direction: column;
      gap: 3px;
      max-height: 200px;
      overflow-y: auto;
    }
    .diff-row {
      display: grid;
      /* field-name | old-value | arrow | new-value */
      grid-template-columns: 130px 1fr 18px 1fr;
      align-items: center;
      gap: 6px;
      font-size: 0.76rem;
      background: #fff;
      padding: 3px 6px;
      border-radius: 4px;
      border: 1px solid #eee;
    }
    .diff-key { font-weight: 600; color: #333; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .diff-old { color: #c62828; font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .diff-arrow { font-size: 13px; color: #bbb; }
    .diff-new { color: #2e7d32; font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    /* ── Legacy & Notes ──────────────────── */
    .legacy-note {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 0.76rem;
      color: #999;
      font-style: italic;
      margin-top: 4px;
    }
    .legacy-icon { font-size: 14px; }
    .entry-note { font-size: 0.8rem; color: #777; margin: 4px 0 0; }
    .warn-note { color: #b71c1c; }
  `]
})
export class AuditHistoryDialogComponent implements OnInit {
  private readonly tripRepo  = inject(TripRepository);
  private readonly visitRepo = inject(VisitRepository);
  private readonly shipRepo  = inject(ShipRepository);

  readonly logs    = signal<AuditLog[]>([]);
  readonly loading = signal(true);
  readonly error   = signal<string | null>(null);

  // Expose pure functions to the template
  readonly toDate      = toDate;
  readonly formatValue = formatValue;

  constructor(
    public dialogRef: MatDialogRef<AuditHistoryDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: AuditHistoryDialogData
  ) {}

  async ngOnInit(): Promise<void> {
    try {
      // LEARNING: Dispatch to the correct repository based on collectionName.
      // Single generic dialog handles trips, visits, and ships via the data payload.
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
      const msg = err instanceof Error ? err.message : 'Unknown error.';
      this.error.set(`Could not load audit history: ${msg}`);
      console.error('[AuditHistoryDialog]', err);
    } finally {
      this.loading.set(false);
    }
  }
}
