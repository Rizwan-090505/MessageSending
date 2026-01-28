// === IMPORTS ===
const path = require("path");
const fs = require("fs");
const { registerFont, createCanvas, loadImage } = require("canvas");

// === CONFIGURATION ===
// Ensure these files exist in the SAME folder
const FONT_PATH = path.join(__dirname, "font.ttf");
const LAYOUT_PATH = path.join(__dirname, "layout.png");
const OUTPUT_FILENAME = "preview.png"; // File to save for preview

// === FONT REGISTRATION ===
if (fs.existsSync(FONT_PATH)) {
  registerFont(FONT_PATH, { family: "StudentFont" });
  console.log("✅ Font loaded successfully.");
} else {
  console.warn("⚠️ font.ttf NOT found! Text will use system default.");
}

// === MAIN IMAGE GENERATOR (Exact same logic as bot) ===
async function generateBirthdayCard(studentName) {
  // 1. Check layout existence
  if (!fs.existsSync(LAYOUT_PATH)) {
    throw new Error("❌ layout.png not found! Please add it to the folder.");
  }

  // 2. Load Original Image
  const originalImage = await loadImage(LAYOUT_PATH);
  const originalWidth = originalImage.width;
  const originalHeight = originalImage.height;

  console.log(`Original Dimensions: ${originalWidth}x${originalHeight}`);

  // 3. Create Full-Size Canvas first (to write text)
  const mainCanvas = createCanvas(originalWidth, originalHeight);
  const ctx = mainCanvas.getContext("2d");

  // Draw Layout
  ctx.drawImage(originalImage, 0, 0, originalWidth, originalHeight);

  // 4. Draw Text (Coordinates: X=1573, Y=1763)
  const x = 1273;
  const y = 900;

  ctx.font = '105pt "StudentFont", sans-serif'; 
  ctx.fillStyle = "#000000"; // Black text
  ctx.textAlign = "left";    
  ctx.textBaseline = "middle"; 

  // Write the text
  ctx.fillText(studentName, x, y);

  // 5. CROP / TRIM LOGIC
  // Calculate trimming 10% from left and 10% from right
  const trimAmount = originalWidth * 0.10; // 10% width
  const cropX = trimAmount; // Start cropping 10% in
  const cropWidth = originalWidth - (trimAmount * 2); // Remaining 80% width
  const cropHeight = originalHeight; // Height stays the same

  console.log(`Cropping: Starting at X=${cropX}, New Width=${cropWidth}`);

  // Create a smaller canvas for the cropped result
  const croppedCanvas = createCanvas(cropWidth, cropHeight);
  const croppedCtx = croppedCanvas.getContext("2d");

  // Draw the main canvas onto the cropped canvas
  croppedCtx.drawImage(
    mainCanvas, 
    cropX, 0, cropWidth, cropHeight, // Source region
    0, 0, cropWidth, cropHeight      // Destination region
  );

  return croppedCanvas.toBuffer("image/png");
}

// === PREVIEW RUNNER ===
(async () => {
  try {
    const testName = "MUHAMMAD AHMED"; // You can change this test name
    console.log(`Generating preview for: "${testName}"...`);

    const buffer = await generateBirthdayCard(testName);
    
    fs.writeFileSync(path.join(__dirname, OUTPUT_FILENAME), buffer);
    console.log(`\n✅ Success! Image saved as "${OUTPUT_FILENAME}"`);
    console.log("👉 Open this file to see how it looks.");

  } catch (e) {
    console.error("❌ Error:", e.message);
  }
})();
