"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkShannonNight = exports.checkShannonDay = exports.onNewUserRegistration = exports.fetchDailyDiaryPdf = exports.fetchShipDetails = void 0;
const admin = require("firebase-admin");
const params_1 = require("firebase-functions/params");
const https_1 = require("firebase-functions/v2/https");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const v2_1 = require("firebase-functions/v2");
const firestore_1 = require("firebase-admin/firestore");
const functionsV1 = require("firebase-functions/v1"); // v1 for auth triggers
const nodemailer = require("nodemailer");
admin.initializeApp();
// Set global options for V2 functions
(0, v2_1.setGlobalOptions)({ maxInstances: 10 });
// Using OpenAI for reliable AI-powered ship lookups
const openaiApiKey = (0, params_1.defineSecret)("OPENAI_API_KEY");
exports.fetchShipDetails = (0, https_1.onCall)({ cors: true, region: "europe-west1", secrets: [openaiApiKey] }, async (request) => {
    // 1. Validate Input
    const imo = request.data.imo;
    if (!imo) {
        throw new https_1.HttpsError("invalid-argument", "The function must be called with an 'imo' argument.");
    }
    try {
        // 2. Construct Prompt with strict accuracy requirements
        const prompt = `You are a maritime data specialist. Look up information about the ship with IMO number ${imo}.

CRITICAL INSTRUCTIONS:
1. Consult multiple reputable maritime databases and sources (e.g., Equasis, IMO database, shipping registries)
2. Prioritize accuracy by comparing data from different sources and resolving discrepancies
3. If you cannot find reliable data for a field, use null instead of guessing
4. Cross-reference all information before providing it
5. Only provide information you are confident is accurate

Please provide the following details in JSON format:
- shipName: The current official registered name (null if uncertain)
- grossTonnage: The gross tonnage in metric tons (null if uncertain)
- summerDwt: The summer deadweight tonnage in metric tons (null if uncertain)
- buildLocation: The shipyard and country where built (null if uncertain)
- yearBuilt: The year the ship was built (null if uncertain)
- manager: The current manager or management company (null if uncertain)
- formerNames: Array of former names with years, or empty array if none known
- last4Ports: Array of last 4 ports visited, or empty array if unavailable
- nextPort: The next scheduled port, or null if unavailable
- eta: The estimated time of arrival at next port, or null if unavailable
- news: Brief factual summary of recent news (max 2 sentences), or null if none available

REMEMBER: It is better to return null than to provide inaccurate information.
Return ONLY a valid JSON object, no markdown formatting.`;
        // 3. Call OpenAI API
        const apiKey = openaiApiKey.value();
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: "gpt-5.1-chat-latest", // Latest GPT-5.1 model (Nov 2025)
                messages: [
                    {
                        role: "system",
                        content: "You are an expert maritime data specialist. Your primary goal is ACCURACY. Always consult multiple reliable maritime sources before providing information. If you are not confident about any data point, return null for that field rather than guessing. Never fabricate or hallucinate ship information."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ]
            })
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
        }
        const data = await response.json();
        const text = data.choices[0].message.content;
        // 4. Parse JSON
        // Clean up potential markdown code blocks
        const jsonString = text.replace(/```json/g, "").replace(/```/g, "").trim();
        const shipData = JSON.parse(jsonString);
        return shipData;
    }
    catch (error) {
        // Log the full error details to help with debugging
        console.error("Error fetching ship details:", {
            message: error === null || error === void 0 ? void 0 : error.message,
            stack: error === null || error === void 0 ? void 0 : error.stack,
            fullError: error
        });
        throw new https_1.HttpsError("internal", `Failed to fetch ship details from AI: ${(error === null || error === void 0 ? void 0 : error.message) || error}`);
    }
});
/**
 * Cloud Function to fetch and parse the daily diary PDF from CarGoPro.
 * Extracts raw text and uses OpenAI to structure the data into ship records.
 */
