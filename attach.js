// === IMPORTS ===
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { createClient } = require("@supabase/supabase-js");

// === SUPABASE CONFIG ===
const SUPABASE_URL = "https://tjdepqtouvbwqrakarkh.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqZGVwcXRvdXZid3FyYWthcmtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDkxODM4NTMsImV4cCI6MjA2NDc1OTg1M30.5sippZdNYf3uLISBOHHlJkphtlJc_Q1ZRTzX9E8WYb8";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// === HELPERS ===
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// --- FILE PATH INTELLISENSE (TAB COMPLETION) ---
function fileCompleter(line) {
  const currentDir = path.dirname(line) || ".";
  const partial = path.basename(line);

  try {
    const files = fs.readdirSync(currentDir);
    const hits = files.filter((c) => c.startsWith(partial));
    
    // Transform hits back to full relative paths for the user
    const resolvedHits = hits.map(h => 
      line.includes(path.sep) ? path.join(currentDir, h) : h
    );

    // If only one match and it's a directory, append separator
    if (resolvedHits.length === 1) {
        const p = resolvedHits[0];
        if (fs.statSync(p).isDirectory()) {
            return [[p + path.sep], line];
        }
    }

    return [resolvedHits.length ? resolvedHits : [], line];
  } catch (err) {
    return [[], line];
  }
}

// Initialize Readline with the completer
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  completer: fileCompleter, // <--- ACTIVATES TAB COMPLETION
});

const ask = (q) =>
  new Promise((resolve) => rl.question(q, (ans) => resolve(ans.trim())));

// Normalize Pakistan number to WhatsApp Web JS ID (@c.us)
function toWid(mobile) {
  if (!mobile) return null;
  const d = mobile.toString().replace(/\D/g, "");
  let e164 = null;

  if (d.startsWith("92") && d.length >= 12) e164 = d;
  else if (d.startsWith("0") && d.length === 11) e164 = "92" + d.slice(1);
  else if (d.startsWith("3") && d.length === 10) e164 = "92" + d;
  else if (d.startsWith("0092") && d.length >= 14) e164 = d.slice(2);

  return e164 ? `${e164}@c.us` : null;
}

// Fetch students from Supabase (Dynamic Filtering)
async function getStudentsByClasses(classIds, filterStatus) {
  // 1. Base Query
  let query = supabase
    .from("students")
    .select("studentid, name, fathername, mobilenumber, class_id, Clear") // Added 'clear'
    .in("class_id", classIds);

  // 2. Apply Filters
  if (filterStatus === "CLEARED") {
    console.log("🔍 Filtering: ONLY Cleared Students (true)");
    query = query.eq("Clear", true);
  } else if (filterStatus === "NOT_CLEARED") {
    console.log("🔍 Filtering: ONLY Non-Cleared Students (false)");
    query = query.eq("Clear", false); // Assuming false or null
  } else {
    console.log("🔍 Filtering: ALL Students");
  }

  const { data, error } = await query;

  if (error) {
    console.error("❌ Error fetching students:", error.message);
    process.exit(1);
  }

  const contacts = [];
  const seen = new Set();

  for (const s of data || []) {
    const wid = toWid(s.mobilenumber);
    if (!wid || seen.has(wid)) continue;
    seen.add(wid);

    contacts.push({
      studentid: s.studentid,
      name: s.name,
      fathername: s.fathername,
      class_id: s.class_id,
      Clear: s.Clear,
      wid,
    });
  }

  console.log(
    `✅ Found ${contacts.length} recipients.`
  );

  return contacts;
}

// === MAIN SENDING LOGIC ===
async function processQueue(client, recipients, baseMessage, media, includeDetails) {
  console.log("🚀 Starting bulk send...");
  let sent = 0;

  for (const r of recipients) {
    try {
      // 1. CONSTRUCT MESSAGE
      let finalMessage = baseMessage;
      
      if (includeDetails) {
        finalMessage = `*Student Name:* ${r.name}\n*Father Name:* ${r.fathername}\n*Status:* ${r.Clear ? "Cleared ✅" : "Pending ❌"}\n\n${baseMessage}`;
      }

      // 2. SEND
      if (media) {
        await client.sendMessage(r.wid, media, { caption: finalMessage });
      } else {
        await client.sendMessage(r.wid, finalMessage);
      }

      console.log(`✔️  [${sent + 1}/${recipients.length}] Sent to ${r.name}`);
    } catch (err) {
      console.error(`❌ Failed to send to ${r.name} (${r.wid}):`, err.message);
    }

    sent++;

    // 3. DELAYS
    if (sent < recipients.length) {
      if (sent % 50 === 0) {
        console.log("⏸  Taking a 30s safety break...");
        await delay(30000);
      } else {
        await delay(Math.floor(Math.random() * 2000) + 1500); 
      }
    }
  }

  console.log("\n🏁 Finished sending. Closing client...");
  await delay(3000);
  await client.destroy();
  process.exit(0);
}

// === MAIN ORCHESTRATOR ===
(async function main() {
  console.log("\n--- WhatsApp Web JS Bulk Sender ---\n");

  // 1. Get Class IDs
  const classInput = await ask("Enter class_id(s) (comma/space separated): ");
  const classIds = classInput
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => (isNaN(Number(x)) ? x : Number(x)));

  if (classIds.length === 0) {
    console.log("⚠️ No class IDs. Exiting.");
    rl.close();
    return;
  }

  // 2. === NEW FILTER LOGIC ===
  console.log("\nWho should receive this?");
  console.log("[1] All Students");
  console.log("[2] Only Cleared (True)");
  console.log("[3] Only Not Cleared (False)");
  const filterInput = await ask("Select option (1-3): ");
  
  let filterStatus = "ALL";
  if (filterInput === "2") filterStatus = "CLEARED";
  if (filterInput === "3") filterStatus = "NOT_CLEARED";

  // 3. Get Students (With Filter)
  const recipients = await getStudentsByClasses(classIds, filterStatus);
  if (!recipients.length) {
    console.log("⚠️ No students found matching criteria. Exiting.");
    rl.close();
    return;
  }

  // 4. Get Media (With Tab Completion)
  let media = null;
  const attach = (await ask("\nAttach a file? (y/n): ")).toLowerCase();
  if (attach === "y") {
    // Note: Tab completion is active here!
    const fp = await ask("Enter file path (Use TAB to autocomplete): ");
    
    // Clean quotes if user dragged/dropped file
    const cleanPath = fp.replace(/['"]+/g, '');
    
    if (fs.existsSync(cleanPath)) {
      media = MessageMedia.fromFilePath(cleanPath);
      console.log(`📎 Attached: ${path.basename(cleanPath)}`);
    } else {
      console.log("⚠️ File not found. Sending without attachment.");
    }
  }

  // 5. Get Message
  let textMessage = await ask("\nEnter message text (blank = '.'): ");
  if (!textMessage) textMessage = ".";

  // 6. Ask for Details
  const detailInput = await ask("Include Student Name/Father/Status in message? (y/n): ");
  const includeDetails = detailInput.toLowerCase() === 'y'; 

  rl.close();

  // 7. Start WhatsApp
  console.log("\n🔄 Initializing WhatsApp Client...");
  
  const client = new Client({
    authStrategy: new LocalAuth({ clientId: "student-sender" }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
  });

  client.on("qr", (qr) => {
    console.log("\n📸  Scan the QR code below:\n");
    qrcode.generate(qr, { small: true });
  });

  client.on("ready", async () => {
    console.log("\n✅ WhatsApp Client is Ready!");
    await processQueue(client, recipients, textMessage, media, includeDetails);
  });

  client.initialize();
})();
