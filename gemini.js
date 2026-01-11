// === IMPORTS ===
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const { createClient } = require('@supabase/supabase-js');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const fs = require('fs');

// === CONFIGURATION ===
// ⚠️ REPLACE WITH YOUR ACTUAL SUPABASE KEYS
const SUPABASE_URL = "https://tjdepqtouvbwqrakarkh.supabase.co";
const SUPABASE_ANON_KEY = "<YOUR_ANON_KEY>"; 

const AUTH_FOLDER = 'auth_info_baileys_gem'; // Folder where session is saved

// === INITIALIZE SUPABASE ===
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// === HELPER: DELAY ===
const delay = (ms) => new Promise(res => setTimeout(res, ms));

// === HELPER: TIME RANGE (UTC+5 / PKT) ===
function getTodayRange() {
    const now = new Date();
    const offsetMinutes = 5 * 60; // UTC+5
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
    const targetMs = utcMs + offsetMinutes * 60000;
    const targetDate = new Date(targetMs);

    const startTarget = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 0, 0, 0);
    const endTarget = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 23, 59, 59);

    // Convert back to UTC for Database Query
    const startUTC = new Date(startTarget.getTime() - offsetMinutes * 60000);
    const endUTC = new Date(endTarget.getTime() - offsetMinutes * 60000);

    return { startUTC, endUTC };
}

// === DATABASE FUNCTIONS ===
async function fetchTodayMessages() {
    const { startUTC, endUTC } = getTodayRange();
    
    // Fetch unsent messages for today
    const { data, error } = await supabase
        .from('messages')
        .select('id, number, text, created_at')
        .eq('sent', false)
        .gte('created_at', startUTC.toISOString())
        .lte('created_at', endUTC.toISOString())
        .order('created_at', { ascending: true });

    if (error) {
        console.error('❌ Supabase Error:', error.message);
        return [];
    }
    return data;
}

async function markAsSent(id) {
    const { error } = await supabase
        .from('messages')
        .update({ sent: true })
        .eq('id', id);
    
    if (error) console.error(`❌ Failed to mark msg ${id} as sent:`, error.message);
}

// === MAIN WHATSAPP LOGIC ===
async function connectToWhatsApp() {
    // 1. Load or Create Auth State
    // This looks for the 'auth_info_baileys' folder. If it exists, it loads the session.
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
    const { version } = await fetchLatestBaileysVersion();

    console.log(`Using WhatsApp v${version.join('.')}`);

    // 2. Create Socket Client
    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false, // ⚠️ Deprecated, we handle it manually below
        logger: pino({ level: 'silent' }), // Hide verbose logs
        browser: ['SupabaseBot', 'Chrome', '1.0.0'],
        // Optimizations to keep connection stable
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 10000,
        syncFullHistory: false
    });

    // 3. Handle Credential Updates (Saves session automatically)
    sock.ev.on('creds.update', saveCreds);

    // 4. Handle Connection Events
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // -> GENERATE QR CODE IF NEEDED
        if (qr) {
            console.log('\nPlease scan the QR code below to log in:\n');
            qrcode.generate(qr, { small: true });
        }

        // -> CONNECTION CLOSED
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('⚠️ Connection closed. Reconnecting...', shouldReconnect);
            
            if (shouldReconnect) {
                connectToWhatsApp(); // Auto-reconnect
            } else {
                console.log('❌ Logged out. Please delete the "auth_info_baileys" folder and restart to scan again.');
                process.exit(1);
            }
        } 
        
        // -> CONNECTION OPEN
        else if (connection === 'open') {
            console.log('✅ WhatsApp Connected!');
            await processMessages(sock);
        }
    });
}

// === MESSAGE PROCESSOR ===
async function processMessages(sock) {
    console.log('🔄 Checking for unsent messages...');
    
    try {
        const messages = await fetchTodayMessages();
        
        if (!messages || messages.length === 0) {
            console.log('✅ No unsent messages found for today.');
            // Optional: exit if you only want to run once. 
            // process.exit(0); 
            return;
        }

        console.log(`📬 Found ${messages.length} messages to send.`);

        for (const msg of messages) {
            // Format number: Remove non-digits, ensure @s.whatsapp.net suffix
            let number = msg.number.replace(/\D/g, ''); 
            const jid = number + '@s.whatsapp.net'; 

            try {
                // Send Message
                await sock.sendMessage(jid, { text: msg.text });
                console.log(`➡️ Sent to ${number}`);
                
                // Mark DB
                await markAsSent(msg.id);
                
                // Anti-ban delay (Random between 2s and 5s)
                const waitTime = Math.floor(Math.random() * 3000) + 2000;
                await delay(waitTime);

            } catch (sendError) {
                console.error(`❌ Failed to send to ${number}:`, sendError);
            }
        }
        console.log('🏁 Batch finished.');
        
    } catch (err) {
        console.error('Error in process loop:', err);
    }
}

// === START ===
connectToWhatsApp();