exports.fetchDailyDiaryPdf = (0, https_1.onCall)({
    cors: true,
    region: "europe-west1",
    secrets: [openaiApiKey],
    timeoutSeconds: 60,
    memory: "512MiB"
}, async (request) => {
    var _a;
    const db = admin.firestore();
    const metadataRef = db.doc("system_settings/shannon_diary_metadata");
    try {
        // STEP 0: Check and acquire processing lock + read current data for history
        const metadataDoc = await metadataRef.get();
        const metadata = metadataDoc.data();
        // Preserve current data before processing (for change detection)
        const previousShips = (metadata === null || metadata === void 0 ? void 0 : metadata.cached_ships) || [];
        const previousProcessed = (metadata === null || metadata === void 0 ? void 0 : metadata.last_processed) || null;
        // Check if already processing
        if (metadata === null || metadata === void 0 ? void 0 : metadata.processing) {
            const processingStarted = (_a = metadata.processing_started_at) === null || _a === void 0 ? void 0 : _a.toDate();
            const now = new Date();
            const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
            // If lock is stuck (>5 min), release it
            if (processingStarted && processingStarted < fiveMinutesAgo) {
                console.warn("Processing lock is stale (>5min), releasing...");
                await metadataRef.set({
                    processing: false,
                    processing_started_at: null
                }, { merge: true });
            }
            else {
                throw new https_1.HttpsError("resource-exhausted", "PDF is already being processed. Please try again in a minute.");
            }
        }
        // Acquire lock
        await metadataRef.set({
            processing: true,
            processing_started_at: firestore_1.FieldValue.serverTimestamp()
        }, { merge: true });
        console.log("Processing lock acquired");
        const pdfUrl = "http://www.cargopro.ie/sfpc/download/rpt_daydiary.pdf";
        console.log("Fetching PDF from:", pdfUrl);
        // Step 1: Fetch and parse PDF
        const axios = (await Promise.resolve().then(() => require("axios"))).default;
        const response = await axios.get(pdfUrl, {
            responseType: 'arraybuffer'
        });
        const pdfBuffer = Buffer.from(response.data);
        console.log(`PDF fetched successfully, size: ${pdfBuffer.length} bytes`);
        // Step 2: Extract raw text
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const pdf = require("pdf-parse-new");
        const pdfData = await pdf(pdfBuffer);
        const rawText = pdfData.text;
        console.log(`PDF parsed: ${rawText.length} chars, ${pdfData.numpages} pages`);
        // Step 3: Use OpenAI to extract structured ship data
        const openaiModule = await Promise.resolve().then(() => require("openai"));
        const OpenAI = openaiModule.default;
        const openai = new OpenAI({ apiKey: openaiApiKey.value() });
        const prompt = `Analyze this raw text from a Shannon Port "Day Diary" PDF.
It contains a table of ships with columns: Vessel Name, GT (Gross Tonnage), Port/Berth Code, and ETA.

Extract ALL ships and structure them as JSON.

**CRITICAL: Port/Berth Code Format Rules**

Port codes in this PDF ALWAYS follow this EXACT pattern:
- Format: ONE LETTER + EXACTLY TWO DIGITS
- Examples: A02, T15, F07, S01, M03, C12, L05

**What IS a port code:**
- A02 → Aughinish, berth 02
- F07 → Foynes, berth 07
- T15 → Tarbert, berth 15
- S01 → Shannon, berth 01

**What is NOT a port code (IGNORE these):**
- "MSt" → This is cargo/status, NOT a port (3 letters, no digits)
- "MT" → This is cargo/status, NOT a port (2 letters, no digits)  
- "TT" or "T" → This is tug designation, NOT a port (letters only)
- "Etc" → This is status marker, NOT a port (3 letters)
- Any text with 3+ letters → NOT a port code
- Any text without exactly 2 digits → NOT a port code

**Port Letter Mapping (first letter of the berth code):**
- A = Aughinish (e.g., A01, A02)
- C = Cappa (e.g., C12)
- M = Moneypoint (e.g., M03)
- T = Tarbert (e.g., T15)
- F = Foynes (e.g., F07, F03)
- S = Shannon (e.g., S01)
- L = Limerick (e.g., L05)

**Instructions:**
1. Scan the ship's row for ANY **standalone** text matching pattern: [LETTER][DIGIT][DIGIT]
   - The code MUST be separated by spaces (e.g., " F03 " or at end of line)
   - NEVER extract from within a longer word (e.g., "MCPORTS" contains "CPO" but is NOT a port)
   - **Word boundary check:** Look for the pattern surrounded by spaces or punctuation
2. Use ONLY the first letter to determine the port name
3. If you see "MSt", "MT", "TT", "Etc" or similar → IGNORE them, keep searching
4. If you find "F07" → Port is Foynes
5. If no valid [LETTER][DIGIT][DIGIT] pattern found → set port to null
6. **Disambiguation:** If multiple valid codes exist, prefer the one that appears AFTER status markers like "Etc" or time stamps

ETA Format Examples:
- "Eta 21/1150" = day 21 of current month, time 11:50
- "Eta 15/0830" = day 15, time 08:30
- "Etc04/Am 04/0515" = Estimated Time of COMPLETION (not arrival), day 4, time 05:15
- Extract ONLY if format matches "Eta DD/HHMM" for arrival times
- If you see "Etc" instead of "Eta", this is a completion time (ship already alongside)
- If no ETA found, set to null

Rules:
1. The "GT" is usually a 3-5 digit number (e.g., 4500, 15900).
2. Ignore small tugs (like "Celtic Rebel") unless they have a clear GT.
3. Port code MUST match [LETTER][DIGIT][DIGIT] format - ignore everything else.
4. ETA must be in format "Eta DD/HHMM" - extract day and time separately.
5. **IMPORTANT: Include ALL ships even if ETA is missing - just set etaDay and etaTime to null.**
6. **Notes Field:**
   - Extract ANY text between ship dimensions (draft/beam/length) and port code
   - This may include: "@ Anchor in after [ship]", "Eta DD/HHMM", "in after...", waiting indicators
   - Example: "@ Anchor in after Volgaborg" or "Eta 03/1200"
   - Set to null if no text found between dimensions and port code
6. **Status Indicators - Understanding Maritime Terminology:**
   - **"ETC"** = Estimated Time of Completion
     * Means the ship is ALREADY ALONGSIDE at berth
     * Actively loading/unloading cargo
     * The time given is when they expect to FINISH the job
     * → Set statusMarker to "etc"
   - **"ETA"** = Estimated Time of Arrival  
     * Means the ship is INBOUND (not yet at berth)
     * The time given is when they expect to ARRIVE
     * → This is the etaDay/etaTime fields
   - **"@ Anchor"** or **"@Anchor"**
     * Means the ship has arrived but is waiting for a berth
     * → Set statusMarker to "anchor"
   - **Otherwise** → set statusMarker to null

Output Schema:
{
  "ships": [
    { 
      "name": "SHIP NAME", 
      "gt": 12345, 
      "port": "Port Name",
      "etaDay": 21,
      "etaTime": "11:50",
      "statusMarker": "anchor" | "etc" | null,
      "notes": "@ Anchor in after Volgaborg" | "Eta 03/1200" | null
    }
  ]
}

RAW TEXT:
${rawText.substring(0, 20000)}`;
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
            temperature: 0
        });
        const cleanedData = JSON.parse(completion.choices[0].message.content || "{}");
        const rawShips = cleanedData.ships || [];
        // Process ETAs: convert day/time to proper Date format
        // Logic: if day has passed this month, assume next month
        const now = new Date();
        const currentDay = now.getDate();
        const currentMonth = now.getMonth(); // 0-based
        const currentYear = now.getFullYear();
        const shipsFound = rawShips.map((ship) => {
            let eta = null;
            let status;
            if (ship.etaDay && ship.etaTime) {
                // Determine which month this ETA is for
                const etaDay = parseInt(ship.etaDay, 10);
                // Validate etaDay
                if (isNaN(etaDay) || etaDay < 1 || etaDay > 31) {
                    console.warn(`Invalid ETA day for ship ${ship.name}: ${ship.etaDay}`);
                }
                else {
                    let etaMonth = currentMonth;
                    let etaYear = currentYear;
                    // If the day has already passed this month, assume next month
                    if (etaDay < currentDay) {
                        etaMonth = currentMonth + 1;
                        if (etaMonth > 11) {
                            etaMonth = 0; // January
                            etaYear++;
                        }
                    }
                    // Parse time (HH:MM format) with error handling
                    try {
                        const timeParts = ship.etaTime.split(':');
                        if (timeParts.length >= 2) {
                            const hours = parseInt(timeParts[0], 10);
                            const minutes = parseInt(timeParts[1], 10);
                            // Validate hours and minutes
                            if (!isNaN(hours) && !isNaN(minutes) &&
                                hours >= 0 && hours < 24 &&
                                minutes >= 0 && minutes < 60) {
                                // Create ISO datetime string
                                const etaDate = new Date(etaYear, etaMonth, etaDay, hours, minutes);
                                eta = etaDate.toISOString();
                            }
                            else {
                                console.warn(`Invalid time values for ship ${ship.name}: ${ship.etaTime}`);
                            }
                        }
                        else {
                            console.warn(`Malformed time string for ship ${ship.name}: ${ship.etaTime}`);
                        }
                    }
                    catch (error) {
                        console.error(`Error parsing ETA time for ship ${ship.name}:`, error);
                    }
                }
            }
            // Determine status based on markers and ETA
            if (ship.statusMarker === 'anchor') {
                status = 'Awaiting Berth';
            }
            else if (ship.statusMarker === 'etc') {
                status = 'Alongside';
            }
            else if (eta) {
                status = 'Due';
            }
            else {
                // Default to Due if no other indicator
                status = 'Due';
            }
            return {
                name: ship.name,
                gt: ship.gt,
                port: ship.port,
                eta: eta, // ISO string or null
                status: status,
                notes: ship.notes || null, // Contextual notes from PDF
                source: 'Other' // 'Auto from Daydairy' concept - using 'Other' from Source type
            };
        });
        console.log(`OpenAI found ${shipsFound.length} ships`);
        // CLEANUP: Update metadata - mark update as processed AND store cached ship data
        // Also preserve previous data for change detection (strikethrough/bold highlighting)
        await metadataRef.set({
            update_available: false,
            last_processed: firestore_1.FieldValue.serverTimestamp(),
            processing: false,
            processing_started_at: null,
            cached_ships: shipsFound, // Store parsed ships for instant frontend display
            cached_text: rawText, // Store raw text as well
            cached_page_count: pdfData.numpages,
            // Preserve previous version for change detection
            previous_ships: previousShips,
            previous_processed: previousProcessed
        }, { merge: true });
        console.log("Processing complete, metadata updated");
        return {
            text: rawText,
            numPages: pdfData.numpages,
            ships: shipsFound,
            shipsCount: shipsFound.length
        };
    }
    catch (error) {
        // Release lock on error
        try {
            await metadataRef.update({
                processing: false,
                processing_started_at: null
            });
            console.log("Processing lock released due to error");
        }
        catch (lockError) {
            console.error("Failed to release processing lock:", lockError);
        }
        console.error("Error fetching/parsing PDF:", {
            message: error === null || error === void 0 ? void 0 : error.message,
            stack: error === null || error === void 0 ? void 0 : error.stack
        });
        throw new https_1.HttpsError("internal", `Failed to fetch daily diary PDF: ${(error === null || error === void 0 ? void 0 : error.message) || error}`);
    }
});
// Email configuration secrets
const emailUser = (0, params_1.defineSecret)("EMAIL_USER");
const emailPassword = (0, params_1.defineSecret)("EMAIL_PASSWORD");
/**
 * Cloud Function that sends email notifications to admins when a new user registers.
 *
 * IMPORTANT: This uses Firebase Functions v1 because v2 doesn't support Auth triggers yet.
 *
 * How it works:
 * 1. Firebase Auth automatically triggers this function when a user is created
 * 2. We extract the user's email, displayName, and UID from the Auth object
 * 3. Using Nodemailer, we send an email via SMTP (Gmail) to the admin addresses
 * 4. The admin can then assign proper roles (Pilot, SFPC, Admin) in Firebase Console
 *
 * Required Secrets (set via Firebase CLI):
 * - EMAIL_USER: Your Gmail address (e.g., admin@shannonpilots.ie)
 * - EMAIL_PASSWORD: Your Gmail App Password (NOT your regular password!)
 *   Generate at: https://myaccount.google.com/apppasswords
 *
 * To set secrets:
 * firebase functions:secrets:set EMAIL_USER
 * firebase functions:secrets:set EMAIL_PASSWORD
 */
