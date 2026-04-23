import * as admin from 'firebase-admin';
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { parse } from 'csv-parse/sync';
import * as moment from 'moment-timezone';

// =============================================================================
// INTERFACES
// =============================================================================

/**
 * Represents a single atomic environmental event in Firestore.
 *
 * WHY ATOMIC?
 * The old model crammed all tides into one "daily" document, making queries
 * like "give me all high tides > 4m at Foynes this month" impossible without
 * pulling entire documents. Each event is now its own document, individually
 * queryable and indexable by `timestamp`.
 */
interface EnvironmentalEvent {
  timestamp: admin.firestore.Timestamp;
  port: string;          // 'foynes' | 'tarbert' | 'limerick' | 'solar'
  type: string;          // 'high' | 'low' | 'boarding_limerick' | 'airport_boarding' | 'standby_airport' | 'flood_start_augh' | 'last_xover_augh'
  height: number;
  range: number | null;  // Height difference from the immediately preceding tide at that port (Foynes only)
  dateKey: string;       // 'YYYY-MM-DD' for UI grouping — derived from the *computed* timestamp, not the CSV date
}

/**
 * Intermediate representation of a single parsed tide slot from the CSV,
 * before it becomes a full EnvironmentalEvent.
 */
interface ParsedSlot {
  timeStr: string;
  height: number;
}

/**
 * The shape of data returned by the Cloud Function.
 * Matches what the front-end admin.component.ts expects (result.data.message).
 */
