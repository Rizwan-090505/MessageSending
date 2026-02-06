// === IMPORTS ===
const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");
const qrcodeTerminal = require("qrcode-terminal");
const { createClient } = require("@supabase/supabase-js");
const path = require("path");
const fs = require("fs");
const { registerFont, createCanvas, loadImage } = require("canvas");

// === CONFIGURATION ===
const SUPABASE_URL = "https://tjdepqtouvbwqrakarkh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqZGVwcXRvdXZid3FyYWthcmtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDkxODM4NTMsImV4cCI6MjA2NDc1OTg1M30.5sippZdNYf3uLISBOHHlJkphtlJc_Q1ZRTzX9E8WYb8";

// File Paths
// NOTE: Download a fancy Google Font (e.g., 'Great Vibes'), rename it to 'font.ttf', and put it here.
const FONT_PATH = path.join(__dirname, "../assets/font.ttf");
const LAYOUT_PATH = path.join(__dirname, "../assets/layout.png");

// === FONT REGISTRATION ===
if (fs.existsSync(FONT_PATH)) {
  // We register it as "FancyGoogleFont" to use in the canvas
  registerFont(FONT_PATH, { family: "FancyGoogleFont" });
  console.log("✅ Custom font loaded (Local file used, no OS install needed).");
} else {
  console.warn("⚠️ font.ttf NOT found! Text will use system default.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

function formatJid(number) {
  if (!number) return null;
  let raw = number.toString().replace(/[^0-9]/g, "");
  if (raw.startsWith("0") && raw.length === 11) raw = "92" + raw.slice(1);
  if (raw.startsWith("92") && raw.length === 12) return `${raw}@s.whatsapp.net`;
  return null;
}

// === MAIN IMAGE GENERATOR ===
async function generateBirthdayCard(studentName) {
  // 1. Check layout existence
  if (!fs.existsSync(LAYOUT_PATH)) {
    throw new Error("❌ layout.png not found! Please add it to the folder.");
  }

  // 2. Load Original Image
  const originalImage = await loadImage(LAYOUT_PATH);
  const originalWidth = originalImage.width;
  const originalHeight = originalImage.height;

  // 3. Create Full-Size Canvas (for high-res text writing)
  const mainCanvas = createCanvas(originalWidth, originalHeight);
  const ctx = mainCanvas.getContext("2d");

  // Draw Layout
  ctx.drawImage(originalImage, 0, 0, originalWidth, originalHeight);

  // 4. Draw Text
  const x = 1273;
  const y = 900;

  // using 125pt size and the custom registered font family
  ctx.font = '125pt "FancyGoogleFont", "cursive", sans-serif'; 
  ctx.fillStyle = "#000000"; 
  ctx.textAlign = "left";    
  ctx.textBaseline = "middle"; 

  // CHANGED: Convert Name to Lowercase
  ctx.fillText(studentName, x, y);

  // 5. CROP LOGIC (Trim 10% off left and right)
  const trimAmount = originalWidth * 0.10; 
  const cropX = trimAmount;
  const cropWidth = originalWidth - (trimAmount * 2); 
  const cropHeight = originalHeight;

  // Create intermediate canvas for the cropped version
  const croppedCanvas = createCanvas(cropWidth, cropHeight);
  const croppedCtx = croppedCanvas.getContext("2d");

  croppedCtx.drawImage(
    mainCanvas, 
    cropX, 0, cropWidth, cropHeight, // Source (cut out the middle)
    0, 0, cropWidth, cropHeight      // Destination
  );

  // 6. SHRINK LOGIC (Resize to make file smaller)
  const scaleFactor = 0.5; // Resize to 50%
  const finalWidth = Math.floor(cropWidth * scaleFactor);
  const finalHeight = Math.floor(cropHeight * scaleFactor);

  const finalCanvas = createCanvas(finalWidth, finalHeight);
  const finalCtx = finalCanvas.getContext("2d");

  // Draw the cropped image onto the smaller canvas
  finalCtx.drawImage(
    croppedCanvas,
    0, 0, cropWidth, cropHeight,   // Source Dimensions (Full cropped image)
    0, 0, finalWidth, finalHeight  // Destination Dimensions (Shrunk)
  );

  return finalCanvas.toBuffer("image/png");
}

// === DATA FETCHING ===
async function fetchBirthdayStudents() {
  const today = new Date();
  const currentMonth = today.getMonth() + 1;
  const currentDay = today.getDate();

  const { data, error } = await supabase
    .from("students")
    .select("studentid, name, fathername, mobilenumber, dob");

  if (error) throw new Error(`Supabase fetch failed: ${error.message}`);

  return data.filter((s) => {
    if (!s.dob) return false;
    const d = new Date(s.dob);
    return d.getMonth() + 1 === currentMonth && d.getDate() === currentDay;
  });
}

// === BOT LOGIC ===
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, "auth_session_stable"));
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({ version, auth: state, printQRInTerminal: false });
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) qrcodeTerminal.generate(qr, { small: true });
    if (connection === "open") {
      console.log("✅ Bot Online");
      await processBirthdayQueue(sock);
    }
    if (connection === "close") {
        const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect) startBot();
    }
  });
}

async function processBirthdayQueue(sock) {
  const students = await fetchBirthdayStudents();
  if (students.length === 0) {
    console.log("No birthdays today.");
    process.exit(0);
  }

  for (const student of students) {
    const jid = formatJid(student.mobilenumber);
    if (!jid) continue;

    try {
      console.log(`Generating card for ${student.name}...`);
      
      const imageBuffer = await generateBirthdayCard(student.name);

      const captionStr = `🎂 *Happy Birthday, ${student.name}!* \n\nWishing you a wonderful year ahead.\n\n_May the Almighty bless your journey with knowledge and success._\n\nBest Wishes,\n*DAR-E-ARQAM SCHOOL*`;

      await sock.sendMessage(jid, {
        image: imageBuffer,
        caption: captionStr
      });
      console.log(`✅ Sent to ${student.name}`);
      await delay(Math.floor(Math.random() * 5000) + 5000);
    } catch (e) {
      console.error(`Failed to send to ${student.name}:`, e);
    }
  }
  console.log("Queue finished.");
  process.exit(0);
}

startBot();
