import { Component, computed, inject, input, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EnvironmentalRepository } from '../services/repositories/environmental.repository';
import { EnvironmentalEvent, VisitStatus } from '../models';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs/operators';
import { Timestamp } from '@angular/fire/firestore';
import { Router, RouterLink } from '@angular/router';
import { RiverStateService } from '../services/state/river-state.service';

/**
 * EXPERIMENTAL — Landscape (horizontal) calendar layout.
 * Time runs left→right across 1440px. Each port is a horizontal row.
 * Accessible at /calendar and /calendar/:date.
 * Does NOT affect /calendar-portrait at all.
 */
@Component({
  selector: 'app-calendar-landscape',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './calendar-landscape.component.html',
  styleUrls: ['./calendar-landscape.component.css']
})
export class CalendarLandscapeComponent implements OnDestroy {
  private readonly envRepo    = inject(EnvironmentalRepository);
  private readonly router     = inject(Router);
  private readonly riverState = inject(RiverStateService);

  /** Current minute of the day, updated every 60s for the now-line */
  readonly currentMinute = signal(this.getNowMinute());
  private readonly nowTimer = setInterval(() =>
    this.currentMinute.set(this.getNowMinute()), 60_000
  );

  /** True when selected date is today.
   *  Using local time to properly check boundaries */
  readonly showNowLine = computed(() => {
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return this.selectedDate() === todayKey;
  });

  private getNowMinute(): number {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }

  ngOnDestroy(): void { clearInterval(this.nowTimer); }

  /** Optional date from route, e.g. /calendar/2026-03-01 */
  readonly date = input<string>();

  readonly selectedDate = computed(() => {
    const routeDate = this.date();
    if (routeDate) return routeDate;
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  });

  /** Day-of-week name for the selected date, e.g. 'Wednesday' */
  readonly selectedDayOfWeek = computed(() => {
    const d = new Date(this.selectedDate() + 'T00:00:00');
    return d.toLocaleDateString('en-IE', { weekday: 'long' });
  });

  readonly allEvents = toSignal(
    toObservable(this.selectedDate).pipe(
      switchMap((dateKey: string) => this.envRepo.getEventsByDate(dateKey))
    ),
    { initialValue: [] as EnvironmentalEvent[] }
  );

  // ── Hour ticks (0–23) ─────────────────────────────────────────────────────
  readonly hours = Array.from({ length: 24 }, (_, i) => i);

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Timestamp → minute of day (0–1439), used as left-px position */
  minuteOfDay(timestamp: Timestamp): number {
    const d = timestamp.toDate();
    return d.getHours() * 60 + d.getMinutes();
  }

  formatTime(timestamp: Timestamp): string {
    const d = timestamp.toDate();
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  }

  /** Format a raw minute-of-day integer as 'HH:mm'. E.g. 387 → '06:27' */
  minuteToHHmm(min: number): string {
    return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  }

  /**
   * Returns a CSS calc() string for the now-line's left position.
   *
   * WHY: The now-line sits inside .lc-inner (width: 100%), but the time ticks
   * and row-bodies use .lc-time-ticks / .lc-row-body (flex:1 = innerWidth - labelW).
   * A plain percentage would be off by the fraction of the label.
   *
   * Formula: labelW + minute/1440*(innerW - labelW)
   *   = labelW + minute*(innerW/1440) - minute*(labelW/1440)
   *   = calc(var(--label-w) + {minute/14.4}% - {minute*90/1440}px)
   *   = calc(var(--label-w) + {minute/14.4}% - {minute/16}px)
   */
  nowLineLeft(): string {
    const min = this.currentMinute();
    // 90/1440 = 1/16 — label fraction that must be subtracted from the raw %
    return `calc(var(--label-w) + ${(min / 14.4).toFixed(3)}% - ${(min / 16).toFixed(2)}px)`;
  }

  // ── Tide event streams ────────────────────────────────────────────────────

  readonly limerickTideEvents = computed(() =>
    this.allEvents()
      .filter((e: EnvironmentalEvent) => e.port === 'limerick')
      .sort((a, b) => a.timestamp.toMillis() - b.timestamp.toMillis())
  );

