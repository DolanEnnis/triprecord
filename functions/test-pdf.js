// Test pdf-parse-new
const axios = require("axios");
const pdf = require("pdf-parse-new");

async function test() {
  try {
    console.log("Fetching PDF...");
    
    const response = await axios.get("http://www.cargopro.ie/sfpc/download/rpt_daydiary.pdf", {
      responseType: 'arraybuffer'
    });
    const pdfBuffer = Buffer.from(response.data);
    
    console.log("PDF size:", pdfBuffer.length, "bytes");
    
    // Same simple API as pdf-parse v1.x
    const pdfData = await pdf(pdfBuffer);
    
    console.log("✓ SUCCESS!");
    console.log("Pages:", pdfData.numpages);
    console.log("Text length:", pdfData.text.length);
    console.log("\nFirst 1000 characters:");
    console.log("=".repeat(50));
    console.log(pdfData.text.substring(0, 1000));
    console.log("=".repeat(50));
    
  } catch (error) {
    console.error("✗ ERROR:", error.message);
    console.error(error.stack);
  }
}

test();
