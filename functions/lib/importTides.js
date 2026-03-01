"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.importTides = void 0;
const admin = require("firebase-admin");
const https_1 = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const sync_1 = require("csv-parse/sync");
/**
 * Converts a DD/MM/YY string from the CSV to YYYY-MM-DD format for the Document ID.
 */
function parseDateString(dateStr) {
    const parts = dateStr.split('/');
    if (parts.length !== 3) {
        throw new Error(`Invalid date format: ${dateStr}`);
    }
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    let yearStr = parts[2];
    if (yearStr.length === 2) {
        yearStr = `20${yearStr}`;
    }
    return `${yearStr}-${month}-${day}`;
}
/**
 * Merges the Date string and the Time string to create a Firestore Timestamp.
 * Uses ISO format to guarantee strict parsing.
 */
function createTimestamp(dateStr, timeStr) {
    const timeParts = timeStr.includes(':') ? timeStr.split(':') : ['00', '00'];
    const hours = (timeParts[0] || '0').trim().padStart(2, '0');
    const minutes = (timeParts[1] || '0').trim().padStart(2, '0');
    const isoString = `${dateStr}T${hours}:${minutes}:00Z`;
    const dateObj = new Date(isoString);
    return admin.firestore.Timestamp.fromDate(dateObj);
}
/**
 * Parses 4 slots of tide data to determine high/low based on adjacent heights.
 * Follows the rule: if height A > height B, Tide A is high.
 */
function parseStandardTides(dateStr, rawSlots) {
    const result = [];
    const parsedSlots = rawSlots
        .filter(slot => slot.timeStr && slot.timeStr.trim() !== '' && slot.timeStr.includes(':') && slot.heightStr && slot.heightStr.trim() !== '')
        .map(slot => ({
        timeStr: slot.timeStr.trim(),
        height: parseFloat(slot.heightStr.trim())
    }));
    for (let i = 0; i < parsedSlots.length; i++) {
        let type;
        // Determine tide type by comparing with adjacent records
        if (i === 0) {
            type = (parsedSlots.length > 1 && parsedSlots[i].height > parsedSlots[i + 1].height) ? 'high' : 'low';
        }
        else {
            type = (parsedSlots[i].height > parsedSlots[i - 1].height) ? 'high' : 'low';
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
exports.importTides = (0, https_1.onCall)({ cors: true, region: "europe-west1" }, async (request) => {
    var _a, _b, _c, _d;
    // 1. Security Check: Only admins can perform this bulk operation
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be logged in.');
    }
    const callerUid = request.auth.uid;
    const db = admin.firestore();
    const userDoc = await db.collection('users').doc(callerUid).get();
    if (!userDoc.exists || ((_a = userDoc.data()) === null || _a === void 0 ? void 0 : _a.userType) !== 'admin') {
        throw new https_1.HttpsError('permission-denied', 'Only admins can import tide data.');
    }
    const csvString = (_b = request.data) === null || _b === void 0 ? void 0 : _b.csvString;
    if (!csvString || typeof csvString !== 'string') {
        throw new https_1.HttpsError('invalid-argument', 'A valid CSV string is required.');
    }
    try {
        // 2. Parse the CSV String using async sync API suited for Cloud Functions memory limits with small files
        const rows = (0, sync_1.parse)(csvString, {
            from_line: 2, // Skip messy headers 
            relax_column_count: true,
            skip_empty_lines: true
        });
        const records = [];
        // 3. Map Data
        for (const row of rows) {
            // Basic validation to skip empty trailing lines or intra-file headers
            if (!row[0] || row[0].trim() === '' || row[0].includes('Date') || row[0].includes('Month') || row[0].includes('Date,')) {
                continue;
            }
            const rawDate = row[0].trim();
            const documentId = parseDateString(rawDate);
            const dawnTimeStr = (_c = row[34]) === null || _c === void 0 ? void 0 : _c.trim();
            const duskTimeStr = (_d = row[35]) === null || _d === void 0 ? void 0 : _d.trim();
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
            const limerickTides = limerickRaw
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
            const documentData = {
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
        const batchArray = [];
        let currentBatch = db.batch();
        let operationCount = 0;
        for (const record of records) {
            const docRef = db.collection('environmental_data').doc(record.date);
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
    }
    catch (error) {
        logger.error('Error processing tide CSV', error);
        throw new https_1.HttpsError('internal', `Failed to process tide data: ${error.message}`);
    }
});
//# sourceMappingURL=importTides.js.map