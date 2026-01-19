/**
 * Represents the current state of a vessel's visit (State Machine)
 */
export type VisitStatus = 
  | 'Due' 
  | 'Awaiting Berth' 
  | 'Alongside' 
  | 'Sailed' 
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

