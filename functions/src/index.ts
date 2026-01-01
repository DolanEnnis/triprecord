import * as admin from "firebase-admin";
import { defineSecret } from "firebase-functions/params";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { setGlobalOptions } from "firebase-functions/v2";
import { FieldValue } from "firebase-admin/firestore";
import * as functionsV1 from "firebase-functions/v1"; // v1 for auth triggers
import * as nodemailer from "nodemailer";

admin.initializeApp();

// Set global options for V2 functions
setGlobalOptions({ maxInstances: 10 });

// Using OpenAI for reliable AI-powered ship lookups
const openaiApiKey = defineSecret("OPENAI_API_KEY");

export const fetchShipDetails = onCall({ cors: true, region: "europe-west1", secrets: [openaiApiKey] }, async (request) => {
  // 1. Validate Input
  const imo = request.data.imo;
  if (!imo) {
    throw new HttpsError("invalid-argument", "The function must be called with an 'imo' argument.");
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

  } catch (error: any) {
    // Log the full error details to help with debugging
    console.error("Error fetching ship details:", {
      message: error?.message,
      stack: error?.stack,
      fullError: error
    });
    throw new HttpsError("internal", `Failed to fetch ship details from AI: ${error?.message || error}`);
  }
});

/**
 * Cloud Function to fetch and parse the daily diary PDF from CarGoPro.
 * Extracts raw text and uses OpenAI to structure the data into ship records.
 */
