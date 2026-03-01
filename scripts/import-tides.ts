import * as admin from 'firebase-admin';
import * as fs from 'fs';
import { parse } from 'csv-parse';
import * as path from 'path';

// --- Configuration ---
// Make sure to set GOOGLE_APPLICATION_CREDENTIALS in your environment
// or explicitly initialize with the service account path if running locally.
const serviceAccountPath: string = path.join(__dirname, '../service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(require(serviceAccountPath))
});

const db: admin.firestore.Firestore = admin.firestore();

// --- Types ---
interface TideData {
  time: admin.firestore.Timestamp;
  height: number;
  type: 'high' | 'low';
}

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

// --- Helper Functions ---

/**
 * Converts a DD/MM/YY string to YYYY-MM-DD format.
 */
function parseDateString(dateStr: string): string {
  const parts: string[] = dateStr.split('/');
  if (parts.length !== 3) {
    throw new Error(`Invalid date format: ${dateStr}`);
  }
  const day: string = parts[0].padStart(2, '0');
  const month: string = parts[1].padStart(2, '0');
  let yearStr: string = parts[2];
  
  // Handle 2-digit years (assuming 2000+)
  if (yearStr.length === 2) {
    yearStr = `20${yearStr}`;
  }
  
  return `${yearStr}-${month}-${day}`;
}

/**
 * Creates a Firestore Timestamp from a date string (YYYY-MM-DD) and time string (HH:MM).
 */
function createTimestamp(dateStr: string, timeStr: string): admin.firestore.Timestamp {
  // Ensure time string is padded correctly (e.g. 3:21 -> 03:21)
  const timeParts: string[] = timeStr.split(':');
  const hours: string = timeParts[0].padStart(2, '0');
  const minutes: string = timeParts[1].padStart(2, '0');
  
  // Parsing as ISO string to ensure accurate time representation (we assume UTC/local alignment for the domain logic)
  const isoString: string = `${dateStr}T${hours}:${minutes}:00Z`;
  const dateObj: Date = new Date(isoString);
  return admin.firestore.Timestamp.fromDate(dateObj);
}

/**
 * Parses 4 slots of tide data to determine high/low based on adjacent heights.
 */
function parseStandardTides(dateStr: string, rawSlots: { timeStr: string, heightStr: string }[]): TideData[] {
  const result: TideData[] = [];
  
  // First, map to raw values
  const parsedSlots: { timeStr: string, height: number }[] = rawSlots
    .filter(slot => slot.timeStr && slot.timeStr.trim() !== '' && slot.heightStr && slot.heightStr.trim() !== '')
    .map(slot => ({
      timeStr: slot.timeStr.trim(),
      height: parseFloat(slot.heightStr.trim())
    }));

  // Compare adjacent to find 'high' or 'low'
  for (let i = 0; i < parsedSlots.length; i++) {
    let type: 'high' | 'low';
    
    if (i === 0) {
      // Compare with next
      type = (parsedSlots.length > 1 && parsedSlots[i].height > parsedSlots[i+1].height) ? 'high' : 'low';
    } else {
      // Compare with previous
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

// --- Main Execution ---

async function runImport(): Promise<void> {
  const csvFilePath: string = path.join(__dirname, '../Office Tide 26 - Sheet1.csv');
  
  const records: any[] = [];
  
  // Create read stream and parse
  const parser = fs.createReadStream(csvFilePath).pipe(
    parse({
      // We don't use the first row as columns because headers span multiple lines
      // and are extremely misaligned in this specific CSV. Working by index is safer.
      from_line: 2, 
      relax_column_count: true,
      skip_empty_lines: true
    })
  );

  for await (const row of parser) {
    if (!row[0] || row[0].trim() === '' || row[0].includes('Date') || row[0].includes('Month')) {
      continue; // Skip any empty or stray header rows mid-file
    }

    try {
      const rawDate: string = row[0].trim();
      const documentId: string = parseDateString(rawDate);
      
      const dawnTimeStr: string = row[34]?.trim();
      const duskTimeStr: string = row[35]?.trim();
      
      // Extract Tarbert (indices 3,4 | 5,6 | 7,8 | 9,10)
      const tarbertSlots = [
        { timeStr: row[3], heightStr: row[4] },
        { timeStr: row[5], heightStr: row[6] },
        { timeStr: row[7], heightStr: row[8] },
        { timeStr: row[9], heightStr: row[10] }
      ];
      
      // Extract Foynes (indices 15,16 | 17,18 | 19,20 | 21,22)
      const foynesSlots = [
        { timeStr: row[15], heightStr: row[16] },
        { timeStr: row[17], heightStr: row[18] },
        { timeStr: row[19], heightStr: row[20] },
        { timeStr: row[21], heightStr: row[22] }
      ];

      // Extract Limerick (indices 28,29 | 30,31)
      const limerickRaw = [
        { timeStr: row[28], heightStr: row[29] },
        { timeStr: row[30], heightStr: row[31] }
      ];
      
      const limerickTides: TideData[] = limerickRaw
        .filter(slot => slot.timeStr && slot.timeStr.trim() !== '' && slot.heightStr && slot.heightStr.trim() !== '')
        .map(slot => ({
          time: createTimestamp(documentId, slot.timeStr.trim()),
          height: parseFloat(slot.heightStr.trim()),
          type: 'high' // Limerick is explicitly always High Water
        }));

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
    } catch (error) {
      console.warn(`Skipping row due to formatting error: ${row[0]}`, error);
    }
  }

  // Bulk commit to Firestore
  console.log(`Prepared ${records.length} records. Uploading...`);
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
    console.log(`Batch ${i + 1}/${batchArray.length} committed successfully.`);
  }

  console.log('Import completed!');
}

runImport().catch(console.error);
