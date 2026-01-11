// === IMPORTS ===
const {
  createSocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  BotUtils
} = require("@bagah/whatsapp-lib");

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");
const qrcode = require("qrcode-terminal");

// === CONFIG ===
const SUPABASE_URL = "https://tjdepqtouvbwqrakarkh.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqZGVwcXRvdXZid3FyYWthcmtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDkxODM4NTMsImV4cCI6MjA2NDc1OTg1M30.5sippZdNYf3uLISBOHHlJkphtlJc_Q1ZRTzX9E8WYb8";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// === DELAY HELPER ===
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// === TIME RANGE HELPER ===
function todayRangePST() {
  const now = new Date();
  const pstOffset = 5 * 60; // PST is UTC+5
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const pstMs = utcMs + pstOffset * 60000;
  const pstNow = new Date(pstMs);

  const startPST = new Date(pstNow.getFullYear(), pstNow.getMonth(), pstNow.getDate(), 0, 0, 0);
  const endPST = new Date(pstNow.getFullYear(), pstNow.getMonth(), pstNow.getDate(), 23, 59, 59);

  const startUTC = new Date(startPST.getTime() - pstOffset * 60000);
  const endUTC = new Date(endPST.getTime() - pstOffset * 60000);

  console.log(`📅 Pakistan today: ${startPST.toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })} → ${endPST.toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}`);
  return { startUTC, endUTC };
}

// === FETCH UNSENT TODAY MESSAGES ===
async function fetchTodayMessages() {
  console.log("🗑️ Cleaning duplicates and fetching today’s messages...");

  const { data, error } = await supabase
    .from("messages")
    .select("id, number, text, sent, created_at")
    .eq("sent", false)
    .order("created_at", { ascending: true });

  if (error) throw new Error("Supabase fetch failed: " + error.message);

  // Remove duplicates
  const seen = new Set();
  const dupIds = [];
  for (const m of data) {
    const key = `${m.number}|${m.text}`;
    if (seen.has(key)) dupIds.push(m.id);
    else seen.add(key);
  }
  if (dupIds.length) {
    await supabase.from("messages").delete().in("id", dupIds);
    console.log(`✔️ Deleted ${dupIds.length} duplicates`);
  }

  // Fetch today’s messages
  const { startUTC, endUTC } = todayRangePST();
  const { data: todays, error: e2 } = await supabase
    .from("messages")
    .select("id, number, text, created_at")
    .eq("sent", false)
    .gte("created_at", startUTC.toISOString())
    .lte("created_at", endUTC.toISOString())
    .order("created_at", { ascending: true });

  if (e2) throw new Error("Supabase fetch failed: " + e2.message);
  console.log(`✅ Found ${todays.length} unsent messages for today (PST)`);
  return todays;
}

// === MARK MESSAGE SENT ===
async function markAsSent(id) {
  const { error } = await supabase.from("messages").update({ sent: true }).eq("id", id);
  if (error) console.error(`⚠️ Could not mark ${id}:`, error.message);
}

// === FORMAT JID ===
function formatJid(number) {
  return BotUtils.formatPhone(number);
}

// === START WHATSAPP BOT ===
async function startBot(messages) {
  const authFolder = path.join(__dirname, "auth_info");

  // Reset auth if folder incomplete
  if (fs.existsSync(authFolder)) {
    const files = fs.readdirSync(authFolder);
    if (!files.includes("creds.json")) {
      console.log("⚠️ Auth folder incomplete, resetting...");
      fs.rmSync(authFolder, { recursive: true, force: true });
    }
  }

  // Force fresh login if needed
  const { state, saveCreds } = await useMultiFileAuthState(authFolder, true);
  const { version } = await fetchLatestBaileysVersion();

  const sock = createSocket({
    auth: state,
    version,
    printQRInTerminal: false, // we'll handle QR manually
    browser: ["Chrome", "Windows", "105.0.0"], // realistic browser info
  });

  sock.ev.on("creds.update", saveCreds);

  let sessionReady = false;

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Print QR explicitly
    if (qr) {
      console.log("🔗 Scan this QR to connect with WhatsApp:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("✅ Connected to WhatsApp");
      sessionReady = true;

      // Only send messages when session is fully ready
      if (messages.length) {
        console.log(`📨 Sending ${messages.length} messages...`);
        for (let i = 0; i < messages.length; i++) {
          const { id, number, text } = messages[i];
          const jid = formatJid(number);
          if (!jid) continue;

          try {
            await sock.sendMessage(jid, { text });
            console.log(`✔️ Sent to ${jid}`);
            await markAsSent(id);
          } catch (e) {
            console.error(`⚠️ Failed to send to ${jid}:`, e.message);
          }

          // Randomized human-like delays
          if ((i + 1) % 80 === 0) await delay(40000 + Math.floor(Math.random() * 5000));
          else await delay(5000 + Math.floor(Math.random() * 3000));
        }
        console.log("🏁 Finished sending all messages for today (PST)");
        process.exit(0);
      }
    }

    if (connection === "close") {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        console.log("🔄 Reconnecting in 5s...");
        await delay(5000);
        startBot(messages);
      } else {
        console.log("❌ Logged out. Remove auth_info folder to reconnect.");
      }
    }
  });
}

// === ENTRY POINT ===
(async () => {
  try {
    const msgs = await fetchTodayMessages();
    if (!msgs.length) {
      console.log("⚠️ No unsent messages for today (PST). Exiting.");
      process.exit(0);
    }

    await startBot(msgs);
  } catch (err) {
    console.error("❌ Fatal:", err);
    process.exit(1);
  }
})();