  readonly foynesTideEvents = computed(() =>
    this.allEvents()
      .filter((e: EnvironmentalEvent) => e.port === 'foynes' && (e.type === 'high' || e.type === 'low'))
      .sort((a, b) => a.timestamp.toMillis() - b.timestamp.toMillis())
  );

  readonly tarbertTideEvents = computed(() =>
    this.allEvents()
      .filter((e: EnvironmentalEvent) => e.port === 'tarbert' && (e.type === 'high' || e.type === 'low'))
      .sort((a, b) => a.timestamp.toMillis() - b.timestamp.toMillis())
  );

  /**
   * Generates SVG path data for the Tarbert tide curve.
   * X-axis = Time (0 → 1440px)
   * Y-axis = Height (0 → 100 on the viewBox, inverted so 0 is top)
   */
  readonly tarbertPath = computed((): { stroke: string; fill: string } | null => {
    const tidePoints = this.tarbertTideEvents().filter(e => e.type === 'high' || e.type === 'low');
    if (tidePoints.length < 2) return null;

    const MAX_HEIGHT = 6.5;
    const CHART_HEIGHT = 90; // within viewBox height of 100

    // For landscape: x = minute, y = inverted height
    const events = tidePoints.map(e => ({
      x:      this.minuteOfDay(e.timestamp),
      height: e.height,
      isHigh: e.type === 'high',
      y:      100 - Math.round((e.height / MAX_HEIGHT) * CHART_HEIGHT)
    }));

    const startHeight = this.extrapolateByRuleOf12s(0,    events);
    const endHeight   = this.extrapolateByRuleOf12s(1440, events);

    const startY = 100 - Math.round((startHeight / MAX_HEIGHT) * CHART_HEIGHT);
    const endY   = 100 - Math.round((endHeight   / MAX_HEIGHT) * CHART_HEIGHT);

    const pts = [
      { x: 0,    y: startY },
      ...events.map(e => ({ x: e.x, y: e.y })),
      { x: 1440, y: endY }
    ];

    const strokePath = this.buildSmoothPath(pts);
    const fillPath   = strokePath + ` L 1440 100 L 0 100 Z`; // close path at bottom of svg

    return { stroke: strokePath, fill: fillPath };
  });

  private extrapolateByRuleOf12s(
    targetMinute: 0 | 1440,
    events: { x: number; height: number; isHigh: boolean }[]
  ): number {
    const eA = targetMinute === 0 ? events[0] : events[events.length - 1];
    const eB = targetMinute === 0 ? events[1] : events[events.length - 2];

    const halfCycleDuration = Math.abs(eA.x - eB.x);
    const range             = Math.abs(eA.height - eB.height);
    const minutesFromAToMidnight = Math.abs(eA.x - targetMinute);
    const phase = Math.min(minutesFromAToMidnight / halfCycleDuration, 1);
    const heightFrac = this.ruleOf12sFraction(phase);

    return eA.isHigh
      ? eA.height - heightFrac * range
      : eA.height + heightFrac * range;
  }

  private ruleOf12sFraction(phase: number): number {
    const PHASES = [0, 1/6, 2/6, 3/6, 4/6, 5/6, 1];
    const FRACS  = [0, 1/12, 3/12, 6/12, 9/12, 11/12, 1];
    const p = Math.max(0, Math.min(1, phase));
    for (let i = 0; i < PHASES.length - 1; i++) {
      if (p <= PHASES[i + 1]) {
        const t = (p - PHASES[i]) / (PHASES[i + 1] - PHASES[i]);
        return FRACS[i] + t * (FRACS[i + 1] - FRACS[i]);
      }
    }
    return 1;
  }

