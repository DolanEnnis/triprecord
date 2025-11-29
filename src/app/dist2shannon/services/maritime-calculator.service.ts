import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { Waypoint, CalculationResult, ShipPosition } from '../interfaces/waypoint';

@Injectable({
    providedIn: 'root'
})
export class MaritimeCalculatorService {

    private readonly waypoints: Waypoint[] = [
        { name: "Kilcreadaun", lat: 52.55333, long: -9.71667, dist: 0, use: "Kilcreadaun" },
        { name: "Loop Head", lat: 52.53333, long: -10, dist: 10.43, use: "Loop Head" },
        { name: "Slyne Head", lat: 53.40000, long: -10.46667, dist: 65.11, use: "Slyne Head" },
        { name: "Black Rock", lat: 54.08333, long: -10.48333, dist: 106.12, use: "Black Rock" },
        { name: "Eagle Island", lat: 54.31333, long: -10.33333, dist: 120.89, use: "Eagle Island" },
        { name: "Tory Island", lat: 55.32167, long: -8.28333, dist: 214.19, use: "Tory Island" },
        { name: "Inishtrahull", lat: 55.50833, long: -7.23333, dist: 251.74, use: "Inishtrahull" },
        { name: "Middle Bank", lat: 55.42500, long: -6.24333, dist: 285.86, use: "Middle Bank" },
        { name: "Rathlin TSS", lat: 55.40167, long: -6.05, dist: 292.60, use: "Rathlin TSS" },
        { name: "East Maiden", lat: 55.06667, long: -5.46667, dist: 320.96, use: "East Maiden" },
        { name: "Black Head", lat: 54.75833, long: -5.63333, dist: 340.33, use: "Black Head" },
        { name: "Inishtoosk", lat: 52.15935, long: -10.61583, dist: 40.63, use: "Inishtoosk" },
        { name: "Inishtearaght", lat: 52.08675, long: -10.72698, dist: 46.61, use: "Inishtearaght" },
        { name: "Little Foze", lat: 52.01442, long: -10.75322, dist: 51.05, use: "Little Foze" },
        { name: "Skellig", lat: 51.75122, long: -10.60485, dist: 67.7783, use: "Skellig" },
        { name: "Bull", lat: 51.56700, long: -10.3489, dist: 82.3865, use: "Bull" },
        { name: "Fastnet", lat: 51.25328, long: -9.57865, dist: 116.877, use: "Fastnet" },
        { name: "BANN SHOAL BUOY", lat: 50.34187, long: -5.88902, dist: 267.458, use: "BANN SHOAL BUOY" },
        { name: "Wolf Rock", lat: 49.99257, long: -5.8866, dist: 288.42, use: "Wolf Rock" },
        { name: "Lizard", lat: 49.90167, long: -5.20282, dist: 315.45, use: "Lizard" },
        { name: "CS1", lat: 50.53037, long: -0.05217, dist: 517.30, use: "CS1" },
        { name: "Scilly", lat: 49.72, long: -6.6412, dist: 261.88, use: "Scilly" },
    ];

    private readonly guard = [
        { lat: 52.532953, long: -9.99620, use: "Kilcreadaun", name: "guard " + "Kilcreadaun", dist: 1000000 },
        { lat: 53.39683, long: -10.46664, use: "Loop Head", name: "guard " + "Loop Head", dist: 1000000 },
        { lat: 54.08, long: -10.48333, use: "Slyne Head", name: "guard " + "Slyne Head", dist: 1000000 },
        { lat: 54.31333, long: -10.33633, use: "Black Rock", name: "guard " + "Black Rock", dist: 1000000 },
        { lat: 55.31951, long: -8.28533, use: "Eagle Island", name: "guard " + "Eagle Island", dist: 1000000 },
        { lat: 55.50833, long: -7.23433, use: "Tory Island", name: "guard " + "Tory Island", dist: 1000000 },
        { lat: 55.42549, long: -6.243823, use: "Inishtrahull", name: "guard " + "Inishtrahull", dist: 1000000 },
        { lat: 55.40236, long: -6.05070, use: "Middle Bank", name: "guard " + "Middle Bank", dist: 1000000 },
        { lat: 55.06903, long: -5.46967, use: "Rathlin TSS", name: "guard " + "Rathlin TSS", dist: 1000000 },
        { lat: 54.76152, long: -5.63633, use: "East Maiden", name: "guard " + "East Maiden", dist: 1000000 },
        { lat: 52.16129, long: -10.61883, use: "Kilcreadaun", name: "guard " + "Kilcreadaun", dist: 1000000 },
        { lat: 52.2, long: -10.4, use: "Kilcreadaun", name: "guard " + "Kilcreadaun", dist: 1000000 },
        { lat: 52.08918, long: -10.72998, use: "Inishtoosk", name: "guard " + "Inishtoosk", dist: 1000000 },
        { lat: 52.01767, long: -10.75324, use: "Inishtearaght", name: "guard " + "Inishtearaght", dist: 1000000 },
        { lat: 51.75121, long: -10.60785, use: "Little Foze", name: "guard " + "Little Foze", dist: 1000000 },
        { lat: 51.75122, long: -10.75322, use: "Little Foze", name: "guard " + "Little Foze", dist: 1000000 },
        { lat: 51.5670, long: -10.35190, use: "Skellig", name: "guard " + "Skellig", dist: 1000000 },
        { lat: 51.25328, long: -9.58165, use: "Bull", name: "guard " + "Bull", dist: 1000000 },
        { lat: 50.34487, long: -5.89052, use: "Fastnet", name: "guard " + "Fastnet", dist: 1000000 },
        { lat: 49.9959, long: -5.89660, use: "BANN SHOAL BUOY", name: "guard " + "BANN SHOAL BUOY", dist: 1000000 },
        { lat: 49.89867, long: -5.20582, use: "Wolf Rock", name: "guard " + "Wolf Rock", dist: 1000000 },
        { lat: 50.52974, long: -0.05317, use: "Lizard", name: "guard " + "Lizard", dist: 1000000 },
        { lat: 49.72, long: -6.6418, use: "Bull", name: "guard " + "Bull", dist: 1000000 },
        { lat: 49.99, long: -5.89, use: "Scilly", name: "guard " + "Scilly", dist: 1000000 },
    ];

