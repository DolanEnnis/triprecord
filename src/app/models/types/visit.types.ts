/**
 * Represents the current state of a vessel's visit (State Machine).
 *
 * Status flow: Due → Awaiting Berth → Alongside → Sailed
 *
 * 'Undefined' is a special archival status assigned when a pilot manually enters
 * a trip from an earlier date (i.e. boarding date is NOT today). It is intentionally
 * excluded from all activeStatuses arrays, so the ship will NOT appear on the
 * Status List or be queried by RiverStateService. It can be manually promoted
 * to 'Alongside' via the Edit Trip page if needed.
 */
export type VisitStatus = 
  | 'Due' 
  | 'Awaiting Berth' 
  | 'Alongside' 
  | 'Sailed'
  | 'Undefined'
  | 'Cancelled';

/**
 * Defines the source of the information
 */
export type Source = 
  | 'Sheet' 
  | 'Sheet-Info'
  | 'AIS' 
  | 'Good Guess' 
  | 'Agent' 
  | 'Pilot' 
  | 'Other';

