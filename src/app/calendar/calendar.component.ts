import { Component, computed, inject, input, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EnvironmentalRepository } from '../services/repositories/environmental.repository';
import { EnvironmentalEvent, VisitStatus } from '../models';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs/operators';
import { Timestamp } from '@angular/fire/firestore';
import { Router, RouterLink } from '@angular/router';
import { RiverStateService } from '../services/state/river-state.service';

@Component({
  selector: 'app-calendar',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './calendar.component.html',
  styleUrls: ['./calendar.component.css']
})
export class CalendarComponent implements OnDestroy {
  private readonly envRepo    = inject(EnvironmentalRepository);
  private readonly router     = inject(Router);
  private readonly riverState = inject(RiverStateService);

  /** Current minute of the day (0–1439), updated every 60s for the now-line */
  readonly currentMinute = signal(this.getNowMinute());
  private readonly nowTimer = setInterval(() =>
    this.currentMinute.set(this.getNowMinute()), 60_000
  );

  /** True when the selected date is today — controls whether the now-line is shown */
  readonly showNowLine = computed(() => {
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return this.selectedDate() === todayKey;
  });

  private getNowMinute(): number {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }

  ngOnDestroy(): void {
    clearInterval(this.nowTimer);
  }

  /**
   * Optional date string from the route (e.g., /calendar-portrait/2026-03-01).
   * Mapped automatically via withComponentInputBinding() in appConfig.
   */
  readonly date = input<string>();

