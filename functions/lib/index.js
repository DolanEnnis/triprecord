"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchShipDetails = void 0;
const admin = require("firebase-admin");
const params_1 = require("firebase-functions/params");
const https_1 = require("firebase-functions/v2/https");
const v2_1 = require("firebase-functions/v2");
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
//# sourceMappingURL=index.js.map