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
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqZGVwcXRvdXZid3FyYWthcmtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDkxODM4NTMsImV4cCI6MjA2NDc1OTg1M30.5sippZdNYf3uLISBOHHlJkphtlJc_Q1ZRTzX9E8WYb8";


// Branding Config
const SCHOOL_NAME = "DAR-E-ARQAM SCHOOL";
const BRAND_COLOR = "#00008B"; // Dark Blue
const GOLD_COLOR = "#C5A059"; // Professional Champagne Gold

const FONT_PATH = path.join(__dirname, "revue.ttf");
const LOGO_PATH = path.join(__dirname, "logo.png");

// Ensuring font is registered
if (fs.existsSync(FONT_PATH)) {
  registerFont(FONT_PATH, { family: "Revue" });
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

// === PROFESSIONAL GRAPHICS HELPERS ===

function drawBackgroundPattern(ctx, width, height) {
  // 1. Clean Background
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, width, height);
  
  // 2. Subtle Geometric Pattern (Blue Circles)
  ctx.globalAlpha = 0.03;
  ctx.fillStyle = BRAND_COLOR;
  for(let i=0; i<width; i+=60) {
      for(let j=0; j<height; j+=60) {
          ctx.beginPath();
          ctx.arc(i, j, 10, 0, Math.PI*2);
          ctx.fill();
      }
  }
  ctx.globalAlpha = 1.0; // Reset alpha

  // 3. Elegant Gold Border Frame
  const padding = 30;
  ctx.strokeStyle = GOLD_COLOR;
  ctx.lineWidth = 5;
  ctx.strokeRect(padding, padding, width - (padding*2), height - (padding*2));
  
  // Inner thin line
  ctx.lineWidth = 2;
  ctx.strokeRect(padding + 15, padding + 15, width - (padding*2) - 30, height - (padding*2) - 30);
}

// === IMAGE GENERATION ===
async function generateBirthdayCard(studentName) {
  const width = 1080;
  const height = 1080;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // 1. Draw Background & Frame
  drawBackgroundPattern(ctx, width, height);

  ctx.textAlign = "center";

  // 2. Branding Section (Top)
  const logoSize = 160; 
  const logoYPos = 80;

  try {
    if (fs.existsSync(LOGO_PATH)) {
      const logo = await loadImage(LOGO_PATH);
      ctx.drawImage(logo, (width/2) - (logoSize/2), logoYPos, logoSize, logoSize);
    }
  } catch (e) {}

  // School Name
  ctx.font = '45px "Revue", sans-serif'; 
  ctx.fillStyle = BRAND_COLOR;
  ctx.fillText(SCHOOL_NAME, width / 2, logoYPos + logoSize + 60);

  // 3. The Intro Text (Prominent & Spaced)
  // Changed phrasing and style as requested
  ctx.font = 'bold 35px "Arial", sans-serif';
  ctx.fillStyle = "#555"; 
  ctx.letterSpacing = "4px"; // Spaced out letters for elegance
  // Moved down to Y=450 to create space from logo
  ctx.fillText("SPECIAL WISHES FOR A BLESSED", width / 2, 450);
  ctx.letterSpacing = "0px"; // Reset spacing

  // 4. "BIRTHDAY" Title (Slightly Smaller & Revamped)
  // Moved to Y=580 to create gap from intro text
  ctx.save();
  ctx.shadowColor = "rgba(197, 160, 89, 0.4)"; // Gold shadow
  ctx.shadowBlur = 15;
  
  // Size reduced from 150 to 110 as requested
  ctx.font = '110px "Revue", "Arial Black", sans-serif';
  ctx.fillStyle = BRAND_COLOR;
  ctx.fillText("BIRTHDAY", width / 2, 580);
  ctx.restore();

  // 5. Student Name (The Focus)
  // Decorative line above name
  ctx.beginPath();
  ctx.strokeStyle = GOLD_COLOR;
  ctx.lineWidth = 3;
  ctx.moveTo(340, 650);
  ctx.lineTo(740, 650);
  ctx.stroke();

  // Name Text
  ctx.font = '900 90px "Arial Black", sans-serif';
  ctx.fillStyle = "#222";
  ctx.fillText(studentName.toUpperCase(), width / 2, 750);

  // Decorative line below name
  ctx.beginPath();
  ctx.moveTo(340, 790);
  ctx.lineTo(740, 790);
  ctx.stroke();

  // 6. Footer Message
  ctx.font = 'italic 30px "Times New Roman", serif';
  ctx.fillStyle = "#666";
  ctx.fillText("May your path be illuminated with knowledge.", width / 2, 900);

  // Bottom Accent
  ctx.fillStyle = BRAND_COLOR;
  ctx.fillRect(490, 950, 100, 8); // Small central bar

  return canvas.toBuffer("image/png");
}

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

      // === UPDATED CAPTION (Islamic Touch & Brief) ===
      const captionStr = `🎉 *Happy Birthday, ${student.name}!* \n\nMay Allah (SWT) bless you with immense knowledge, health, and success in this world and the hereafter. 🤲✨\n\nBest wishes,\n*${SCHOOL_NAME}*`;

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
