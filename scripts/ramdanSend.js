const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const { createClient } = require('@supabase/supabase-js');
const qrcode = require('qrcode-terminal'); // Replaced web qrcode with terminal version

// === CONFIG ===
const SUPABASE_URL = "https://tjdepqtouvbwqrakarkh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqZGVwcXRvdXZid3FyYWthcmtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDkxODM4NTMsImV4cCI6MjA2NDc1OTg1M30.5sippZdNYf3uLISBOHHlJkphtlJc_Q1ZRTzX9E8WYb8";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let sock; 
let abortSending = false; 

// Setup command line interface
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// === UTILS ===
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

function toWid(mobile) {
    if (!mobile) return null;
    const d = mobile.toString().replace(/\D/g, "");
    let e164 = null;
    if (d.startsWith("92") && d.length >= 12) e164 = d;
    else if (d.startsWith("0") && d.length === 11) e164 = "92" + d.slice(1);
    else if (d.startsWith("3") && d.length === 10) e164 = "92" + d;
    else if (d.startsWith("0092") && d.length >= 14) e164 = d.slice(2);
    return e164 ? `${e164}@s.whatsapp.net` : null;
}

// ============================================================
// === 📅 DATE & FILE RESOLVER (PKT) ===
// ============================================================
function getTodayFilename() {
    const now = new Date();
    
    // Lock the timezone strictly to Pakistan Standard Time
    const pktOptions = { timeZone: 'Asia/Karachi' };
    
    const day = new Intl.DateTimeFormat('en-US', { ...pktOptions, day: 'numeric' }).format(now);
    const month = new Intl.DateTimeFormat('en-US', { ...pktOptions, month: 'short' }).format(now);
    const weekday = new Intl.DateTimeFormat('en-US', { ...pktOptions, weekday: 'long' }).format(now);
    
    return `${day}-${month},${weekday}.png`; // e.g., 1-Mar,Sunday.png
}

function getTodayMediaObject() {
    const todayFilename = getTodayFilename();
    
    const pathOption1 = path.join(__dirname, 'output', todayFilename);
    const pathOption2 = path.join(__dirname, 'scripts', 'output', todayFilename);
    
    let targetPath = null;
    if (fs.existsSync(pathOption1)) targetPath = pathOption1;
    else if (fs.existsSync(pathOption2)) targetPath = pathOption2;

    if (!targetPath) {
        throw new Error(`Could not find today's file: ${todayFilename}. Checked in /output/ and /scripts/output/`);
    }

    const fileBuffer = fs.readFileSync(targetPath);
    return {
        buffer: fileBuffer,
        mimetype: 'image/png',
        filename: todayFilename
    };
}

// === INIT WHATSAPP (BAILEYS) ===
async function connectToWhatsApp() {
    console.log(">> Initializing WhatsApp Connection...");
    const { state, saveCreds } = await useMultiFileAuthState('scripts/auth_session_stable');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false, // We handle it manually below for cleaner output
        logger: pino({ level: "silent" }),
        browser: ['SchoolSender CLI', 'Terminal', '1.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('\n>> Scan the QR Code below to connect:');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('>> Connection closed. ' + (shouldReconnect ? 'Reconnecting...' : 'Logged out. Please delete auth folder and restart.'));
            sock = undefined; 
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        }

        if (connection === 'open') {
            console.log('\n✅ WhatsApp Connected Successfully!');
            showMainMenu();
        }
    });
}

// === TUI MENU ===
function showMainMenu() {
    console.log("\n=====================================");
    console.log("       SCHOOL SENDER CLI TUI         ");
    console.log("=====================================");
    console.log("Today's expected file:", getTodayFilename());
    
    rl.question('\nPress Enter to start sending, or type "exit" to quit: ', (answer) => {
        if (answer.toLowerCase() === 'exit') {
            console.log("Exiting...");
            process.exit(0);
        } else {
            handleSendingProcess();
        }
    });
}

// === SENDING LOGIC ===
async function handleSendingProcess() {
    abortSending = false;
    console.log('\n>> Starting Daily Image Sender...');
    
    // --- PREPARE MEDIA ---
    let mediaObj = null;
    try {
        console.log('>> 🔍 Searching for today\'s image...');
        mediaObj = getTodayMediaObject();
        console.log(`>> 📁 Successfully loaded today's file: ${mediaObj.filename}`);
    } catch (e) {
        console.log(`\n❌ Failed to load file: ${e.message}`);
        showMainMenu();
        return; 
    }

    console.log('>> Fetching ALL active students from Database...');

    // Fetch ALL active students
    const { data: students, error } = await supabase.from("active_students").select("*");

    if (error) {
        console.error(`❌ Supabase Error: ${error.message}`);
        showMainMenu();
        return;
    }

    if (!students || students.length === 0) {
        console.log('>> ⚠️ No active students found in the database.');
        showMainMenu();
        return;
    }

    // Deduplication logic
    const recipients = [];
    const seen = new Set();
    for (const s of students) {
        const wid = toWid(s.mobilenumber);
        if (!wid || seen.has(wid)) continue;
        seen.add(wid);
        recipients.push({ ...s, wid });
    }

    console.log(`>> Found ${recipients.length} deduplicated recipients.\n`);

    // --- SENDING LOOP ---
    let sentCount = 0;
    
    // Optional: Allow user to press Ctrl+C to abort gracefully
    rl.on('SIGINT', () => {
        console.log("\n🛑 Abort signal received. Stopping after current message...");
        abortSending = true;
    });

    for (const r of recipients) {
        if (abortSending) {
            console.log('🛑 Sending Aborted by User.');
            break;
        }

        try {
            await sock.sendMessage(r.wid, { 
                image: mediaObj.buffer, 
                caption: "" // You can add dynamic captions here if needed
            });

            sentCount++;
            console.log(`[${sentCount}/${recipients.length}] ✅ Sent to ${r.name || r.mobilenumber}`);

            // Anti-Ban Delays
            if (sentCount % 50 === 0) {
                console.log('⏸ Taking a 30s safety break...');
                await delay(30000);
            } else {
                await delay(Math.floor(Math.random() * 2000) + 1500); 
            }

        } catch (e) {
            console.log(`[${sentCount + 1}/${recipients.length}] ❌ Failed to send to ${r.name}: ${e.message}`);
        }
    }

    console.log('\n🏁 Bulk sending finished.');
    
    // Reset SIGINT listener so Ctrl+C exits normally again
    rl.removeAllListeners('SIGINT');
    showMainMenu(); 
}

// === START APPLICATION ===
connectToWhatsApp();
