// === IMPORTS ===
const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const qrcodeTerminal = require("qrcode-terminal");
const QRCode = require("qrcode");          // ✅ For PNG generation
const { createClient } = require("@supabase/supabase-js");
const path = require("path");
const fs = require("fs");

// === HARDCODED CONFIG ===
const SUPABASE_URL = "https://tjdepqtouvbwqrakarkh.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqZGVwcXRvdXZid3FyYWthcmtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDkxODM4NTMsImV4cCI6MjA2NDc1OTg1M30.5sippZdNYf3uLISBOHHlJkphtlJc_Q1ZRTzX9E8WYb8";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// === Delay helper ===
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// === TODAY RANGE in Pakistan Standard Time (UTC+5) ===
function todayRangePST() {
  const now = new Date();
  const pstOffset = 5 * 60; // minutes
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const pstMs = utcMs + pstOffset * 60000;
  const pstNow = new Date(pstMs);

  const startPST = new Date(pstNow.getFullYear(), pstNow.getMonth(), pstNow.getDate(), 0, 0, 0);
  const endPST   = new Date(pstNow.getFullYear(), pstNow.getMonth(), pstNow.getDate(), 23, 59, 59);

  const startUTC = new Date(startPST.getTime() - pstOffset * 60000);
  const endUTC   = new Date(endPST.getTime() - pstOffset * 60000);

  console.log(`📅 Pakistan today: ${startPST.toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })} → ${endPST.toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}`);
  return { startUTC, endUTC };
}

// === Deduplicate + fetch today's unsent messages ===
async function fetchTodayMessages() {
  console.log("🗑️ Cleaning duplicates and fetching today’s messages...");

  const { data, error } = await supabase
    .from("messages")
    .select("id, number, text, sent, created_at")
    .eq("sent", false)
    .order("created_at", { ascending: true });

  if (error) throw new Error("Supabase fetch failed: " + error.message);

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

// === Mark a message as sent ===
async function markAsSent(id) {
  const { error } = await supabase.from("messages").update({ sent: true }).eq("id", id);
  if (error) console.error(`⚠️ Could not mark ${id}:`, error.message);
}

// === Convert number to WhatsApp JID ===
function formatJid(number) {
  let raw = number.toString().replace(/[^0-9]/g, "");
  if (raw.startsWith("0") && raw.length === 11) raw = "92" + raw.slice(1);
  if (raw.startsWith("92") && raw.length === 12) return `${raw}@s.whatsapp.net`;
  return null;
}

// === WhatsApp bot ===
async function startBot(messages) {
  const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, "auth_info"));
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({ version, auth: state });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      // ✅ Terminal QR (for quick dev scanning)
      qrcodeTerminal.generate(qr, { small: true });

      // ✅ Persistent PNG saved to /tmp
      const outPath = "/tmp/whatsapp-qr.png";
      try {
        await QRCode.toFile(outPath, qr, { type: "png", width: 300 });
        console.log(`📂 QR code saved to ${outPath}`);
        console.log("👉 If running on Railway, open a shell and run:");
        console.log(`   cat ${outPath} > qrcode.png  (then download qrcode.png)`);
      } catch (err) {
        console.error("⚠️ Failed to save QR PNG:", err.message);
      }
    }

    if (connection === "close") {
      const shouldReconnect =
        (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        console.log("🔄 Reconnecting...");
        await delay(5000);
        startBot(messages);
      }
    }

    if (connection === "open") {
      console.log("✅ Connected to WhatsApp");
      let count = 0;
      for (const { id, text, number } of messages) {
        const jid = formatJid(number);
        if (!jid) continue;
        try {
          await sock.sendMessage(jid, { text });
          console.log(`✔️ Sent to ${jid}`);
          await markAsSent(id);
        } catch (e) {
          console.error(`⚠️ Failed to send to ${jid}:`, e.message);
        }
        count++;
        if (count % 80 === 0) await delay(40000);
        else await delay(5000);
      }
      console.log("🏁 Finished sending all messages for today (PST)");
      process.exit(0);
    }
  });
}

// === Entry point ===
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
