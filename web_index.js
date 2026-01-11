// === IMPORTS ===
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { createClient } = require('@supabase/supabase-js');

// === CONFIG (UPDATE WITH NEW KEY) ===
const SUPABASE_URL = "https://tjdepqtouvbwqrakarkh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqZGVwcXRvdXZid3FyYWthcmtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDkxODM4NTMsImV4cCI6MjA2NDc1OTg1M30.5sippZdNYf3uLISBOHHlJkphtlJc_Q1ZRTzX9E8WYb8"; 
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// === DELAY HELPER ===
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// === TODAY RANGE (PST) ===
function todayRangePST() {
    const now = new Date();
    const pstOffset = 5 * 60; // UTC+5
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
    const pstMs = utcMs + pstOffset * 60000;
    const pstNow = new Date(pstMs);

    const startPST = new Date(pstNow.getFullYear(), pstNow.getMonth(), pstNow.getDate(), 0, 0, 0);
    const endPST = new Date(pstNow.getFullYear(), pstNow.getMonth(), pstNow.getDate(), 23, 59, 59);

    const startUTC = new Date(startPST.getTime() - pstOffset * 60000);
    const endUTC = new Date(endPST.getTime() - pstOffset * 60000);

    return { startUTC, endUTC };
}

// === FETCH MESSAGES ===
async function fetchTodayMessages() {
    console.log("🔄 Fetching from Supabase...");
    
    // 1. Get unsent
    const { data, error } = await supabase
        .from("messages")
        .select("id, number, text, sent, created_at")
        .eq("sent", false)
        .order("created_at", { ascending: true });
    
    if (error) {
        console.error("Supabase Error:", error.message);
        return [];
    }

    // 2. Deduplicate
    const seen = new Set();
    const dupIds = [];
    for (const m of data) {
        const key = `${m.number}|${m.text}`;
        if (seen.has(key)) dupIds.push(m.id);
        else seen.add(key);
    }
    if (dupIds.length) {
        console.log(`🗑️ Removing ${dupIds.length} duplicates...`);
        await supabase.from("messages").delete().in("id", dupIds);
    }

    // 3. Filter Date
    const { startUTC, endUTC } = todayRangePST();
    const { data: todays } = await supabase
        .from("messages")
        .select("id, number, text, created_at")
        .eq("sent", false)
        .gte("created_at", startUTC.toISOString())
        .lte("created_at", endUTC.toISOString())
        .order("created_at", { ascending: true });

    return todays || [];
}

// === FORMAT NUMBER ===
function formatNumber(number) {
    let raw = number.toString().replace(/[^0-9]/g, "");
    if (raw.startsWith("0") && raw.length === 11) raw = "92" + raw.slice(1);
    
    // whatsapp-web.js uses @c.us
    if (raw.startsWith("92") && raw.length === 12) return `${raw}@c.us`;
    return null;
}

// === MAIN BOT SETUP ===
const client = new Client({
    authStrategy: new LocalAuth(), // Saves session to .wwebjs_auth folder
    puppeteer: {
        headless: true, // Set to false if you want to see the browser open
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

// === EVENTS ===

client.on('qr', (qr) => {
    console.log('⚡ Scan this QR Code:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
    console.log('✅ Client is ready!');
    
    // Start the sending process
    await processMessages();
});

client.on('auth_failure', (msg) => {
    console.error('❌ Authentication failure:', msg);
    process.exit(1);
});

// === SENDING LOGIC ===
async function processMessages() {
    try {
        const messages = await fetchTodayMessages();

        if (messages.length === 0) {
            console.log("⚠️ No messages to send today.");
            process.exit(0);
        }

        console.log(`🚀 Starting to send ${messages.length} messages...`);

        for (const msg of messages) {
            const jid = formatNumber(msg.number);
            
            if (!jid) {
                console.log(`❌ Invalid Number: ${msg.number}`);
                continue;
            }

            try {
                // Send via whatsapp-web.js
                await client.sendMessage(jid, msg.text);
                
                // Update Supabase
                await supabase.from("messages").update({ sent: true }).eq("id", msg.id);
                console.log(`✅ Sent to ${msg.number}`);

                // 🛑 Anti-Ban Delay (3 to 10 seconds)
                // Since you are using browser automation, random delays are CRITICAL
                const waitTime = Math.floor(Math.random() * 7000) + 3000; 
                await delay(waitTime);

            } catch (err) {
                console.error(`❌ Failed to send to ${jid}:`, err.message);
                // Wait a bit longer on error
                await delay(5000);
            }
        }

        console.log("🏁 All messages processed.");
        
        // Optional: Destroy client to close browser
        await client.destroy();
        process.exit(0);

    } catch (err) {
        console.error("🔥 Fatal Error in processing:", err);
        process.exit(1);
    }
}

// === START ===
console.log("Initializing WhatsApp Web...");
client.initialize();
