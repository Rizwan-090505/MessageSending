// === IMPORTS ===
const venom = require('venom-bot');
const { createClient } = require('@supabase/supabase-js');

// === CONFIG (REPLACE THESE WITH YOUR NEW KEYS) ===
const SUPABASE_URL = "https://tjdepqtouvbwqrakarkh.supabase.co";
const SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqZGVwcXRvdXZid3FyYWthcmtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDkxODM4NTMsImV4cCI6MjA2NDc1OTg1M30.5sippZdNYf3uLISBOHHlJkphtlJc_Q1ZRTzX9E8WYb8"// <--- UPDATE THIS
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// === Delay helper ===
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// === TODAY RANGE in Pakistan Standard Time (UTC+5) ===
function todayRangePST() {
  const now = new Date();
  const pstOffset = 5 * 60;
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const pstMs = utcMs + pstOffset * 60000;
  const pstNow = new Date(pstMs);

  const startPST = new Date(pstNow.getFullYear(), pstNow.getMonth(), pstNow.getDate(), 0, 0, 0);
  const endPST = new Date(pstNow.getFullYear(), pstNow.getMonth(), pstNow.getDate(), 23, 59, 59);

  const startUTC = new Date(startPST.getTime() - pstOffset * 60000);
  const endUTC = new Date(endPST.getTime() - pstOffset * 60000);

  return { startUTC, endUTC };
}

// === Deduplicate + fetch today's unsent messages ===
async function fetchTodayMessages() {
  console.log("🔄 Fetching messages...");
  
  // 1. Get all unsent messages
  const { data, error } = await supabase
    .from("messages")
    .select("id, number, text, sent, created_at")
    .eq("sent", false)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  // 2. Deduplicate logic
  const seen = new Set();
  const dupIds = [];
  for (const m of data) {
    const key = `${m.number}|${m.text}`;
    if (seen.has(key)) dupIds.push(m.id);
    else seen.add(key);
  }
  if (dupIds.length) {
    console.log(`🗑️ Deleting ${dupIds.length} duplicates...`);
    await supabase.from("messages").delete().in("id", dupIds);
  }

  // 3. Filter for Today (PST)
  const { startUTC, endUTC } = todayRangePST();
  const { data: todays, error: e2 } = await supabase
    .from("messages")
    .select("id, number, text, created_at")
    .eq("sent", false)
    .gte("created_at", startUTC.toISOString())
    .lte("created_at", endUTC.toISOString())
    .order("created_at", { ascending: true });

  if (e2) throw new Error(e2.message);
  console.log(`✅ Found ${todays.length} messages to send.`);
  return todays;
}

// === Mark a message as sent ===
async function markAsSent(id) {
  await supabase.from("messages").update({ sent: true }).eq("id", id);
}

// === Format number to WhatsApp JID ===
function formatNumber(number) {
  let raw = number.toString().replace(/[^0-9]/g, "");
  // Convert 03XX to 923XX
  if (raw.startsWith("0") && raw.length === 11) raw = "92" + raw.slice(1);
  // Ensure it starts with 92 and has correct length
  if (raw.startsWith("92") && raw.length === 12) return raw;
  return null;
}

// === Main Bot Logic ===
async function startBot(messages) {
  try {
    const client = await venom.create(
      'session-name', 
      (base64Qr, asciiQR) => {
        console.log(asciiQR); // Print QR to terminal if needed
      },
      (status) => {
        console.log("📡 Status:", status);
      },
      {
        headless: true, // Change to false if you need to debug visually
        devtools: false,
        useChrome: false, // Let Venom download its own Chromium (more stable)
        debug: false,
        logQR: true,
        browserArgs: [
          '--no-sandbox', 
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote'
        ] // These args prevent freezing on Linux/Servers
      }
    );

    console.log("✅ Venom Client Ready!");

    // Slight delay to ensure internal sync complete
    await delay(2000);

    for (const { id, number, text } of messages) {
      const formatted = formatNumber(number);
      if (!formatted) {
        console.warn(`⚠️ Invalid number format: ${number}`);
        continue;
      }
      
      const jid = `${formatted}@c.us`;
      console.log(`🚀 Sending to ${jid}...`);

      try {
        // Direct send - no manual WAPI check needed
        await client.sendText(jid, text);
        console.log(`👉 Sent to ${formatted}`);
        await markAsSent(id);
        
        // Anti-ban delay (Random 2-5 seconds)
        const wait = Math.floor(Math.random() * 3000) + 2000;
        await delay(wait);
        
      } catch (err) {
        console.error(`❌ Failed to send to ${jid}:`, err.message);
        // Continue to next message even if one fails
      }
    }

    console.log("🏁 All operations finished.");
    // Close session cleanly
    await client.close();
    process.exit(0);

  } catch (error) {
    console.error("❌ Bot Error:", error);
    process.exit(1);
  }
}

// === Entry point ===
(async () => {
  try {
    const messages = await fetchTodayMessages();
    if (!messages.length) {
      console.log("⚠️ No unsent messages today");
      process.exit(0);
    }
    await startBot(messages);
  } catch (err) {
    console.error("❌ Fatal:", err);
    process.exit(1);
  }
})();
