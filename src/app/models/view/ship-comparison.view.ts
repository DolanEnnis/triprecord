import type { PdfShip } from './pdf-ship.view';

/**
 * Type of change detected when comparing PDF versions.
 * 
 * @remarks
 * - `new`: Ship appears in current PDF but not in previous
 * - `removed`: Ship was in previous PDF but not in current
 * - `modified`: Ship exists in both, but one or more fields changed
 * - `unchanged`: Ship exists in both with identical data
 */
export type ChangeType = 'new' | 'removed' | 'modified' | 'unchanged';

/**
 * View Model: Result of comparing a ship between two PDF versions.
 * 
 * @remarks
 * This model encapsulates all information needed to render a ship row
 * with appropriate change highlighting (bold for new/changed, strikethrough for removed).
 * 
 * **Change Detection Logic:**
 * - Ships are matched by name (case-insensitive)
 * - If matched, fields are compared: name, gt, port, status, eta
 * - Any difference marks the field in `changedFields` set
 * 
 * **UI Rendering:**
 * - `changeType === 'new'` → Entire row bold
 * - `changeType === 'removed'` → Entire row strikethrough
 * - `changeType === 'modified'` → Only cells in `changedFields` are bold
 * 
 * @example
 * ```typescript
 * const comparison: ShipComparisonResult = {
 *   ship: { name: 'MSC OSCAR', gt: 195000, ... },
 *   changeType: 'modified',
 *   changedFields: new Set(['eta', 'status'])
 * };
 * 
 * // In template:
 * // - Ship name: normal
 * // - GT: normal
 * // - ETA: bold (changed)
 * // - Status: bold (changed)
 * ```
 */
export interface ShipComparisonResult {
  /** The ship being displayed (from current or previous PDF) */
  ship: PdfShip;
  
  /** Type of change detected */
  changeType: ChangeType;
  
  /** 
   * Set of field names that changed.
   * Only populated when changeType === 'modified'.
   * Used to selectively bold individual cells.
   */
  changedFields: Set<keyof PdfShip>;
}
