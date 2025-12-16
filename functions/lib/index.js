"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onNewUserRegistration = exports.fetchShipDetails = void 0;
const admin = require("firebase-admin");
const params_1 = require("firebase-functions/params");
const https_1 = require("firebase-functions/v2/https");
const v2_1 = require("firebase-functions/v2");
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
//# sourceMappingURL=index.js.map