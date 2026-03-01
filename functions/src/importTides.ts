import * as admin from 'firebase-admin';
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { parse } from 'csv-parse/sync';

/**
 * Interface representing tide data in Firestore.
 */
interface TideData {
  time: admin.firestore.Timestamp;
  height: number;
  type: 'high' | 'low';
}

/**
 * Interface representing the daily environmental data document.
 */
interface EnvironmentalData {
  date: string;
  dawn: admin.firestore.Timestamp;
  dusk: admin.firestore.Timestamp;
  tides: {
    tarbert: TideData[];
    foynes: TideData[];
    limerick: TideData[];
  };
}

/**
 * Converts a DD/MM/YY string from the CSV to YYYY-MM-DD format for the Document ID.
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
 * Merges the Date string and the Time string to create a Firestore Timestamp.
 * Uses ISO format to guarantee strict parsing.
 */
function createTimestamp(dateStr: string, timeStr: string): admin.firestore.Timestamp {
  const timeParts: string[] = timeStr.includes(':') ? timeStr.split(':') : ['00', '00'];
  const hours: string = (timeParts[0] || '0').trim().padStart(2, '0');
  const minutes: string = (timeParts[1] || '0').trim().padStart(2, '0');
  
  const isoString: string = `${dateStr}T${hours}:${minutes}:00Z`;
  const dateObj: Date = new Date(isoString);
  return admin.firestore.Timestamp.fromDate(dateObj);
}

/**
 * Parses 4 slots of tide data to determine high/low based on adjacent heights.
 * Follows the rule: if height A > height B, Tide A is high.
 */
function parseStandardTides(dateStr: string, rawSlots: { timeStr: string, heightStr: string }[]): TideData[] {
  const result: TideData[] = [];
  
  const parsedSlots = rawSlots
    .filter(slot => slot.timeStr && slot.timeStr.trim() !== '' && slot.timeStr.includes(':') && slot.heightStr && slot.heightStr.trim() !== '')
    .map(slot => ({
      timeStr: slot.timeStr.trim(),
      height: parseFloat(slot.heightStr.trim())
    }));

  for (let i = 0; i < parsedSlots.length; i++) {
    let type: 'high' | 'low';
    
    // Determine tide type by comparing with adjacent records
    if (i === 0) {
      type = (parsedSlots.length > 1 && parsedSlots[i].height > parsedSlots[i+1].height) ? 'high' : 'low';
    } else {
      type = (parsedSlots[i].height > parsedSlots[i-1].height) ? 'high' : 'low';
    }

    result.push({
      time: createTimestamp(dateStr, parsedSlots[i].timeStr),
      height: parsedSlots[i].height,
      type: type
    });
  }
  
  return result;
}

/**
 * Callable Cloud Function to import tide data from a raw CSV string.
 * Restricted to admins.
 */
export const importTides = onCall({ cors: true, region: "europe-west1" }, async (request) => {
  // 1. Security Check: Only admins can perform this bulk operation
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be logged in.');
  }

  const callerUid = request.auth.uid;
  const db = admin.firestore();
  
  const userDoc = await db.collection('users').doc(callerUid).get();
  if (!userDoc.exists || userDoc.data()?.userType !== 'admin') {
     throw new HttpsError('permission-denied', 'Only admins can import tide data.');
  }

  const csvString = request.data?.csvString;
  if (!csvString || typeof csvString !== 'string') {
    throw new HttpsError('invalid-argument', 'A valid CSV string is required.');
  }

  try {
    // 2. Parse the CSV String using async sync API suited for Cloud Functions memory limits with small files
    const rows: string[][] = parse(csvString, {
      from_line: 2, // Skip messy headers 
      relax_column_count: true,
      skip_empty_lines: true
    });

    const records: EnvironmentalData[] = [];

    // 3. Map Data
    for (const row of rows) {
      // Basic validation to skip empty trailing lines or intra-file headers
      if (!row[0] || row[0].trim() === '' || row[0].includes('Date') || row[0].includes('Month') || row[0].includes('Date,')) {
        continue; 
      }

      const rawDate: string = row[0].trim();
      const documentId: string = parseDateString(rawDate);
      
      const dawnTimeStr: string = row[34]?.trim();
      const duskTimeStr: string = row[35]?.trim();
      
      // Mapped firmly by column index to dodge typo'd headers
      const tarbertSlots = [
        { timeStr: row[3], heightStr: row[4] },
        { timeStr: row[5], heightStr: row[6] },
        { timeStr: row[7], heightStr: row[8] },
        { timeStr: row[9], heightStr: row[10] }
      ];
      
      const foynesSlots = [
        { timeStr: row[15], heightStr: row[16] },
        { timeStr: row[17], heightStr: row[18] },
        { timeStr: row[19], heightStr: row[20] },
        { timeStr: row[21], heightStr: row[22] }
      ];

      const limerickRaw = [
        { timeStr: row[28], heightStr: row[29] },
        { timeStr: row[30], heightStr: row[31] }
      ];
      
      const limerickTides: TideData[] = limerickRaw
        .filter(slot => slot.timeStr && slot.timeStr.trim() !== '' && slot.timeStr.includes(':') && slot.heightStr && slot.heightStr.trim() !== '')
        .map(slot => ({
          time: createTimestamp(documentId, slot.timeStr.trim()),
          height: parseFloat(slot.heightStr.trim()),
          type: 'high' // Limerick is always High Water in this dataset
        }));

      // Ensure dawn/dusk are present and valid
      if (!dawnTimeStr || !dawnTimeStr.includes(':') || !duskTimeStr || !duskTimeStr.includes(':')) {
          logger.warn(`Missing or invalid dawn/dusk times for date ${documentId}. Skipping.`);
          continue;
      }

      const documentData: EnvironmentalData = {
        date: documentId,
        dawn: createTimestamp(documentId, dawnTimeStr),
        dusk: createTimestamp(documentId, duskTimeStr),
        tides: {
          tarbert: parseStandardTides(documentId, tarbertSlots),
          foynes: parseStandardTides(documentId, foynesSlots),
          limerick: limerickTides
        }
      };

      records.push(documentData);
    }

    logger.info(`Successfully parsed ${records.length} tide records. Starting batch upload.`);

    // 4. Batch Upload to Firestore (500 limit)
    const batchArray: admin.firestore.WriteBatch[] = [];
    let currentBatch: admin.firestore.WriteBatch = db.batch();
    let operationCount: number = 0;

    for (const record of records) {
      const docRef: admin.firestore.DocumentReference = db.collection('environmental_data').doc(record.date);
      currentBatch.set(docRef, record);
      operationCount++;

      if (operationCount === 500) {
        batchArray.push(currentBatch);
        currentBatch = db.batch();
        operationCount = 0;
      }
    }

    if (operationCount > 0) {
      batchArray.push(currentBatch);
    }

    for (let i = 0; i < batchArray.length; i++) {
      await batchArray[i].commit();
    }

    return { 
        success: true, 
        message: `Successfully imported ${records.length} days of environmental data.`,
        recordsImported: records.length
    };

  } catch (error: any) {
    logger.error('Error processing tide CSV', error);
    throw new HttpsError('internal', `Failed to process tide data: ${error.message}`);
  }
});