    private readonly points = [...this.waypoints, ...this.guard];

    private positionSubject = new BehaviorSubject<ShipPosition>({
        lat: 53, latmin: 0, long: 10, longmin: 0, speed: 10, delay_hrs: 0, delay_mns: 0
    });

    private calculationSubject = new BehaviorSubject<CalculationResult>(this.calculate(this.positionSubject.value));

    constructor(private http: HttpClient) { }

    getPosition(): Observable<ShipPosition> {
        return this.positionSubject.asObservable();
    }

    getCalculation(): Observable<CalculationResult> {
        return this.calculationSubject.asObservable();
    }

    getWaypoints(): Waypoint[] {
        return this.waypoints;
    }

    getMarineDistance(lat1: number, lon1: number, lat2: number, lon2: number): Observable<any> {
        const url = `https://api.distance.tools/v1/route.json?stops=${lat1},${lon1}|${lat2},${lon2}&apikey=${environment.distanceApiKey}`;
        return this.http.get(url);
    }

    updatePosition(pos: ShipPosition) {
        this.positionSubject.next(pos);
        this.calculationSubject.next(this.calculate(pos));
    }

    updateWaypoint(wp: Waypoint) {
        const currentPos = this.positionSubject.value;
        const op = this.calculate(currentPos);
        op.nextWP = wp; // Override nextWP

        // Recalculate distances based on forced waypoint
        op.distToWP = this.distance(
            currentPos.lat + (currentPos.latmin / 60),
            -(currentPos.long + (currentPos.longmin / 60)),
            op.nextWP.lat,
            op.nextWP.long
        );
        op.distToKil = (op.distToWP + op.nextWP.dist);
        op.distToScattery = op.distToKil + 9;
        op.timeToKil = (op.distToKil / currentPos.speed);

        const fromTime = new Date();
        fromTime.setMinutes(fromTime.getMinutes() - currentPos.delay_mns);
        fromTime.setHours(fromTime.getHours() - currentPos.delay_hrs);

        op.etaKil = new Date(fromTime.getTime());
        op.etaKil.setHours(fromTime.getHours() + op.timeToKil);
        op.etaKil.setMinutes(fromTime.getMinutes() + (op.timeToKil % 1 * 60));

        op.etaScattery = new Date(op.etaKil.getTime());
        op.etaScattery.setMinutes(op.etaScattery.getMinutes() + (9 / currentPos.speed) * 60);

        this.calculationSubject.next(op);
    }

    private calculate(pos: ShipPosition): CalculationResult {
        const fromTime = new Date();
        fromTime.setMinutes(fromTime.getMinutes() - pos.delay_mns);
        fromTime.setHours(fromTime.getHours() - pos.delay_hrs);

        const latDecimal = pos.lat + (pos.latmin / 60);
        const longDecimal = pos.long + (pos.longmin / 60);

        const nextWP = this.findNextWP(latDecimal, longDecimal);

        const distToWP = this.distance(latDecimal, -longDecimal, nextWP.lat, nextWP.long);
        const distToKil = distToWP + nextWP.dist;
        const distToScattery = distToKil + 9;
        const timeToKil = distToKil / pos.speed;

        const etaKil = new Date(fromTime.getTime());
        etaKil.setHours(fromTime.getHours() + timeToKil);
        etaKil.setMinutes(fromTime.getMinutes() + (timeToKil % 1 * 60));

        const etaScattery = new Date(etaKil.getTime());
        etaScattery.setMinutes(etaScattery.getMinutes() + (9 / pos.speed) * 60);

        return {
            fromTime,
            nextWP,
            distToWP,
            distToKil,
            distToScattery,
            timeToKil,
            etaKil,
            etaScattery
        };
    }

    private findNextWP(lat: number, long: number): Waypoint {
        let nearestDist = 10000000;
        let nearWP: any = {
            lat: 0,
            long: 0,
            use: "Kilcreadaun",
            name: "Nothing Near",
            dist: 1000000,
        };

        for (let i = 0; i < this.points.length; i++) {
            const dist = this.distance(lat, -long, this.points[i].lat, this.points[i].long);
            if (dist < nearestDist) {
                nearestDist = dist;
                nearWP = this.points[i];
            }
        }

        let wp = this.waypoints.find(w => w.name === nearWP.use);
        return wp || this.waypoints[0]; // Fallback
    }

    private distance(lat1: number, lon1: number, lat2: number, lon2: number): number {
        if (lat1 === lat2 && lon1 === lon2) {
            return 0;
        } else {
            const radlat1 = (Math.PI * lat1) / 180;
            const radlat2 = (Math.PI * lat2) / 180;
            const theta = lon1 - lon2;
            const radtheta = (Math.PI * theta) / 180;
            let dist =
                Math.sin(radlat1) * Math.sin(radlat2) +
                Math.cos(radlat1) * Math.cos(radlat2) * Math.cos(radtheta);
            if (dist > 1) {
                dist = 1;
            }
            dist = Math.acos(dist);
            dist = (dist * 180) / Math.PI;
            dist = dist * 60;
            return dist;
        }
    }
}
