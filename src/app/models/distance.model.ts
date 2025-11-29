import { ShipPosition, Waypoint } from '../dist2shannon/interfaces/waypoint';

export interface Distance {
  id?: string;
  shipName: string;
  position: ShipPosition;
  calculatedAt: Date;
  nextWaypoint: Waypoint;
  distToScattery: number;
  speed: number;
  etaKilcredaun: Date;
  etaScattery: Date;
  user: string;
}
