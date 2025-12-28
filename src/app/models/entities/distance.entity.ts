import { ShipPosition, Waypoint } from '../../dist2shannon/interfaces/waypoint';

/**
 * Distance entity representing AIS-based ship tracking and ETA calculations.
 * 
 * @remarks
 * This collection stores snapshots of vessel positions and calculated arrival times
 * for ships approaching the Shannon Estuary. Data is typically sourced from AIS
 * (Automatic Identification System) and processed through the dist2shannon module.
 * 
 * **Use Cases:**
 * - Real-time tracking of inbound vessels
 * - ETA prediction for pilot scheduling
 * - Historical position data for analysis
 * 
 * @firestore Collection path: `/distance`
 * 
 * @see {@link ShipPosition} for GPS coordinates
 * @see {@link Waypoint} for navigation reference points
 * 
 * @example
 * ```typescript
 * const tracking: Distance = {
 *   shipName: 'MSC Oscar',
 *   position: { lat: 52.5, lon: -9.8 },
 *   calculatedAt: new Date(),
 *   nextWaypoint: { name: 'Loop Head', lat: 52.56, lon: -9.93 },
 *   distToScattery: 12.5, // nautical miles
 *   speed: 14.2, // knots
 *   etaKilcredaun: new Date('2024-01-15T10:30:00Z'),
 *   etaScattery: new Date('2024-01-15T11:15:00Z'),
 *   user: 'AIS_Auto'
 * };
 * ```
 */
export interface Distance {
  /** Firestore document ID (auto-generated) */
  id?: string;
  
  /** Name of the vessel being tracked */
  shipName: string;
  
  /** Current GPS position with latitude and longitude */
  position: ShipPosition;
  
  /** Timestamp when this calculation was performed */
  calculatedAt: Date;
  
  /** Next navigation waypoint on route to Shannon */
  nextWaypoint: Waypoint;
  
  /** Distance to Scattery Island in nautical miles */
  distToScattery: number;
  
  /** Vessel's current speed in knots */
  speed: number;
  
  /** Estimated time of arrival at Kilcredaun Point */
  etaKilcredaun: Date;
  
  /** Estimated time of arrival at Scattery Island */
  etaScattery: Date;
  
  /** User or system that recorded this tracking data */
  user: string;
}