exports.onNewUserRegistration = functionsV1
    .runWith({
    secrets: [emailUser, emailPassword] // Type assertion needed for secrets in v1
})
    .auth.user()
    .onCreate(async (user) => {
    try {
        // Extract user information from the Auth trigger
        const { email, displayName, uid, metadata } = user;
        const creationTime = metadata.creationTime || new Date().toISOString();
        console.log("New user registered:", { email, displayName, uid });
        // Configure the SMTP transport using Gmail
        // Why Gmail? It's free, reliable, and most orgs already have it
        const transporter = nodemailer.createTransport({
            service: "gmail",
            auth: {
                user: emailUser.value(),
                pass: emailPassword.value()
            }
        });
        // Fetch admin email addresses from Firestore
        // This is more secure than hardcoding and easier to manage
        // Simply set userType to 'admin' in Firestore for any admin users
        let adminEmails = [];
        try {
            const adminsSnapshot = await admin.firestore()
                .collection('users')
                .where('userType', '==', 'admin')
                .get();
            adminEmails = adminsSnapshot.docs
                .map(doc => doc.data().email)
                .filter(email => email); // Filter out any null/undefined emails
            console.log(`Found ${adminEmails.length} admin(s) to notify`);
        }
        catch (error) {
            console.error("Error fetching admin emails from Firestore:", error);
            // Fallback: use the EMAIL_USER secret as a single admin
            adminEmails = [emailUser.value()];
        }
        // If no admins found, use EMAIL_USER as fallback
        if (adminEmails.length === 0) {
            console.log("No admin users found in Firestore, using EMAIL_USER as fallback");
            adminEmails = [emailUser.value()];
        }
        // Compose the email
        const mailOptions = {
            from: `TripRecord System <${emailUser.value()}>`,
            to: adminEmails.join(", "),
            subject: `🚢 New User Registration: ${email}`,
            html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1976d2;">New User Registered</h2>
            <p>A new user has registered for the TripRecord system:</p>
            
            <table style="border-collapse: collapse; width: 100%; margin: 20px 0;">
              <tr style="background-color: #f5f5f5;">
                <td style="padding: 10px; border: 1px solid #ddd;"><strong>Email:</strong></td>
                <td style="padding: 10px; border: 1px solid #ddd;">${email}</td>
              </tr>
              <tr>
                <td style="padding: 10px; border: 1px solid #ddd;"><strong>Display Name:</strong></td>
                <td style="padding: 10px; border: 1px solid #ddd;">${displayName || "Not provided"}</td>
              </tr>
              <tr style="background-color: #f5f5f5;">
                <td style="padding: 10px; border: 1px solid #ddd;"><strong>User ID:</strong></td>
                <td style="padding: 10px; border: 1px solid #ddd;">${uid}</td>
              </tr>
              <tr>
                <td style="padding: 10px; border: 1px solid #ddd;"><strong>Registration Time:</strong></td>
                <td style="padding: 10px; border: 1px solid #ddd;">${new Date(creationTime).toLocaleString()}</td>
              </tr>
            </table>
            
            <p><strong>Next Steps:</strong></p>
            <ol>
              <li>Review the user's information</li>
              <li>Assign appropriate role (Pilot, SFPC, Admin, or Viewer)</li>
              <li>Update user type in <a href="https://console.firebase.google.com/project/shannonpilots-6fedd/firestore/databases/-default-/data/~2Fusers~2F${uid}">Firestore</a></li>
            </ol>
            
            <p style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 12px;">
              This is an automated message from the TripRecord system.
            </p>
          </div>
        `
        };
        // Send the email
        await transporter.sendMail(mailOptions);
        console.log(`Admin notification email sent successfully for user: ${email}`);
    }
    catch (error) {
        // Log the error but don't throw - we don't want to block user registration
        // if email sending fails
        console.error("Error sending admin notification email:", {
            message: error === null || error === void 0 ? void 0 : error.message,
            stack: error === null || error === void 0 ? void 0 : error.stack
        });
        // Note: We're intentionally NOT throwing here because:
        // 1. User registration should succeed even if email fails
        // 2. This is a notification feature, not critical to auth flow
    }
});
// ==============================================================================
// SHANNON DAILY DIARY - WATCHTOWER FUNCTIONS
// ==============================================================================
const PDF_URL = "http://www.cargopro.ie/sfpc/download/rpt_daydiary.pdf";
/**
 * Shared helper function for checking if the Shannon Daily Diary PDF has changed.
 * Used by both day and night scheduled functions.
 *
 * Logic:
 * 1. Send HTTP HEAD request to PDF URL (lightweight, no download)
 * 2. Extract Last-Modified header
 * 3. Compare with stored value in Firestore
 * 4. If different, set update_available flag
 * 5. Error handling: log and continue (will retry on next schedule)
 */
async function runFlagCheck() {
    var _a, _b;
    const db = admin.firestore();
    try {
        console.log("Starting Shannon PDF flag check...");
        // Check if watchtower is enabled (admin can pause monitoring)
        const checkMetadataRef = db.doc("system_settings/shannon_diary_metadata");
        const checkDoc = await checkMetadataRef.get();
        if (checkDoc.exists && ((_a = checkDoc.data()) === null || _a === void 0 ? void 0 : _a.watchtower_enabled) === false) {
            console.log("Watchtower is paused by admin. Skipping check.");
            return;
        }
        // Import axios dynamically
        const axios = (await Promise.resolve().then(() => require("axios"))).default;
        // Send HEAD request (gets headers only, no body download)
        const response = await axios.head(PDF_URL, {
            timeout: 10000 // 10 second timeout
        });
        const serverModified = response.headers["last-modified"];
        console.log("Server Last-Modified:", serverModified);
        if (!serverModified) {
            console.warn("No Last-Modified header found in response");
            return;
        }
        // Get current metadata from Firestore
        const metadataRef = db.doc("system_settings/shannon_diary_metadata");
        const doc = await metadataRef.get();
        const currentModified = (_b = doc.data()) === null || _b === void 0 ? void 0 : _b.current_last_modified;
        // Compare and update if different
        if (serverModified !== currentModified) {
            await metadataRef.set({
                update_available: true,
                current_last_modified: serverModified,
                last_check: firestore_1.FieldValue.serverTimestamp(),
                watchtower_enabled: true // Initialize as enabled
            }, { merge: true });
            console.log(`✓ Update detected! Server: ${serverModified}, Previous: ${currentModified}`);
        }
        else {
            // No change, just update last_check timestamp (use set with merge to auto-create)
            await metadataRef.set({
                last_check: firestore_1.FieldValue.serverTimestamp(),
                watchtower_enabled: true // Initialize as enabled if doesn't exist
            }, { merge: true });
            console.log("✓ No update detected, PDF unchanged");
        }
    }
    catch (error) {
        console.error("Flag check failed:", {
            message: error === null || error === void 0 ? void 0 : error.message,
            code: error === null || error === void 0 ? void 0 : error.code,
            url: PDF_URL
        });
        // Don't throw - let it retry on next schedule
    }
}
/**
 * Scheduled function: Shannon Day Watcher
 * Runs every 10 minutes during business hours (07:00-21:59 UTC)
 *
 * Purpose: Frequent checks when port activity is highest
 */
exports.checkShannonDay = (0, scheduler_1.onSchedule)({
    schedule: "*/10 7-21 * * *", // Every 10 minutes, 07:00-21:59 UTC
    timeZone: "UTC",
    region: "europe-west1"
}, async () => {
    console.log("checkShannonDay triggered");
    await runFlagCheck();
});
/**
 * Scheduled function: Shannon Night Watcher
 * Runs every hour during quiet hours (22:00-06:59 UTC)
 *
 * Purpose: Less frequent checks to save resources when port is less active
 */
exports.checkShannonNight = (0, scheduler_1.onSchedule)({
    schedule: "0 22-23,0-6 * * *", // Hourly, 22:00-06:59 UTC
    timeZone: "UTC",
    region: "europe-west1"
}, async () => {
    console.log("checkShannonNight triggered");
    await runFlagCheck();
});
//# sourceMappingURL=index.js.map