export const fetchDailyDiaryPdf = onCall({ 
  cors: true, 
  region: "europe-west1",
  secrets: [openaiApiKey],
  timeoutSeconds: 60,
  memory: "512MiB"
}, async (request) => {
  const db = admin.firestore();
  const metadataRef = db.doc("system_settings/shannon_diary_metadata");
  
  try {
    // STEP 0: Check and acquire processing lock + read current data for history
    const metadataDoc = await metadataRef.get();
    const metadata = metadataDoc.data();
    
    // Preserve current data before processing (for change detection)
    const previousShips = metadata?.cached_ships || [];
    const previousProcessed = metadata?.last_processed || null;

    
    // Check if already processing
    if (metadata?.processing) {
      const processingStarted = metadata.processing_started_at?.toDate();
      const now = new Date();
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
      
      // If lock is stuck (>5 min), release it
      if (processingStarted && processingStarted < fiveMinutesAgo) {
        console.warn("Processing lock is stale (>5min), releasing...");
        await metadataRef.set({
          processing: false,
          processing_started_at: null
        }, { merge: true });
      } else {
        throw new HttpsError("resource-exhausted", "PDF is already being processed. Please try again in a minute.");
      }
    }
    
    // Acquire lock
    await metadataRef.set({
      processing: true,
      processing_started_at: FieldValue.serverTimestamp()
    }, { merge: true });
    
    console.log("Processing lock acquired");
    
    const pdfUrl = "http://www.cargopro.ie/sfpc/download/rpt_daydiary.pdf";
    console.log("Fetching PDF from:", pdfUrl);
    
    // Step 1: Fetch and parse PDF
    const axios = (await import("axios")).default;
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
    const openaiModule = await import("openai");
    const OpenAI = openaiModule.default;
    const openai = new OpenAI({ apiKey: openaiApiKey.value() });

    const prompt = `Analyze this raw text from a Shannon Port "Day Diary" PDF.
It contains a table of ships with columns: Vessel Name, GT (Gross Tonnage), Port (single letter code), and ETA.

Extract ALL ships and structure them as JSON.

Port Code Mapping (single letter to full port name):
- A = Aughinish
- C = Cappa
- M = Moneypoint
- T = Tarbert
- F = Foynes
- S = Shannon
- L = Limerick
(Note: Anchorage has no single letter code)

ETA Format Examples:
- "Eta 21/1150" = day 21 of current month, time 11:50
- "Eta 15/0830" = day 15, time 08:30
- Extract ONLY if format matches "Eta DD/HHMM"
- If no ETA found, set to null

Rules:
1. The "GT" is usually a 3-5 digit number (e.g., 4500, 15900).
2. Ignore small tugs (like "Celtic Rebel") unless they have a clear GT.
3. Port is a single letter code - map it to the full port name.
4. ETA must be in format "Eta DD/HHMM" - extract day and time separately.
5. **IMPORTANT: Include ALL ships even if ETA is missing - just set etaDay and etaTime to null.**
6. **Status Indicators (look for these in the ship's row):**
   - If you see "@ Anchor" or "@Anchor" → set statusMarker to "anchor"
   - If you see "ETC" → set statusMarker to "etc"
   - Otherwise → set statusMarker to null

Output Schema:
{
  "ships": [
    { 
      "name": "SHIP NAME", 
      "gt": 12345, 
      "port": "Port Name",
      "etaDay": 21,
      "etaTime": "11:50",
      "statusMarker": "anchor" | "etc" | null
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
    
    const shipsFound = rawShips.map((ship: any) => {
      let eta: string | null = null;
      let status: 'Due' | 'Awaiting Berth' | 'Alongside';
      
      if (ship.etaDay && ship.etaTime) {
        // Determine which month this ETA is for
        const etaDay = ship.etaDay;
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
        
        // Parse time (HH:MM format)
        const [hours, minutes] = ship.etaTime.split(':').map((n: string) => parseInt(n, 10));
        
        // Create ISO datetime string
        const etaDate = new Date(etaYear, etaMonth, etaDay, hours, minutes);
        eta = etaDate.toISOString();
      }
      
      // Determine status based on markers and ETA
      if (ship.statusMarker === 'anchor') {
        status = 'Awaiting Berth';
      } else if (ship.statusMarker === 'etc') {
        status = 'Alongside';
      } else if (eta) {
        status = 'Due';
      } else {
        // Default to Due if no other indicator
        status = 'Due';
      }
      
      return {
        name: ship.name,
        gt: ship.gt,
        port: ship.port,
        eta: eta, // ISO string or null
        status: status,
        source: 'Other' // 'Auto from Daydairy' concept - using 'Other' from Source type
      };
    });
    
    console.log(`OpenAI found ${shipsFound.length} ships`);

    // CLEANUP: Update metadata - mark update as processed AND store cached ship data
    // Also preserve previous data for change detection (strikethrough/bold highlighting)
    await metadataRef.set({
      update_available: false,
      last_processed: FieldValue.serverTimestamp(),
      processing: false,
      processing_started_at: null,
      cached_ships: shipsFound,  // Store parsed ships for instant frontend display
      cached_text: rawText,      // Store raw text as well
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

  } catch (error: any) {
    // Release lock on error
    try {
      await metadataRef.update({
        processing: false,
        processing_started_at: null
      });
      console.log("Processing lock released due to error");
    } catch (lockError) {
      console.error("Failed to release processing lock:", lockError);
    }
    
    console.error("Error fetching/parsing PDF:", {
      message: error?.message,
      stack: error?.stack
    });
    throw new HttpsError("internal", `Failed to fetch daily diary PDF: ${error?.message || error}`);
  }
});

// Email configuration secrets
const emailUser = defineSecret("EMAIL_USER");
const emailPassword = defineSecret("EMAIL_PASSWORD");

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
export const onNewUserRegistration = functionsV1
  .runWith({
    secrets: [emailUser, emailPassword] as any // Type assertion needed for secrets in v1
  })
  .auth.user()
  .onCreate(async (user: any) => {
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
      let adminEmails: string[] = [];
      
      try {
        const adminsSnapshot = await admin.firestore()
          .collection('users')
          .where('userType', '==', 'admin')
          .get();
        
        adminEmails = adminsSnapshot.docs
          .map(doc => doc.data().email as string)
          .filter(email => email); // Filter out any null/undefined emails
        
        console.log(`Found ${adminEmails.length} admin(s) to notify`);
      } catch (error) {
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
      
    } catch (error: any) {
      // Log the error but don't throw - we don't want to block user registration
      // if email sending fails
      console.error("Error sending admin notification email:", {
        message: error?.message,
        stack: error?.stack
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
async function runFlagCheck(): Promise<void> {
  const db = admin.firestore();
  
  try {
    console.log("Starting Shannon PDF flag check...");
    
    // Check if watchtower is enabled (admin can pause monitoring)
    const checkMetadataRef = db.doc("system_settings/shannon_diary_metadata");
    const checkDoc = await checkMetadataRef.get();
    
    if (checkDoc.exists && checkDoc.data()?.watchtower_enabled === false) {
      console.log("Watchtower is paused by admin. Skipping check.");
      return;
    }
    
    // Import axios dynamically
    const axios = (await import("axios")).default;
    
    // Send HEAD request (gets headers only, no body download)
    const response = await axios.head(PDF_URL, {
      timeout: 10000  // 10 second timeout
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
    const currentModified = doc.data()?.current_last_modified;
    
    // Compare and update if different
    if (serverModified !== currentModified) {
      await metadataRef.set({
        update_available: true,
        current_last_modified: serverModified,
        last_check: FieldValue.serverTimestamp(),
        watchtower_enabled: true  // Initialize as enabled
      }, { merge: true });
      
      console.log(`✓ Update detected! Server: ${serverModified}, Previous: ${currentModified}`);
    } else {
      // No change, just update last_check timestamp (use set with merge to auto-create)
      await metadataRef.set({
        last_check: FieldValue.serverTimestamp(),
        watchtower_enabled: true  // Initialize as enabled if doesn't exist
      }, { merge: true });
      
      console.log("✓ No update detected, PDF unchanged");
    }
    
  } catch (error: any) {
    console.error("Flag check failed:", {
      message: error?.message,
      code: error?.code,
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
export const checkShannonDay = onSchedule({
  schedule: "*/10 7-21 * * *",  // Every 10 minutes, 07:00-21:59 UTC
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
export const checkShannonNight = onSchedule({
  schedule: "0 22-23,0-6 * * *",  // Hourly, 22:00-06:59 UTC
  timeZone: "UTC",
  region: "europe-west1"
}, async () => {
  console.log("checkShannonNight triggered");
  await runFlagCheck();
});