  private buildSmoothPath(pts: { x: number; y: number }[]): string {
    if (pts.length < 2) return '';
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x} ${p2.y}`;
    }
    return d;
  }

  readonly solarEvents = computed(() =>
    this.allEvents().filter((e: EnvironmentalEvent) => e.port === 'solar')
  );

  readonly solarBounds = computed(() => {
    const solar = this.solarEvents();
    if (!solar.length) return { hasSolarData: false, dawnMin: 0, duskMin: 1440 };
    const sorted = [...solar].sort((a, b) => a.timestamp.toMillis() - b.timestamp.toMillis());
    const dawn = sorted.find(e => e.type === 'dawn') ?? sorted[0];
    const dusk = sorted.find(e => e.type === 'dusk') ?? sorted[sorted.length - 1];
    return { hasSolarData: true, dawnMin: this.minuteOfDay(dawn.timestamp), duskMin: this.minuteOfDay(dusk.timestamp) };
  });

  readonly aughinishWindows = computed(() => {
    const all = this.allEvents();
    const floods = all.filter(e => e.type === 'flood_start_augh').sort((a,b) => a.timestamp.toMillis()-b.timestamp.toMillis());
    const xovers = all.filter(e => e.type === 'last_xover_augh').sort((a,b) => a.timestamp.toMillis()-b.timestamp.toMillis());
    const pairs: { floodMin: number | null; xoverMin: number | null; bandLeft: number; bandWidth: number }[] = [];
    let fi=0, xi=0;
    const firstFloodMs = floods[0]?.timestamp.toMillis() ?? Infinity;
    while (xi < xovers.length && xovers[xi].timestamp.toMillis() < firstFloodMs) {
      const xMin = this.minuteOfDay(xovers[xi++].timestamp);
      pairs.push({ floodMin: null, xoverMin: xMin, bandLeft: 0, bandWidth: xMin });
    }
    while (fi < floods.length) {
      const flood = floods[fi++];
      const xover = xovers[xi] ?? null;
      if (xover) xi++;
      const fMin = this.minuteOfDay(flood.timestamp);
      const xMin = xover ? this.minuteOfDay(xover.timestamp) : 1440;
      pairs.push({ floodMin: fMin, xoverMin: xMin, bandLeft: fMin, bandWidth: xMin - fMin });
    }
    return pairs;
  });

  // ── Ship Markers ──────────────────────────────────────────────────────────

  readonly calendarShipMarkers = computed(() => {
    const dateKey = this.selectedDate();
    const ships   = this.riverState.activeShipsWithTrips();

    const toRow = (port: string | null | undefined): 'limerick' | 'foynes' | 'aughinish' | null => {
      if (!port) return null;
      if (['Foynes', 'Moneypoint', 'Tarbert', 'Cappa'].includes(port))  return 'foynes';
      if (['Aughinish'].includes(port))                                  return 'aughinish';
      if (['Limerick', 'Shannon'].includes(port))                        return 'limerick';
      return null;
    };

    const toDateKey = (ts: Timestamp | Date | string | null | undefined): string | null => {
      if (!ts) return null;
      // Using local time to properly map the correct day boundary
      const d = ts instanceof Timestamp ? ts.toDate() : new Date(ts);
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    };

    type Marker = {
      visitId: string; shipName: string; gt: number; status: VisitStatus;
      markerType: 'ETA' | 'ETB' | 'ETS';
      /** left position in px (= minute of day) */
      leftPx: number;
      markerTime: string;
      pilotName: string | null;
      portName: string | null;
      row: 'limerick' | 'foynes' | 'aughinish';
      /** stagger px if two markers share the same minute */
      offsetTop: number;
    };

    const raw: Marker[] = [];

    for (const ship of ships) {
      // The visit-level berthPort is the fallback row.  Individual trips carry
      // their own port (inward → destination berth; outward → origin berth)
      // which is more accurate — use it when available so a ship whose
      // outward movement is from Foynes doesn't end up in the Aughinish row.
      const visitRow = toRow(ship.berthPort);

      // Helper: push one marker.  rowOverride lets ETB/ETS use the trip's port.
      const push = (
        ts: Timestamp,
        type: 'ETA' | 'ETB' | 'ETS',
        pilot: string | null,
        portName: string | null,
        rowOverride?: 'limerick' | 'foynes' | 'aughinish' | null
      ) => {
        if (toDateKey(ts) !== dateKey) return;
        const effectiveRow = rowOverride ?? visitRow;
        if (!effectiveRow) return;  // no row = skip entirely
        const min = this.minuteOfDay(ts);
        raw.push({
          visitId: ship.id!, shipName: ship.shipName, gt: ship.grossTonnage,
          status: ship.currentStatus as VisitStatus,
          markerType: type, leftPx: min,
          markerTime: `${String(Math.floor(min/60)).padStart(2,'0')}:${String(min%60).padStart(2,'0')}`,
          // WHY || null: pilot can be an empty string '' in Firestore.
          // ?? null only catches null/undefined; || null also catches '',
          // so the template @if (m.pilotName) correctly hides blank names.
          pilotName: pilot || null,
          portName,
          row: effectiveRow, offsetTop: 0
        });
      };

      if (ship.initialEta) {
        // ETA: no trip yet, use visit-level data
        push(ship.initialEta, 'ETA', ship.inwardPilot || null, ship.berthPort ?? null);
      }
      if (ship.inwardTrip?.boarding) {
        // ETB: use the inward trip's own port for row placement
        const inPort = ship.inwardTrip.port ?? ship.berthPort ?? null;
        // Fallback to visit's inwardPilot if the trip's pilot string is empty
        const etbPilot = ship.inwardTrip.pilot || ship.inwardPilot || null;
        push(ship.inwardTrip.boarding, 'ETB', etbPilot, inPort, toRow(inPort));
      }
      if (ship.outwardTrip?.boarding) {
        // ETS: use the outward trip's own port — this is the berth the pilot
        // boards from, which may differ from the visit's berthPort
        const outPort = ship.outwardTrip.port ?? ship.berthPort ?? null;
        push(ship.outwardTrip.boarding, 'ETS', ship.outwardTrip.pilot || null, outPort, toRow(outPort));
      }
    }

    // Vertical band per marker type — ETA at top, ETB in middle, ETS at bottom.
    // Extremely tight base spacing to ensure clusters fit perfectly into laptop layouts 
    // without intruding vertically into the row below.
    const TYPE_BASE: Record<'ETA'|'ETB'|'ETS', number> = { ETA: 2, ETB: 45, ETS: 90 };
    const seen = new Map<string, number>();
    for (const m of raw) {
      const key = `${m.row}:${m.markerType}:${m.leftPx}`;
      const count = seen.get(key) ?? 0;
      m.offsetTop = TYPE_BASE[m.markerType] + count * 25;
      seen.set(key, count + 1);
    }

    return raw;
  });

  readonly limerickMarkers  = computed(() => this.calendarShipMarkers().filter(m => m.row === 'limerick'));
  readonly foynesMarkers    = computed(() => this.calendarShipMarkers().filter(m => m.row === 'foynes'));
  readonly aughinishMarkers = computed(() => this.calendarShipMarkers().filter(m => m.row === 'aughinish'));

  shipStatusClass(status: VisitStatus): string {
    const map: Record<string, string> = {
      'Due': 'marker-due', 'Awaiting Berth': 'marker-awaiting-berth', 'Alongside': 'marker-alongside'
    };
    return map[status] ?? 'marker-due';
  }

  limerickEventLabel(event: EnvironmentalEvent): string {
    switch (event.type) {
      case 'boarding_limerick': return 'Bdg Lim';
      case 'airport_boarding':  return 'Bdg Air';
      case 'standby_airport':   return 'St-By';
      case 'high': return `HW (${event.height}m)`;
      case 'low':  return `LW (${event.height}m)`;
      default: return event.type;
    }
  }

  foynesEventLabel(event: EnvironmentalEvent): string {
    switch (event.type) {
      case 'high': return `HW (${event.height}m)`;
      case 'low':  return `LW (${event.height}m)`;
      default: return event.type;
    }
  }

  onDateChange(event: Event) {
    const newDate = (event.target as HTMLInputElement).value;
    if (newDate) this.router.navigate(['/calendar', newDate]);
  }

  changeDay(offset: 1 | -1) {
    const current = new Date(this.selectedDate() + 'T00:00:00');
    current.setDate(current.getDate() + offset);
    const y = current.getFullYear();
    const m = String(current.getMonth() + 1).padStart(2, '0');
    const d = String(current.getDate()).padStart(2, '0');
    this.router.navigate(['/calendar', `${y}-${m}-${d}`]);
  }
}