interface ImportResult {
  success: boolean;
  message: string;
  eventsCreated: number;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Converts a DD/MM/YY string from the CSV to YYYY-MM-DD format.
 *
 * WHY NOT Date.parse()?
 * European date formats (DD/MM) are ambiguous to JS's Date parser, which
 * defaults to MM/DD. We manually construct the ISO string to avoid this trap.
 */
function parseDateString(dateStr: string): string {
  const parts: string[] = dateStr.split('/');
  if (parts.length !== 3) {
    throw new Error(`Invalid date format: ${dateStr}`);
  }
  const day: string = parts[0].padStart(2, '0');
  const month: string = parts[1].padStart(2, '0');
  let yearStr: string = parts[2];

  if (yearStr.length === 2) {
    yearStr = `20${yearStr}`;
  }

  return `${yearStr}-${month}-${day}`;
}

/**
 * Merges a YYYY-MM-DD date string and an HH:MM time string into a
 * Firestore Timestamp. Parses the time in the Europe/Dublin timezone
 * to properly handle local Irish daylight savings time.
 */
function createTimestamp(dateStr: string, timeStr: string): admin.firestore.Timestamp {
  const timeParts: string[] = timeStr.includes(':') ? timeStr.split(':') : ['00', '00'];
  const hours: string = (timeParts[0] || '0').trim().padStart(2, '0');
  const minutes: string = (timeParts[1] || '0').trim().padStart(2, '0');

  // Parse specifically in Europe/Dublin strictly matching the format
  const dateObj: Date = moment.tz(`${dateStr} ${hours}:${minutes}`, "YYYY-MM-DD HH:mm", "Europe/Dublin").toDate();
  return admin.firestore.Timestamp.fromDate(dateObj);
}

/**
 * THE 3-METRE RULE
 *
 * This is the core classification logic that replaces the old "compare with
 * adjacent heights" approach. The rule is simple and deterministic:
 *   >= 3.0m → high tide
 *   <  3.0m → low tide
 */
function classifyTide(height: number): 'high' | 'low' {
  return height >= 3.0 ? 'high' : 'low';
}

/**
 * Creates a deterministic document ID to prevent duplicates across re-imports.
 *
 * Format: port_type_timestampISO
 * Example: foynes_high_2026-03-15T14:30:00.000Z
 *
 * WHY DETERMINISTIC IDs?
 * If someone uploads the same CSV twice, Firestore's set() will overwrite
 * the existing document with identical data instead of creating a duplicate.
 * This makes the import operation safely idempotent.
 */
function buildDeterministicId(port: string, type: string, timestamp: admin.firestore.Timestamp): string {
  return `${port}_${type}_${timestamp.toDate().toISOString()}`;
}

/**
 * Derives the YYYY-MM-DD dateKey from a JS Date object.
 *
 * DATE SAFETY: This uses the *computed* Date object, not the CSV's row date.
 * When you subtract 4.5 hours from a HW at 02:00, the result (21:30 the
 * previous day) correctly gets yesterday's dateKey in local Irish time.
 */
function deriveDateKey(date: Date): string {
  return moment.tz(date, "Europe/Dublin").format("YYYY-MM-DD");
}

/**
 * Extracts a typed error message from an unknown catch value.
 *
 * WHY NOT `catch (error: any)`?
 * TypeScript strict mode discourages `any`. The `unknown` type forces us to
 * narrow the type before accessing properties, which prevents runtime
 * surprises if the thrown value isn't actually an Error object.
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Filters raw CSV slots into validated ParsedSlot objects.
 * Skips slots with missing/blank time or height data.
 */
function parseRawSlots(rawSlots: { timeStr: string | undefined; heightStr: string | undefined }[]): ParsedSlot[] {
  return rawSlots
    .filter((slot): slot is { timeStr: string; heightStr: string } =>
      slot.timeStr !== undefined &&
      slot.timeStr.trim() !== '' &&
      slot.timeStr.includes(':') &&
      slot.heightStr !== undefined &&
      slot.heightStr.trim() !== ''
    )
    .map(slot => ({
      timeStr: slot.timeStr.trim(),
      height: parseFloat(slot.heightStr.trim())
    }));
}

/**
 * Subtracts (or adds) a duration from a Firestore Timestamp and returns
 * a new Timestamp. Used for pilotage event calculations.
 *
 * @param base     - The reference timestamp (e.g. HW Limerick)
 * @param hours    - Hours to offset
 * @param minutes  - Minutes to offset
 * @param subtract - true to subtract, false to add
 */
function offsetTimestamp(
  base: admin.firestore.Timestamp,
  hours: number,
  minutes: number,
  subtract: boolean
): admin.firestore.Timestamp {
  const baseDate: Date = base.toDate();
  const offsetMs: number = (hours * 60 + minutes) * 60 * 1000;
  const resultDate: Date = new Date(
    subtract ? baseDate.getTime() - offsetMs : baseDate.getTime() + offsetMs
  );
  return admin.firestore.Timestamp.fromDate(resultDate);
}

// =============================================================================
// PILOTAGE EVENT GENERATORS
// =============================================================================

/**
 * Generates the automated pilotage events from a single CSV row's data.
 *
 * WHY ARRAYS FOR ALL THREE PARAMETERS?
 * Each day typically has TWO HW Limerick, TWO LW Tarbert, and TWO HW Foynes.
 * The original code only processed the first of each, silently dropping all
 * afternoon pilotage, flood-start, and last-xover times.
 * We now iterate over ALL events of each type to produce a complete set.
 *
 * @param hwLimerickList - All HW Limerick timestamps for this row
 * @param lwTarbertList  - All LW Tarbert timestamps for this row
 * @param hwFoynesList   - All HW Foynes timestamps for this row
 */
function generatePilotageEvents(
  hwLimerickList: admin.firestore.Timestamp[],
  lwTarbertList:  admin.firestore.Timestamp[],
  hwFoynesList:   admin.firestore.Timestamp[]
): EnvironmentalEvent[] {
  const events: EnvironmentalEvent[] = [];

  // --- Events derived from each HW Limerick ---
  for (const hwLimerick of hwLimerickList) {
    // 1. Boarding Limerick: HW Limerick − 04:30
    const boardingLimTs = offsetTimestamp(hwLimerick, 4, 30, true);
    events.push({ timestamp: boardingLimTs, port: 'limerick', type: 'boarding_limerick',
      height: 0, range: null, dateKey: deriveDateKey(boardingLimTs.toDate()) });

    // 2. Airport Boarding: HW Limerick − 03:45
    const airportBoardTs = offsetTimestamp(hwLimerick, 3, 45, true);
    events.push({ timestamp: airportBoardTs, port: 'limerick', type: 'airport_boarding',
      height: 0, range: null, dateKey: deriveDateKey(airportBoardTs.toDate()) });

    // 3. Stand-By Airport: HW Limerick − 01:20
    const standbyTs = offsetTimestamp(hwLimerick, 1, 20, true);
    events.push({ timestamp: standbyTs, port: 'limerick', type: 'standby_airport',
      height: 0, range: null, dateKey: deriveDateKey(standbyTs.toDate()) });
  }

  // --- Events derived from each LW Tarbert ---
  // One flood_start_augh per LW Tarbert (LW + 01:00)
  for (const lwTarbert of lwTarbertList) {
    const floodStartTs = offsetTimestamp(lwTarbert, 1, 0, false);
    events.push({ timestamp: floodStartTs, port: 'tarbert', type: 'flood_start_augh',
      height: 0, range: null, dateKey: deriveDateKey(floodStartTs.toDate()) });
  }

  // --- Events derived from each HW Foynes ---
  // One last_xover_augh per HW Foynes (HW − 01:30)
  for (const hwFoynes of hwFoynesList) {
    const lastXoverTs = offsetTimestamp(hwFoynes, 1, 30, true);
    events.push({ timestamp: lastXoverTs, port: 'foynes', type: 'last_xover_augh',
      height: 0, range: null, dateKey: deriveDateKey(lastXoverTs.toDate()) });
  }

  return events;
}

// =============================================================================
// MAIN CLOUD FUNCTION
// =============================================================================

/**
 * Callable Cloud Function to import tide data from a raw CSV string.
 *
 * WHAT CHANGED FROM THE OLD VERSION:
 * - Old: one document per day in `environmental_data` (nested arrays of tides)
 * - New: one document per event in `environmental_events` (flat, queryable)
 * - Classification: 3m rule replaces adjacent-height comparison
 * - Foynes range: stateful calculation seeded from Firestore
 * - Pilotage events: 5 derived events generated per CSV row
 * - IDs: deterministic (port_type_timestampISO) for idempotent re-imports
 */
export const importTides = onCall({ cors: true, region: "europe-west1" }, async (request) => {
  // 1. Security Check: Only admins can perform this bulk operation
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be logged in.');
  }

  const callerUid: string = request.auth.uid;
  const db: admin.firestore.Firestore = admin.firestore();

  const userDoc: admin.firestore.DocumentSnapshot = await db.collection('users').doc(callerUid).get();
  if (!userDoc.exists || userDoc.data()?.userType !== 'admin') {
    throw new HttpsError('permission-denied', 'Only admins can import tide data.');
  }

  const csvString: unknown = request.data?.csvString;
  if (!csvString || typeof csvString !== 'string') {
    throw new HttpsError('invalid-argument', 'A valid CSV string is required.');
  }

  try {
    // 2. Parse the CSV string
    const rows: string[][] = parse(csvString, {
      from_line: 2, // Skip messy headers
      relax_column_count: true,
      skip_empty_lines: true
    });

    // 3. Seed the Foynes range calculation from Firestore
    //
    // WHY QUERY FIRESTORE?
    // The range is the absolute difference between consecutive Foynes heights.
    // The first tide in a new CSV file needs to compare against the *last*
    // tide from the previous import. Without this seed, the first Foynes
    // event would have range: null even though data exists.
    let previousFoynesHeight: number | null = null;

    // TRY-CATCH for the seed query:
    // This query needs a composite index (port + type + timestamp). On the
    // very first deploy the index won't exist yet, which throws a
    // FAILED_PRECONDITION error. Falling back to null is safe because
    // there's no previous height to compare against on a fresh collection.
    try {
      const lastFoynesSnap: admin.firestore.QuerySnapshot = await db
        .collection('environmental_events')
        .where('port', '==', 'foynes')
        .where('type', 'in', ['high', 'low'])
        .orderBy('timestamp', 'desc')
        .limit(1)
        .get();

      if (!lastFoynesSnap.empty) {
        const lastDoc = lastFoynesSnap.docs[0].data() as EnvironmentalEvent;
        previousFoynesHeight = lastDoc.height;
        logger.info(`Seeded Foynes range from Firestore: previous height = ${previousFoynesHeight}m`);
      }
    } catch (seedError: unknown) {
      // Gracefully degrade — first Foynes tide will have range: null
      logger.warn('Could not seed Foynes range (index may not exist yet). First tide range will be null.', seedError);
    }

    // 4. Process each CSV row into atomic events
    const allEvents: { id: string; data: EnvironmentalEvent }[] = [];

    for (const row of rows) {
      // Skip empty trailing lines or intra-file headers
      if (!row[0] || row[0].trim() === '' || row[0].includes('Date') || row[0].includes('Month')) {
        continue;
      }

      const rawDate: string = row[0].trim();
      const dateKey: string = parseDateString(rawDate);

      // --- TARBERT: 4 tide slots (columns 3-10) ---
      const tarbertSlots: ParsedSlot[] = parseRawSlots([
        { timeStr: row[3], heightStr: row[4] },
        { timeStr: row[5], heightStr: row[6] },
        { timeStr: row[7], heightStr: row[8] },
        { timeStr: row[9], heightStr: row[10] }
      ]);

      // Collect ALL LW Tarbert timestamps — one flood_start_augh per LW
      const allLwTarbert: admin.firestore.Timestamp[] = [];

      for (const slot of tarbertSlots) {
        const type: 'high' | 'low' = classifyTide(slot.height);
        const ts: admin.firestore.Timestamp = createTimestamp(dateKey, slot.timeStr);
        const id: string = buildDeterministicId('tarbert', type, ts);

        if (type === 'low') {
          allLwTarbert.push(ts);
        }

        allEvents.push({
          id,
          data: {
            timestamp: ts,
            port: 'tarbert',
            type,
            height: slot.height,
            range: null,
            dateKey
          }
        });
      }

      // --- FOYNES: 4 tide slots (columns 15-22) ---
      const foynesSlots: ParsedSlot[] = parseRawSlots([
        { timeStr: row[15], heightStr: row[16] },
        { timeStr: row[17], heightStr: row[18] },
        { timeStr: row[19], heightStr: row[20] },
        { timeStr: row[21], heightStr: row[22] }
      ]);

      // Collect ALL HW Foynes timestamps — one last_xover_augh per HW
      const allHwFoynes: admin.firestore.Timestamp[] = [];

      for (const slot of foynesSlots) {
        const type: 'high' | 'low' = classifyTide(slot.height);
        const ts: admin.firestore.Timestamp = createTimestamp(dateKey, slot.timeStr);
        const id: string = buildDeterministicId('foynes', type, ts);

        if (type === 'high') {
          allHwFoynes.push(ts);
        }

        // STATEFUL RANGE CALCULATION
        let range: number | null = null;
        if (previousFoynesHeight !== null) {
          range = Math.round(Math.abs(slot.height - previousFoynesHeight) * 100) / 100;
        }
        previousFoynesHeight = slot.height;

        allEvents.push({
          id,
          data: {
            timestamp: ts,
            port: 'foynes',
            type,
            height: slot.height,
            range,
            dateKey
          }
        });
      }

      // --- LIMERICK: 2 HW-only slots (columns 28-31) ---
      //
      // LIMERICK EXCEPTION: The CSV only provides High Water readings for
      // Limerick (2 columns). We process them all and classify by the 3m
      // rule. "Ignore LW for Limerick" means we don't attempt to parse
      // non-existent LW columns.
      const limerickSlots: ParsedSlot[] = parseRawSlots([
        { timeStr: row[28], heightStr: row[29] },
        { timeStr: row[30], heightStr: row[31] }
      ]);

      // Track ALL HW Limerick timestamps for pilotage calculations.
      // WHY AN ARRAY? There are typically TWO HW events per day (morning + afternoon)
      // and each one needs its own Boarding Limerick / Airport / Stand-By times.
      const allHwLimerick: admin.firestore.Timestamp[] = [];

      for (const slot of limerickSlots) {
        const type: 'high' | 'low' = classifyTide(slot.height);
        const ts: admin.firestore.Timestamp = createTimestamp(dateKey, slot.timeStr);
        const id: string = buildDeterministicId('limerick', type, ts);

        // Collect every HW so pilotage events are generated for each
        if (type === 'high') {
          allHwLimerick.push(ts);
        }

        allEvents.push({
          id,
          data: {
            timestamp: ts,
            port: 'limerick',
            type,
            height: slot.height,
            range: null,   // Range is Foynes-only
            dateKey
          }
        });
      }

      // --- SOLAR EVENTS: Dawn and Dusk (columns 34 and 35) ---
      // Column 34: Begin Civil Twilight (Dawn)
      // Column 35: End Civil Twilight (Dusk)
      if (row[34] && row[34].trim().includes(':')) {
        const dawnTs = createTimestamp(dateKey, row[34].trim());
        const dawnId = buildDeterministicId('solar', 'dawn', dawnTs);
        allEvents.push({
          id: dawnId,
          data: {
            timestamp: dawnTs,
            port: 'solar',
            type: 'dawn',
            height: 0,
            range: null,
            dateKey
          }
        });
      }

      if (row[35] && row[35].trim().includes(':')) {
        const duskTs = createTimestamp(dateKey, row[35].trim());
        const duskId = buildDeterministicId('solar', 'dusk', duskTs);
        allEvents.push({
          id: duskId,
          data: {
            timestamp: duskTs,
            port: 'solar',
            type: 'dusk',
            height: 0,
            range: null,
            dateKey
          }
        });
      }

      const pilotageEvents: EnvironmentalEvent[] = generatePilotageEvents(
        allHwLimerick,
        allLwTarbert,
        allHwFoynes
      );

      for (const pe of pilotageEvents) {
        const id: string = buildDeterministicId(pe.port, pe.type, pe.timestamp);
        allEvents.push({ id, data: pe });
      }
    }

    logger.info(`Parsed ${allEvents.length} atomic events. Starting batch upload.`);

    // 5. Batch upload to Firestore (respecting the 500-operation limit)
    //
    // WHY 500?
    // Firestore's writeBatch has a hard limit of 500 operations per batch.
    // Exceeding this throws a runtime error. We track the count and start
    // a new batch when we hit the limit.
    const batchArray: admin.firestore.WriteBatch[] = [];
    let currentBatch: admin.firestore.WriteBatch = db.batch();
    let operationCount: number = 0;

    for (const event of allEvents) {
      const docRef: admin.firestore.DocumentReference = db
        .collection('environmental_events')
        .doc(event.id);

      currentBatch.set(docRef, event.data);
      operationCount++;

      if (operationCount === 500) {
        batchArray.push(currentBatch);
        currentBatch = db.batch();
        operationCount = 0;
      }
    }

    // Don't forget the final partial batch
    if (operationCount > 0) {
      batchArray.push(currentBatch);
    }

    // Commit all batches sequentially
    for (const batch of batchArray) {
      await batch.commit();
    }

    const result: ImportResult = {
      success: true,
      message: `Successfully imported ${allEvents.length} environmental events across ${batchArray.length} batch(es).`,
      eventsCreated: allEvents.length
    };

    logger.info(result.message);
    return result;

  } catch (error: unknown) {
    logger.error('Error processing tide CSV', error);
    throw new HttpsError('internal', `Failed to process tide data: ${getErrorMessage(error)}`);
  }
});
