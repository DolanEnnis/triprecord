/**
 * Shared type definitions for the status-list feature
 */

/**
 * Valid port filter options for filtering ship status lists
 */
export type PortFilter = 'All' | 'Aughinish' | 'Foynes' | 'Limerick' | 'Other';

/**
 * Type guard to validate port filter values (e.g., from localStorage)
 * @param value - The value to check
 * @returns True if the value is a valid PortFilter
 */
export function isValidPortFilter(value: string | null): value is PortFilter {
  return value !== null && ['All', 'Aughinish', 'Foynes', 'Limerick', 'Other'].includes(value);
}
