// === IMPORTS ===
const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const qrcodeTerminal = require("qrcode-terminal");
const QRCode = require("qrcode");
const { createClient } = require("@supabase/supabase-js");
const path = require("path");
const fs = require("fs");

// === CONFIGURATION (REPLACE THESE) ===
const SUPABASE_URL = "https://tjdepqtouvbwqrakarkh.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqZGVwcXRvdXZid3FyYWthcmtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDkxODM4NTMsImV4cCI6MjA2NDc1OTg1M30.5sippZdNYf3uLISBOHHlJkphtlJc_Q1ZRTzX9E8WYb8";


const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const BATCH_SIZE = 500; // Process 500 messages at a time to respect DB limits

// === HELPERS ===
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// Format number to JID
function formatJid(number) {
  let raw = number.toString().replace(/[^0-9]/g, "");
  if (raw.startsWith("0") && raw.length === 11) raw = "92" + raw.slice(1);
  if (raw.startsWith("92") && raw.length === 12) return `${raw}@s.whatsapp.net`;
  return null;
}

// === DATABASE ACTIONS ===

// Fetch a batch of oldest unsent messages
// We removed the Date filter to ensure we never skip "yesterday's" failed messages
async function fetchUnsentBatch() {
  const { data, error } = await supabase
    .from("messages")
    .select("id, number, text")
    .eq("sent", false)
    .order("created_at", { ascending: true }) // FIFO: Oldest first
    .limit(BATCH_SIZE);

  if (error) throw new Error(`Supabase fetch failed: ${error.message}`);
  return data || [];
}

// Mark a single message as sent
async function markAsSent(id) {
  const { error } = await supabase
    .from("messages")
    .update({ sent: true })
    .eq("id", id);
  
  if (error) console.error(`⚠️ Failed to mark DB id ${id} as sent:`, error.message);
}

// === WHATSAPP BOT LOGIC ===
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, "auth_session_stable"));
  const { version } = await fetchLatestBaileysVersion();
  
  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false, // We handle QR manually below
    defaultQueryTimeoutMs: undefined, // Keep connection alive longer
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    // 1. QR Handling
    if (qr) {
      qrcodeTerminal.generate(qr, { small: true });
      const outPath = "/tmp/whatsapp-qr.png";
      try {
        await QRCode.toFile(outPath, qr, { type: "png", width: 300 });
        console.log(`📂 QR saved to ${outPath} (Railway: 'cat ${outPath} > qr.png')`);
      } catch (err) {
        console.error("⚠️ QR Save Error:", err.message);
      }
    }

    // 2. Reconnection Logic
    if (connection === "close") {
      const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        console.log("🔄 Connection dropped. Reconnecting in 5s...");
        await delay(5000);
        startBot();
      } else {
        console.log("❌ Logged out. Delete 'auth_session_stable' and restart.");
        process.exit(1);
      }
    }

    // 3. Connection Open -> Start Processing Queue
    if (connection === "open") {
      console.log("✅ Connected to WhatsApp. Starting Batch Processor...");
      await processMessageQueue(sock);
    }
  });
}

// === CORE PROCESSING LOOP ===
async function processMessageQueue(sock) {
  let totalSent = 0;
  let batchCount = 0;

  // Infinite loop that breaks only when DB is empty
  while (true) {
    console.log(`\n🔄 Fetching batch #${batchCount + 1} (Limit: ${BATCH_SIZE})...`);
    
    let messages;
    try {
      messages = await fetchUnsentBatch();
    } catch (err) {
      console.error("❌ DB Error during fetch:", err.message);
      await delay(10000); // Wait 10s before retrying DB
      continue;
    }

    if (!messages || messages.length === 0) {
      console.log("🎉 No more unsent messages in Database. Work complete.");
      process.exit(0); // EXIT SCRIPT
    }

    console.log(`📥 Loaded ${messages.length} messages. Sending...`);

    // Process the current batch
    for (const msg of messages) {
      const jid = formatJid(msg.number);
      
      if (!jid) {
        console.log(`⚠️ Invalid number format: ${msg.number} (Skipping & Marking Sent)`);
        await markAsSent(msg.id); // Mark sent so we don't get stuck on it forever
        continue;
      }

      try {
        await sock.sendMessage(jid, { text: msg.text });
        console.log(`✔️ Sent to ${jid}`);
        await markAsSent(msg.id);
        
        totalSent++;
        
        // Anti-Ban Delay Logic
        if (totalSent % 80 === 0) {
          console.log("⏸️ Long pause (40s) for safety...");
          await delay(40000);
        } else {
          // Randomize slightly to look more human (3s - 6s)
          const wait = Math.floor(Math.random() * 3000) + 3000;
          await delay(wait);
        }

      } catch (e) {
        console.error(`❌ Failed to send to ${jid}:`, e.message);
        // Optional: Decide if you want to retry later or ignore. 
        // Currently we do NOT mark as sent, so it will be retried in next batch.
      }
    }

    batchCount++;
    console.log(`✅ Batch #${batchCount} complete.`);
  }
}

// === ENTRY POINT ===
(async () => {
  console.log("🚀 Bot Starting...");
  await startBot();
})();
