/**
 * Defines the type of service rendered (Chargeable Event)
 */
export type TripType = 
  | 'In' 
  | 'Out' 
  | 'Anchorage' 
  | 'Shift' 
  | 'BerthToBerth' 
  | 'Other';

/**
 * Direction of a trip (derived from TripType)
 */
export type TripDirection = 'inward' | 'outward' | 'other';
