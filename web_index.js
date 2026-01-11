// === IMPORTS ===
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { createClient } = require('@supabase/supabase-js');

// === CONFIG ===
const SUPABASE_URL = "https://tjdepqtouvbwqrakarkh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqZGVwcXRvdXZid3FyYWthcmtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDkxODM4NTMsImV4cCI6MjA2NDc1OTg1M30.5sippZdNYf3uLISBOHHlJkphtlJc_Q1ZRTzX9E8WYb8"; 
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// === HELPER: DELAY ===
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// === HELPER: FORMAT DATE (UTC) ===
function getThreeDaysAgoISO() {
    const d = new Date();
    d.setDate(d.getDate() - 3); // Look back 3 days to catch any pending tests
    return d.toISOString();
}

// === FORMAT NUMBER HELPER ===
function formatNumber(number) {
    if (!number) return null;
    let raw = number.toString().replace(/[^0-9]/g, "");
    
    // Auto-fix Pakistani numbers
    if (raw.startsWith("0") && raw.length === 11) raw = "92" + raw.slice(1);
    if (raw.startsWith("3") && raw.length === 10) raw = "92" + raw;
    
    // whatsapp-web.js requires @c.us suffix
    if (raw.startsWith("92") && raw.length === 12) return `${raw}@c.us`;
    
    return null;
}

// === CORE FUNCTION: FETCH & CLEAN MESSAGES ===
async function fetchAndCleanMessages() {
    console.log("🔄 Fetching unsent messages (Last 3 Days)...");

    // 1. Fetch EVERYTHING Unsent (Recent)
    const { data, error } = await supabase
        .from("messages")
        .select("id, number, text, sent, created_at")
        .eq("sent", false)
        .gte("created_at", getThreeDaysAgoISO()) // Safety: Don't fetch ancient history
        .order("created_at", { ascending: true });

    if (error) {
        console.error("❌ Supabase Error:", error.message);
        return [];
    }

    if (!data || data.length === 0) {
        return [];
    }

    // 2. Intelligent Deduplication (In-Memory)
    const uniqueMessages = [];
    const seenMap = new Map(); // key -> message object
    const idsToDelete = [];

    for (const m of data) {
        // Create a unique signature for the message
        const sig = `${m.number}-${m.text.trim()}`;

        if (seenMap.has(sig)) {
            // This is a duplicate! 
            // Mark this ID to be deleted from DB so we don't fetch it again
            idsToDelete.push(m.id);
        } else {
            // This is the first time we see this message. Keep it.
            seenMap.set(sig, m);
            uniqueMessages.push(m);
        }
    }

    // 3. Clean up the database (Remove duplicates)
    if (idsToDelete.length > 0) {
        console.log(`🗑️ Cleaning up ${idsToDelete.length} duplicate entries in Supabase...`);
        await supabase.from("messages").delete().in("id", idsToDelete);
    }

    console.log(`✅ Found ${uniqueMessages.length} valid, unique messages to send.`);
    return uniqueMessages;
}

// === MAIN BOT SETUP ===
const client = new Client({
    // ⚠️ CRITICAL: MATCHING SCRIPT B ID
    authStrategy: new LocalAuth({ clientId: "student-sender" }), 
    puppeteer: {
        headless: true, 
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    }
});

// === WA CLIENT EVENTS ===

client.on('qr', (qr) => {
    console.log('\n⚠️  QR RECEIVED');
    console.log('If you see this, "student-sender" is NOT logged in.');
    console.log('Please run Script B first to scan the QR, then run this script again.\n');
    qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
    console.log('\n✅ WhatsApp Client is Ready!');
    console.log('🔗 Connected to Session: student-sender');
    
    await processQueue();
});

client.on('auth_failure', (msg) => {
    console.error('❌ Authentication Failed:', msg);
    console.error('Try deleting the .wwebjs_auth folder and re-scanning in Script B.');
    process.exit(1);
});

// === SENDING ORCHESTRATOR ===
async function processQueue() {
    try {
        // 1. Get the Clean List
        const messages = await fetchAndCleanMessages();

        // 2. Check if Empty
        if (messages.length === 0) {
            console.log("⚠️ No pending messages found.");
            console.log("Shutting down...");
            await client.destroy();
            process.exit(0);
        }

        console.log(`🚀 Starting send sequence for ${messages.length} messages...`);

        // 3. Loop and Send
        for (const msg of messages) {
            const jid = formatNumber(msg.number);
            
            if (!jid) {
                console.log(`❌ Skipped Invalid Number: ${msg.number}`);
                // Mark as sent so we don't retry invalid numbers forever
                await supabase.from("messages").update({ sent: true }).eq("id", msg.id);
                continue;
            }

            try {
                // A. Send Message
                await client.sendMessage(jid, msg.text);
                
                // B. Update Database immediately
                await supabase.from("messages").update({ sent: true }).eq("id", msg.id);
                
                console.log(`✅ Sent to ${msg.number}`);

                // C. Random Anti-Ban Delay (3s - 7s)
                const waitTime = Math.floor(Math.random() * 4000) + 3000; 
                await delay(waitTime);

            } catch (err) {
                console.error(`❌ Failed to send to ${jid}:`, err.message);
                // Wait a bit longer on error (10s)
                await delay(10000);
            }
        }

        console.log("\n🏁 All tasks completed.");
        await client.destroy();
        process.exit(0);

    } catch (err) {
        console.error("🔥 Fatal Crash:", err);
        process.exit(1);
    }
}

// === START ===
console.log("Initializing WhatsApp Web...");
client.initialize();
