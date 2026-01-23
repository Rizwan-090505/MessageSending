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

// Branding Config - Premium & Aesthetic
const COLORS = {
  primary: "#0F172A",    // Rich Navy (almost black)
  secondary: "#D4AF37",  // Luxury Gold
  secondaryLight: "#F3E5AB", // Champagne Gold
  bgCenter: "#FFFFFF",
  bgEdge: "#F1F5F9",     // Cool Grey edge
  textMain: "#1E293B",
  textMuted: "#64748B"
};

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

// === HIGH-END GRAPHICS HELPERS ===

// 1. Draw "Fancier" Corner Ribbons/Waves
function drawCornerDecorations(ctx, width, height) {
  ctx.save();
  
  // Top Right Gold Wave
  ctx.beginPath();
  ctx.moveTo(width, 0);
  ctx.lineTo(width, 350);
  ctx.bezierCurveTo(width - 100, 300, width - 350, 100, width - 400, 0);
  ctx.fillStyle = COLORS.secondary;
  ctx.fill();

  // Top Right Navy Accent (Behind Gold)
  ctx.beginPath();
  ctx.moveTo(width, 0);
  ctx.lineTo(width, 400);
  ctx.bezierCurveTo(width - 50, 350, width - 400, 150, width - 450, 0);
  ctx.globalCompositeOperation = "destination-over"; // Draw behind
  ctx.fillStyle = COLORS.primary;
  ctx.fill();
  ctx.globalCompositeOperation = "source-over"; // Reset

  // Bottom Left Navy Wave
  ctx.beginPath();
  ctx.moveTo(0, height);
  ctx.lineTo(0, height - 300);
  ctx.bezierCurveTo(100, height - 250, 300, height - 50, 400, height);
  ctx.fillStyle = COLORS.primary;
  ctx.fill();

  // Bottom Left Gold Accent
  ctx.beginPath();
  ctx.moveTo(0, height);
  ctx.lineTo(0, height - 250);
  ctx.bezierCurveTo(50, height - 200, 250, height - 50, 300, height);
  ctx.fillStyle = COLORS.secondary;
  ctx.fill();

  ctx.restore();
}

// 2. Gold Dust / Confetti (Premium feel)
function drawGoldDust(ctx, width, height) {
  const count = 50;
  const colors = [COLORS.secondary, COLORS.secondaryLight, "#E6C200"];
  
  for (let i = 0; i < count; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const size = Math.random() * 4 + 1;
    
    ctx.globalAlpha = Math.random() * 0.6 + 0.2;
    ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
    
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1.0;
}

// === MAIN IMAGE GENERATOR ===
async function generateBirthdayCard(studentName) {
  const width = 1080;
  const height = 1080;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // --- A. BACKGROUND ---
  // Radial Gradient for a "Spotlight" effect
  const grd = ctx.createRadialGradient(width/2, height/2, 100, width/2, height/2, 800);
  grd.addColorStop(0, COLORS.bgCenter);
  grd.addColorStop(1, COLORS.bgEdge);
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, width, height);

  // Add Texture/Decorations
  drawCornerDecorations(ctx, width, height);
  drawGoldDust(ctx, width, height);

  // --- B. HEADER (Top Left) ---
  const padX = 60;
  const padY = 60;
  const logoSize = 130;

  try {
    if (fs.existsSync(LOGO_PATH)) {
      const logo = await loadImage(LOGO_PATH);
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.2)";
      ctx.shadowBlur = 10;
      ctx.drawImage(logo, padX, padY, logoSize, logoSize);
      ctx.restore();
    }
  } catch (e) {}

  // Text next to Logo
  const textX = padX + logoSize + 30;
  const textY = padY + 60; 

  ctx.textAlign = "left";
  
  // --- UPDATED HEADER FONTS TO REVUE ---
  // Line 1: DAR-E-ARQAM
  ctx.font = '45px "Revue", "Arial Black", sans-serif'; 
  ctx.fillStyle = COLORS.primary;
  ctx.fillText("DAR-E-ARQAM", textX, textY);

  // Line 2: SCHOOL
  ctx.font = '30px "Revue", "Arial Black", sans-serif';
  ctx.fillStyle = COLORS.secondary; 
  ctx.letterSpacing = "6px";
  ctx.fillText("SCHOOL", textX, textY + 45);
  ctx.letterSpacing = "0px";

  // --- C. MAIN TEXT (Centered) ---
  ctx.textAlign = "center";
  const centerX = width / 2;
  
  // 1. "Wishing a"
  let cursorY = 420;
  ctx.font = 'italic 45px "Times New Roman", serif';
  ctx.fillStyle = "#555";
  ctx.fillText("Wishing a", centerX, cursorY);

  // 2. HAPPY BIRTHDAY (Updated for Visibility)
  cursorY += 110;
  ctx.save();
  
  // CHANGED FONT: Not Revue, used Impact/Arial Black for style + boldness
  ctx.font = 'bold 120px "Impact", "Arial Black", sans-serif'; 
  
  // CHANGED GRADIENT: Richer Gold to stand out on white
  const textGradient = ctx.createLinearGradient(0, 0, width, 0);
  textGradient.addColorStop(0.2, "#B8860B"); // Dark Goldenrod
  textGradient.addColorStop(0.5, "#FFD700"); // Pure Gold
  textGradient.addColorStop(0.8, "#B8860B"); 
  
  ctx.fillStyle = textGradient;
  
  // ADDED STROKE: Black/Navy outline ensures visibility on white background
  ctx.strokeStyle = "#1E293B"; // Dark Navy Outline
  ctx.lineWidth = 3; // Thickness of the outline

  // Shadow for pop
  ctx.shadowColor = "rgba(0,0,0,0.3)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 5;
  
  // Draw Stroke First (Behind) then Fill
  ctx.strokeText("HAPPY", centerX, cursorY);
  ctx.fillText("HAPPY", centerX, cursorY);
  
  ctx.strokeText("BIRTHDAY", centerX, cursorY + 115);
  ctx.fillText("BIRTHDAY", centerX, cursorY + 115);
  
  ctx.restore();

  // 3. Student Name
  cursorY += 280;
  
  // Decorative line
  ctx.beginPath();
  ctx.moveTo(centerX - 80, cursorY - 70);
  ctx.lineTo(centerX + 80, cursorY - 70);
  ctx.strokeStyle = COLORS.secondary;
  ctx.lineWidth = 3;
  ctx.stroke();

  // Name Text
  ctx.font = 'bold 80px "Arial", sans-serif';
  ctx.fillStyle = COLORS.primary;
  
  if (studentName.length > 12) ctx.font = 'bold 65px "Arial", sans-serif';
  if (studentName.length > 18) ctx.font = 'bold 55px "Arial", sans-serif';

  ctx.fillText(studentName.toUpperCase(), centerX, cursorY);

  // --- D. FOOTER ---
  cursorY += 120;
  
  ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
  ctx.fillRect(0, cursorY - 50, width, 150); 

  ctx.font = 'italic 32px "Times New Roman", serif';
  ctx.fillStyle = COLORS.textMuted;
  ctx.fillText("May your year be filled with light,", centerX, cursorY);
  ctx.fillText("blessings, and success.", centerX, cursorY + 45);

  return canvas.toBuffer("image/png");
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