  /**
   * Computes the active date (defaults to today if the input is missing).
   */
  readonly selectedDate = computed(() => {
    const routeDate = this.date();
    if (routeDate) return routeDate;
    
    // Default to today
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    const d = String(now.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  });

  /**
   * Reactively fetches all environmental events for the active date.
   */
  readonly allEvents = toSignal(
    toObservable(this.selectedDate).pipe(
      switchMap((dateKey: string) => this.envRepo.getEventsByDate(dateKey))
    ),
    { initialValue: [] as EnvironmentalEvent[] }
  );

  // ─────────────────────────────────────────────────────────────────────────
  // SHIP MARKERS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Projects active ship visits onto the 1440px timeline.
   *
   * MARKER TYPES:
   *   ETA (dashed border) — from visit.initialEta — always created
   *   ETB (solid border)  — from inwardTrip.boarding — created when boarding
   *                         falls on the selected date
   *
   * COLLISION OFFSET: if two markers share a column + minute, each additional
   * marker is shifted 12px to the right so they remain individually legible.
   *
   * PORT → COLUMN MAPPING:
   *   Foynes, Shannon, Cappa     → 'foynes'
   *   Aughinish, Moneypoint, Tarbert → 'aughinish'
   *   Limerick                   → 'limerick'
   */
  readonly calendarShipMarkers = computed(() => {
    const dateKey = this.selectedDate();
    const ships   = this.riverState.activeShipsWithTrips();

    /** Maps a berthPort string to one of our three calendar columns */
    const toColumn = (port: string | null | undefined): 'limerick' | 'foynes' | 'aughinish' | null => {
      if (!port) return null;
      if (['Foynes', 'Moneypoint', 'Tarbert', 'Cappa'].includes(port))  return 'foynes';
      if (['Aughinish'].includes(port))                                 return 'aughinish';
      if (['Limerick', 'Shannon'].includes(port))                       return 'limerick';
      return null;
    };

    /** Returns 'YYYY-MM-DD' from any Timestamp/Date/string (local time) */
    const toDateKey = (ts: Timestamp | Date | string | null | undefined): string | null => {
      if (!ts) return null;
      const d = ts instanceof Timestamp ? ts.toDate() : new Date(ts);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    type RawMarker = { visitId: string; shipName: string; gt: number; status: VisitStatus;
                       markerType: 'ETA' | 'ETB' | 'ETS'; topPx: number; markerTime: string;
                       pilotName: string | null;
                       portName: string | null;
                       column: 'limerick' | 'foynes' | 'aughinish'; offsetLeft: number };

    const raw: RawMarker[] = [];

    for (const ship of ships) {
      const column = toColumn(ship.berthPort);
      if (!column) continue; // port not displayed on this calendar

      // ETA marker — always use initialEta as the ship arrival time
      if (toDateKey(ship.initialEta) === dateKey) {
        const min = this.calculateMinuteOfDay(ship.initialEta);
        raw.push({
          visitId: ship.id!, shipName: ship.shipName, gt: ship.grossTonnage,
          status: ship.currentStatus as VisitStatus,
          markerType: 'ETA',
          topPx: min,
          markerTime: `${String(Math.floor(min / 60)).padStart(2,'0')}:${String(min % 60).padStart(2,'0')}`,
          pilotName: ship.inwardPilot ?? null,
          portName: ship.berthPort ?? null,
          column, offsetLeft: 0
        });
      }

      // ETB marker — inward trip boarding time
      const etb = ship.inwardTrip?.boarding;
      if (etb && toDateKey(etb) === dateKey) {
        const min = this.calculateMinuteOfDay(etb);
        raw.push({
          visitId: ship.id!, shipName: ship.shipName, gt: ship.grossTonnage,
          status: ship.currentStatus as VisitStatus,
          markerType: 'ETB',
          topPx: min,
          markerTime: `${String(Math.floor(min / 60)).padStart(2,'0')}:${String(min % 60).padStart(2,'0')}`,
          pilotName: ship.inwardTrip?.pilot ?? null,
          portName: ship.berthPort ?? null,
          column, offsetLeft: 0
        });
      }

      // ETS marker — outward trip boarding time (pilot boards to sail the ship out)
      const ets = ship.outwardTrip?.boarding;
      if (ets && toDateKey(ets) === dateKey) {
        const min = this.calculateMinuteOfDay(ets);
        raw.push({
          visitId: ship.id!, shipName: ship.shipName, gt: ship.grossTonnage,
          status: ship.currentStatus as VisitStatus,
          markerType: 'ETS',
          topPx: min,
          markerTime: `${String(Math.floor(min / 60)).padStart(2,'0')}:${String(min % 60).padStart(2,'0')}`,
          pilotName: ship.outwardTrip?.pilot ?? null,
          portName: ship.berthPort ?? null,
          column, offsetLeft: 0
        });
      }
    }

    // Collision offset: group by (column, topPx), assign staggered offsetLeft
    const seen = new Map<string, number>();
    for (const m of raw) {
      const key = `${m.column}:${m.topPx}`;
      const count = seen.get(key) ?? 0;
      m.offsetLeft = count * 12;
      seen.set(key, count + 1);
    }

    return raw;
  });

  /** ETA/ETB markers for the Limerick ship-half */
  readonly limerickMarkers   = computed(() => this.calendarShipMarkers().filter(m => m.column === 'limerick'));
  /** ETA/ETB markers for the Foynes ship-half */
  readonly foynesMarkers     = computed(() => this.calendarShipMarkers().filter(m => m.column === 'foynes'));
  /** ETA/ETB markers for the Aughinish ship-half */
  readonly aughinishMarkers  = computed(() => this.calendarShipMarkers().filter(m => m.column === 'aughinish'));

  /**
   * Filters all events to return just the solar ones (Dawn / Dusk).
   */
  readonly solarEvents = computed(() =>
    this.allEvents().filter((e: EnvironmentalEvent) => e.port === 'solar')
  );

  /**
   * The height of the timeline container.
   * Based on the 1440 mapping: 1px = 1min
   */
  readonly containerHeight = 1440;

  /**
   * Array of hours 0-23 used by the time-axis in the template.
   * Defined here so we can iterate cleanly in the template with *ngFor.
   */
  readonly hours = Array.from({ length: 24 }, (_, i) => i);

  /**
   * Helper that takes a Firestore Timestamp and returns the minute of the day.
   * e.g. 06:30 -> (6 * 60) + 30 = 390.
   */
  calculateMinuteOfDay(timestamp: Timestamp): number {
    const date = timestamp.toDate();
    // Use UTC to avoid timezone issues with raw time extractions
    const hours = date.getUTCHours();
    const minutes = date.getUTCMinutes();
    return (hours * 60) + minutes;
  }

  /**
   * Helper that takes a Firestore Timestamp and returns a 'HH:mm' string.
   */
  formatTime(timestamp: Timestamp): string {
    const date = timestamp.toDate();
    const hours = date.getUTCHours().toString().padStart(2, '0');
    const minutes = date.getUTCMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  /**
   * Computes the dawn and dusk minute-of-day values from the solar events.
   * 
   * These are used by the template to position the two night-shade bands
   * inside the dedicated Sun column:
   *   - A top band from 0 → dawnMin (pre-dawn darkness)
   *   - A bottom band from duskMin → 1440 (post-dusk darkness)
   * 
   * If no solar data exists, hasSolarData is false and the column falls back
   * to a uniformly neutral appearance rather than breaking visually.
   */
  readonly solarBounds = computed(() => {
    const solar = this.solarEvents();
    if (!solar || solar.length === 0) {
      return { hasSolarData: false, dawnMin: 0, duskMin: 1440 };
    }

    // Find dawn (type: 'dawn') and dusk (type: 'dusk') specifically.
    // Fall back to first/last sorted event if types aren't present.
    const sortedSolar = [...solar].sort((a, b) => a.timestamp.toMillis() - b.timestamp.toMillis());
    const dawnEvent = sortedSolar.find(e => e.type === 'dawn') ?? sortedSolar[0];
    const duskEvent = sortedSolar.find(e => e.type === 'dusk') ?? sortedSolar[sortedSolar.length - 1];

    if (!dawnEvent || !duskEvent) {
      return { hasSolarData: false, dawnMin: 0, duskMin: 1440 };
    }

    return {
      hasSolarData: true,
      dawnMin: this.calculateMinuteOfDay(dawnEvent.timestamp),
      duskMin: this.calculateMinuteOfDay(duskEvent.timestamp),
    };
  });

  /**
   * Returns all Limerick port events sorted by timestamp.
   * Includes HW Limerick tides and the 3 pilotage window events:
   *   - boarding_limerick  (HW Lim - 4h30m)
   *   - airport_boarding   (HW Lim - 3h45m)
   *   - standby_airport    (HW Lim - 1h20m)
   *   - high / low         (actual HW/LW readings)
   */
  readonly limerickTideEvents = computed(() =>
    this.allEvents()
      .filter((e: EnvironmentalEvent) => e.port === 'limerick')
      .sort((a, b) => a.timestamp.toMillis() - b.timestamp.toMillis())
  );

  /**
   * Returns an array of Aughinish flood window pairs — one per tidal cycle.
   *
   * WHY AN ARRAY?
   * Each day typically has TWO HW cycles, producing two flood_start_augh
   * and two last_xover_augh events. Using find() only returned the first.
   * We now filter ALL events of each type and zip them by time order.
   *
   * Each pair: { floodEvent, xoverEvent, bandTop, bandHeight }
   * Missing boundary → extends to midnight (0 or 1440).
   */
  readonly aughinishWindows = computed(() => {
    const all = this.allEvents();

    const floods = all
      .filter(e => e.type === 'flood_start_augh')
      .sort((a, b) => a.timestamp.toMillis() - b.timestamp.toMillis());

    const xovers = all
      .filter(e => e.type === 'last_xover_augh')
      .sort((a, b) => a.timestamp.toMillis() - b.timestamp.toMillis());

    const pairs: { floodEvent: EnvironmentalEvent | null; xoverEvent: EnvironmentalEvent | null; bandTop: number; bandHeight: number }[] = [];

    let fi = 0; // pointer into floods
    let xi = 0; // pointer into xovers

    // Any xover that occurs BEFORE the first flood of today belongs to a window
    // that opened the previous day. Green band runs from midnight (0) to that xover.
    const firstFloodMs = floods[0]?.timestamp.toMillis() ?? Infinity;
    while (xi < xovers.length && xovers[xi].timestamp.toMillis() < firstFloodMs) {
      const xoverEvent = xovers[xi++];
      const xoverMin = this.calculateMinuteOfDay(xoverEvent.timestamp);
      pairs.push({ floodEvent: null, xoverEvent, bandTop: 0, bandHeight: xoverMin });
    }

    // Pair each remaining flood with the next available xover.
    // If no xover exists (window extends past midnight), the band runs to 1440.
    while (fi < floods.length) {
      const floodEvent = floods[fi++];
      const xoverEvent = xovers[xi] ?? null;
      if (xoverEvent) xi++;
      const floodMin  = this.calculateMinuteOfDay(floodEvent.timestamp);
      const xoverMin  = xoverEvent ? this.calculateMinuteOfDay(xoverEvent.timestamp) : 1440;
      pairs.push({ floodEvent, xoverEvent, bandTop: floodMin, bandHeight: xoverMin - floodMin });
    }

    return pairs;
  });

  /**
   * Returns a human-readable label for a Limerick tide event.
   * Pilotage events show their action name; HW/LW show height.
   */
  limerickEventLabel(event: EnvironmentalEvent): string {
    switch (event.type) {
      case 'boarding_limerick':  return 'Bdg Lim';
      case 'airport_boarding':   return 'Bdg Airport';
      case 'standby_airport':    return 'St-By Airport';
      case 'high': return `HW Limerick (${event.height}m)`;
      case 'low':  return `LW Limerick (${event.height}m)`;
      default:     return event.type;
    }
  }

  /**
   * Returns Foynes HW and LW events sorted by time.
   * Excludes pilotage-derived types (last_xover_augh) which live in the
   * Aughinish column, not the Foynes tide display.
   */
  readonly foynesTideEvents = computed(() =>
    this.allEvents()
      .filter((e: EnvironmentalEvent) => e.port === 'foynes' && (e.type === 'high' || e.type === 'low'))
      .sort((a, b) => a.timestamp.toMillis() - b.timestamp.toMillis())
  );

  /** Label for a Foynes tide event, including height. */
  foynesEventLabel(event: EnvironmentalEvent): string {
    switch (event.type) {
      case 'high': return `HW Foynes (${event.height}m)`;
      case 'low':  return `LW Foynes (${event.height}m)`;
      default:     return event.type;
    }
  }

  /**
   * Returns an interpolated font colour for a Limerick HW tide based on height,
   * mirroring the spreadsheet's conditional colour scale:
   *
   *   Min value (neap, ~3m) → Blue   (#6d9eeb)
   *   Midpoint  (6m)        → Grey   (#aaaaaa)  ← white in spreadsheet, grey here for visibility
   *   Max value (spring)    → Red    (#cc0000)
   *
   * Only applied to 'high' events — pilotage events keep their existing blue-grey.
   */
  limerickHwFontColor(height: number): string {
    // Colour anchors in [R, G, B]
    const BLUE = [109, 158, 235]; // #6d9eeb  neap
    const GREY = [170, 170, 170]; // #aaaaaa  midpoint
    const RED  = [204,   0,   0]; // #cc0000  springs

    const MID_HEIGHT = 6.0;
    const MIN_HEIGHT = 3.0;  // lowest HW we classify
    const MAX_HEIGHT = 6.5;  // approximate spring maximum

    let r: number, g: number, b: number;

    if (height <= MID_HEIGHT) {
      // Interpolate BLUE → GREY over 3m–6m range
      const t = Math.max(0, Math.min(1, (height - MIN_HEIGHT) / (MID_HEIGHT - MIN_HEIGHT)));
      r = Math.round(BLUE[0] + (GREY[0] - BLUE[0]) * t);
      g = Math.round(BLUE[1] + (GREY[1] - BLUE[1]) * t);
      b = Math.round(BLUE[2] + (GREY[2] - BLUE[2]) * t);
    } else {
      // Interpolate GREY → RED over 6m–6.5m range
      const t = Math.max(0, Math.min(1, (height - MID_HEIGHT) / (MAX_HEIGHT - MID_HEIGHT)));
      r = Math.round(GREY[0] + (RED[0] - GREY[0]) * t);
      g = Math.round(GREY[1] + (RED[1] - GREY[1]) * t);
      b = Math.round(GREY[2] + (RED[2] - GREY[2]) * t);
    }

    return `rgb(${r}, ${g}, ${b})`;
  }

  /**
   * Returns all Tarbert port events (HW and LW) sorted by timestamp.
   * Displayed in the solar column alongside the dawn/dusk indicators.
   */
  readonly tarbertTideEvents = computed(() =>
    this.allEvents()
      .filter((e: EnvironmentalEvent) => e.port === 'tarbert' && e.type !== 'flood_start_augh')
      .sort((a, b) => a.timestamp.toMillis() - b.timestamp.toMillis())
  );

  /**
   * Returns a human-readable label for a Tarbert tide event.
   */
  tarbertEventLabel(event: EnvironmentalEvent): string {
    switch (event.type) {
      case 'high': return `HW Tarbert (${event.height}m)`;
      case 'low':  return `LW Tarbert (${event.height}m)`;
      default:     return event.type;
    }
  }

  /**
   * Generates the SVG path data for the Tarbert tide curve displayed in the
   * solar column.
   *
   * COORDINATE MAPPING:
   *   Y-axis = Time  (0px midnight → 1440px 23:59)
   *   X-axis = Height (0m → viewBox width of 100 units)
   *
   * Start (00:00) and end (23:59) heights are calculated using the
   * Rule of Twelfths rather than naively carried from the nearest tide.
   * Returns null when fewer than 2 points exist so the SVG stays hidden.
   */
  readonly tarbertPath = computed((): { stroke: string; fill: string } | null => {
    const tidePoints = this.tarbertTideEvents()
      .filter(e => e.type === 'high' || e.type === 'low');

    if (tidePoints.length < 2) return null;

    const MAX_HEIGHT = 6.5;
    const CHART_WIDTH = 90; // within a viewBox of width 100

    // Enrich each event with y (minute of day), x (mapped height), and isHigh
    const events = tidePoints.map(e => ({
      y:      this.calculateMinuteOfDay(e.timestamp),
      height: e.height,
      isHigh: e.type === 'high',
      x:      Math.round((e.height / MAX_HEIGHT) * CHART_WIDTH)
    }));

    // Extrapolate height at 00:00 and 23:59 using the Rule of Twelfths
    const startHeight = this.extrapolateByRuleOf12s(0,    events);
    const endHeight   = this.extrapolateByRuleOf12s(1440, events);

    const startX = Math.round((startHeight / MAX_HEIGHT) * CHART_WIDTH);
    const endX   = Math.round((endHeight   / MAX_HEIGHT) * CHART_WIDTH);

    const pts = [
      { x: startX, y: 0 },     // 00:00 — Rule of Twelfths extrapolated
      ...events.map(e => ({ x: e.x, y: e.y })),
      { x: endX,   y: 1440 }   // 23:59 — Rule of Twelfths extrapolated
    ];

    const strokePath = this.buildSmoothPath(pts);
    const fillPath   = strokePath + ` L 0 ${pts[pts.length - 1].y} L 0 ${pts[0].y} Z`;

    return { stroke: strokePath, fill: fillPath };
  });

  /**
   * Extrapolates tidal height at midnight (targetMinute = 0 or 1440) using
   * the Rule of Twelfths applied to the first or last half-cycle.
   *
   * RULE OF TWELFTHS — cumulative height fraction per 1/6 of cycle:
   *   1/6 elapsed → 1/12 of range
   *   2/6 elapsed → 3/12 of range
   *   3/6 elapsed → 6/12 of range
   *   4/6 elapsed → 9/12 of range
   *   5/6 elapsed → 11/12 of range
   *   6/6 elapsed → 12/12 of range (full range)
   *
   * @param targetMinute  0 = start of day, 1440 = end of day
   * @param events        enriched tide events sorted by time
   */
  private extrapolateByRuleOf12s(
    targetMinute: 0 | 1440,
    events: { y: number; height: number; isHigh: boolean }[]
  ): number {

    // Pick the two tide events that bound the extrapolation
    const eA = targetMinute === 0 ? events[0] : events[events.length - 1];
    const eB = targetMinute === 0 ? events[1] : events[events.length - 2];

    const halfCycleDuration = Math.abs(eA.y - eB.y); // minutes
    const range             = Math.abs(eA.height - eB.height);

    // How far from eA is the boundary (midnight)?
    const minutesFromAToMidnight = Math.abs(eA.y - targetMinute);

    // Phase = fraction of the adjacent half-cycle that has elapsed by midnight.
    // We clamp to [0,1] — beyond 1 means midnight is more than one full half-cycle away.
    const phase = Math.min(minutesFromAToMidnight / halfCycleDuration, 1);
    const heightFrac = this.ruleOf12sFraction(phase);

    if (eA.isHigh) {
      // Tide is moving away from HW toward the next LW past midnight.
      // LW approximation = eB.height (the corresponding LW in the day).
      return eA.height - heightFrac * range;
    } else {
      // Tide is moving away from LW toward the next HW past midnight.
      return eA.height + heightFrac * range;
    }
  }

  /**
   * Maps a phase fraction (0–1 of a tidal half-cycle) to the corresponding
   * cumulative height fraction using the Rule of Twelfths.
   *
   * The six breakpoints and their cumulative rise/fall fractions are:
   *   0/6 → 0/12,  1/6 → 1/12,  2/6 → 3/12,
   *   3/6 → 6/12,  4/6 → 9/12,  5/6 → 11/12,  6/6 → 12/12
   */
  private ruleOf12sFraction(phase: number): number {
    const PHASES = [0,    1/6,  2/6,  3/6,  4/6,   5/6,   1  ];
    const FRACS  = [0, 1/12, 3/12, 6/12, 9/12, 11/12,   1  ];
    const p = Math.max(0, Math.min(1, phase));
    for (let i = 0; i < PHASES.length - 1; i++) {
      if (p <= PHASES[i + 1]) {
        const t = (p - PHASES[i]) / (PHASES[i + 1] - PHASES[i]);
        return FRACS[i] + t * (FRACS[i + 1] - FRACS[i]);
      }
    }
    return 1;
  }

  /**
   * Converts an ordered array of {x, y} points into a smooth SVG cubic
   * bezier path using the Catmull-Rom algorithm.
   *
   * WHY CATMULL-ROM?
   * Unlike a simple polyline, Catmull-Rom guarantees the curve passes through
   * every data point while maintaining a smooth tangent — perfect for a tide
   * wave where we know the exact times and heights.
   */
  private buildSmoothPath(pts: { x: number; y: number }[]): string {
    if (pts.length < 2) return '';

    let d = `M ${pts[0].x} ${pts[0].y}`;

    for (let i = 0; i < pts.length - 1; i++) {
      // Catmull-Rom uses the previous and next points to compute tangents.
      // For edge points we clamp to the nearest available neighbour.
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];

      // Convert Catmull-Rom tangents → cubic bezier control points
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)},`
         + ` ${cp2x.toFixed(1)} ${cp2y.toFixed(1)},`
         + ` ${p2.x} ${p2.y}`;
    }

    return d;
  }

  /**
   * Easy way to bind to the date selector
   */
  onDateChange(event: any) {
    const newDate = event.target.value;
    if (newDate) this.router.navigate(['/calendar-portrait', newDate]);
  }

  /** Shift the current date by ±1 day and navigate */
  changeDay(offset: 1 | -1) {
    const current = new Date(this.selectedDate() + 'T00:00:00Z');
    current.setUTCDate(current.getUTCDate() + offset);
    const y = current.getUTCFullYear();
    const m = String(current.getUTCMonth() + 1).padStart(2, '0');
    const d = String(current.getUTCDate()).padStart(2, '0');
    this.router.navigate(['/calendar-portrait', `${y}-${m}-${d}`]);
  }

  /**
   * Maps a VisitStatus to a CSS-safe class suffix.
   * Used in [ngClass] bindings instead of a 'replace' pipe (which isn't built-in to Angular).
   *  'Due'             → 'marker-due'
   *  'Awaiting Berth'  → 'marker-awaiting-berth'
   *  'Alongside'       → 'marker-alongside'
   */
  shipStatusClass(status: VisitStatus): string {
    const map: Record<string, string> = {
      'Due':            'marker-due',
      'Awaiting Berth': 'marker-awaiting-berth',
      'Alongside':      'marker-alongside',
    };
    return map[status] ?? 'marker-due';
  }
}
