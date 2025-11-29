export interface Waypoint {
    name: string;
    lat: number;
    long: number;
    dist: number;
    use: string;
}

export interface CalculationResult {
    fromTime: Date;
    nextWP: Waypoint;
    distToWP: number;
    distToKil: number;
    distToScattery: number;
    timeToKil: number;
    etaKil: Date;
    etaScattery: Date;
}

export interface ShipPosition {
    lat: number;
    latmin: number;
    long: number;
    longmin: number;
    speed: number;
    delay_hrs: number;
    delay_mns: number;
}
