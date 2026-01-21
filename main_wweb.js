const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const { createClient } = require('@supabase/supabase-js');
const qrcode = require('qrcode');
const { registerFont, createCanvas, loadImage } = require('canvas');

// === CONFIG ===
const SUPABASE_URL = "https://tjdepqtouvbwqrakarkh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqZGVwcXRvdXZid3FyYWthcmtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDkxODM4NTMsImV4cCI6MjA2NDc1OTg1M30.5sippZdNYf3uLISBOHHlJkphtlJc_Q1ZRTzX9E8WYb8";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let mainWindow;
let whatsappClient;
let isClientReady = false;
let abortSending = false; 

// === WINDOW SETUP ===
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 900,
        backgroundColor: '#1e1e1e',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false, // Essential for internal tools
            webSecurity: false       // Helps with local resources
        },
        autoHideMenuBar: true
    });

    mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

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
    return e164 ? `${e164}@c.us` : null;
}

// ============================================================
// === 🛠️ FILE HANDLING (NEW: Base64 Logic) ===
// ============================================================
// We no longer read from disk. We take the Base64 sent from UI.
function createMediaFromBase64(base64Data, filename, mimetype) {
    try {
        if (!base64Data) return null;
        // Remove data:image/png;base64, prefix if present
        const b64 = base64Data.split(',')[1] || base64Data;
        return new MessageMedia(mimetype, b64, filename);
    } catch (error) {
        console.error("Error creating media:", error);
        return null;
    }
}

// ============================================================
// === 🎨 PREMIUM NOTICE GENERATOR ===
// ============================================================
function calculateTextLines(ctx, text, maxWidth) {
    const paragraphs = text.split('\n');
    let allLines = [];
    paragraphs.forEach((paragraph) => {
        if (paragraph.trim() === '') {
            allLines.push({ text: '', isSpacer: true });
            return;
        }
        const words = paragraph.split(' ');
        let currentLine = words[0];
        for (let i = 1; i < words.length; i++) {
            const word = words[i];
            const width = ctx.measureText(currentLine + " " + word).width;
            if (width < maxWidth) {
                currentLine += " " + word;
            } else {
                allLines.push({ text: currentLine, isSpacer: false });
                currentLine = word;
            }
        }
        allLines.push({ text: currentLine, isSpacer: false });
    });
    return allLines;
}

function drawPinIcon(ctx, x, y, size, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / 100, size / 100);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(50, 0); ctx.bezierCurveTo(22.4, 0, 0, 22.4, 0, 50);
    ctx.bezierCurveTo(0, 85, 50, 100, 50, 100); ctx.bezierCurveTo(50, 100, 100, 85, 100, 50);
    ctx.bezierCurveTo(100, 22.4, 77.6, 0, 50, 0); ctx.fill();
    ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(50, 50, 18, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
}

function drawPhoneIcon(ctx, x, y, size, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / 24, size / 24); 
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(6, 4); ctx.lineTo(9, 4); ctx.lineTo(10, 7); ctx.lineTo(8, 9); 
    ctx.quadraticCurveTo(10, 14, 15, 16); ctx.lineTo(17, 14); ctx.lineTo(20, 15); 
    ctx.lineTo(20, 19); ctx.lineTo(19, 20); ctx.bezierCurveTo(10, 20, 4, 14, 4, 5); 
    ctx.lineTo(6, 4); ctx.fill();
    ctx.restore();
}

async function generateNoticeImage(text) {
    const fontPath = path.join(__dirname, 'revue.ttf');
    const hasCustomFont = fs.existsSync(fontPath);
    if (hasCustomFont) registerFont(fontPath, { family: 'Revue' });

    const width = 1200;
    const padding = 100;
    const textAreaWidth = width - (padding * 2);
    
    // Colors
    const C_NAVY = '#0a192f';   
    const C_GOLD = '#d4af37';   
    const C_BG_OUT = '#eef2f5'; 
    const C_PAPER = '#ffffff';  
    const C_TEXT_HEAD = '#0a192f';
    const C_TEXT_BODY = '#1a1a1a'; 

    const headerFont = hasCustomFont ? 'bold 70px "Revue"' : 'bold 70px "Times New Roman"';
    const bodyFont = '36px "Georgia"';
    
    const lineHeight = 55;
    const paragraphGap = 30;

    const dummyCanvas = createCanvas(width, 100);
    const dummyCtx = dummyCanvas.getContext('2d');
    dummyCtx.font = bodyFont;
    const lines = calculateTextLines(dummyCtx, text, textAreaWidth);
    
    let calculatedTextHeight = 0;
    lines.forEach(line => {
        if (line.isSpacer) calculatedTextHeight += paragraphGap;
        else calculatedTextHeight += lineHeight;
    });

    const headerHeight = 350;
    const footerHeight = 250; 
    const paperHeight = headerHeight + 50 + 120 + calculatedTextHeight + footerHeight;
    const canvasHeight = paperHeight + 100;

    const canvas = createCanvas(width, canvasHeight);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = C_BG_OUT;
    ctx.fillRect(0, 0, width, canvasHeight);

    const paperX = 40;
    const paperY = 50;
    const paperW = width - 80;
    
    ctx.shadowColor = "rgba(0,0,0,0.15)";
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 15;
    ctx.fillStyle = C_PAPER;
    ctx.fillRect(paperX, paperY, paperW, paperHeight);
    ctx.shadowBlur = 0; 
    ctx.shadowOffsetY = 0;

    ctx.strokeStyle = C_NAVY;
    ctx.lineWidth = 3;
    ctx.strokeRect(paperX + 20, paperY + 20, paperW - 40, paperHeight - 40);
    ctx.strokeStyle = C_GOLD;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(paperX + 30, paperY + 30, paperW - 60, paperHeight - 60);

    const logoPath = path.join(__dirname, 'logo.png');
    let logoImage = null;
    const logoSize = 180;
    const headerContentStartY = paperY + 70;

    if (fs.existsSync(logoPath)) {
        logoImage = await loadImage(logoPath);
        ctx.save();
        ctx.globalAlpha = 0.05; 
        const wmSize = 800;
        ctx.drawImage(logoImage, (width/2)-(wmSize/2), (canvasHeight/2)-(wmSize/2), wmSize, wmSize);
        ctx.restore();
        ctx.drawImage(logoImage, paperX + 60, headerContentStartY, logoSize, logoSize);
    }

    const textStartX = paperX + 60 + logoSize + 40;
    const textCenterY = headerContentStartY + (logoSize / 2);

    ctx.textAlign = 'left';
    ctx.fillStyle = C_TEXT_HEAD;
    ctx.font = headerFont;
    ctx.fillText('DAR-E-ARQAM', textStartX, textCenterY - 10);
    ctx.fillText('SCHOOL', textStartX, textCenterY + 60);

    const dividerY = headerContentStartY + logoSize + 40;
    ctx.beginPath();
    ctx.moveTo(paperX + 60, dividerY);
    ctx.lineTo(paperX + paperW - 60, dividerY);
    ctx.strokeStyle = C_GOLD;
    ctx.lineWidth = 3;
    ctx.stroke();

    const dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    ctx.textAlign = 'right';
    ctx.font = 'bold 26px Arial';
    ctx.fillStyle = '#444';
    ctx.fillText(dateStr, paperX + paperW - 70, dividerY + 40);

    let cursorY = dividerY + 100;
    ctx.textAlign = 'left';
    ctx.fillStyle = C_TEXT_BODY;
    ctx.font = 'bold 40px "Georgia"';
    ctx.fillText("Respected Parents,", padding + 20, cursorY);
    cursorY += 70; 

    ctx.font = bodyFont;
    ctx.fillStyle = '#222';
    
    for (const line of lines) {
        if (line.isSpacer) {
            cursorY += paragraphGap;
        } else {
            ctx.fillText(line.text, padding + 20, cursorY);
            cursorY += lineHeight;
        }
    }

    const footerStartY = (paperY + paperHeight) - 160; 
    const centerX = width / 2;
    
    ctx.font = '28px Arial';
    let textWidth = ctx.measureText("583 Q Block, Model Town, Lahore").width;
    let iconSize = 32;
    let iconGap = 15;
    let startX = centerX - ((iconSize + iconGap + textWidth) / 2);
    drawPinIcon(ctx, startX, footerStartY - 24, iconSize, C_GOLD);
    ctx.fillStyle = C_NAVY;
    ctx.textAlign = 'left';
    ctx.fillText("583 Q Block, Model Town, Lahore", startX + iconSize + iconGap, footerStartY);

    ctx.font = 'bold 36px Arial';
    textWidth = ctx.measureText("0323 - 4447292").width;
    startX = centerX - ((iconSize + iconGap + textWidth) / 2);
    drawPhoneIcon(ctx, startX, footerStartY + 60 - 24, iconSize, C_GOLD);
    ctx.fillText("0323 - 4447292", startX + iconSize + iconGap, footerStartY + 60);

    const buffer = canvas.toBuffer('image/png');
    // We can return buffer directly or save temp. Saving temp is safer for MessageMedia.
    const tempPath = path.join(app.getPath('temp'), `notice_hq_${Date.now()}.png`);
    fs.writeFileSync(tempPath, buffer);
    
    // Read it back as B64 to standardize our Media Object approach
    const b64 = fs.readFileSync(tempPath, { encoding: 'base64' });
    return new MessageMedia('image/png', b64, 'Notice.png');
}

// === IPC LISTENERS ===
ipcMain.handle('get-classes', async () => {
    try {
        const { data, error } = await supabase.from("classes").select("name").order('name', { ascending: true });
        if(error) throw error;
        return data.map(i => i.name);
    } catch (e) {
        console.error("DB Error:", e);
        return [];
    }
});

// === INIT WHATSAPP ===
ipcMain.on('init-whatsapp', () => {
    if (whatsappClient) return;

    whatsappClient = new Client({
        authStrategy: new LocalAuth({ clientId: "student-sender" }),
        puppeteer: { 
            headless: true, 
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] 
        }
    });

    whatsappClient.on('qr', (qr) => {
        qrcode.toDataURL(qr, (err, url) => mainWindow.webContents.send('wa-qr', url));
        mainWindow.webContents.send('log', '>> Scan QR Code to connect.');
    });

    whatsappClient.on('ready', () => {
        isClientReady = true;
        mainWindow.webContents.send('wa-ready');
        mainWindow.webContents.send('log', '>> WhatsApp Connected Successfully!');
    });

    whatsappClient.initialize();
});

ipcMain.on('stop-sending', () => {
    abortSending = true;
    mainWindow.webContents.send('log', '🛑 Stopping process requested by user...');
});

// === START SENDING (WRAPPER) ===
ipcMain.on('start-sending', async (event, payload) => {
    // Top-level Try/Catch to ensure errors get logged to UI
    try {
        await handleSendingProcess(payload);
    } catch (criticalError) {
        console.error(criticalError);
        mainWindow.webContents.send('log', `❌ CRITICAL ERROR: ${criticalError.message}`);
        mainWindow.webContents.send('sending-finished');
    }
});

async function handleSendingProcess(payload) {
    const { classNames, filterStatus, messageText, fileData, fileName, mimeType, isNoticeMode, includeDetails } = payload;
    
    abortSending = false;
    mainWindow.webContents.send('log', '>> Starting Bulk Sender...');
    mainWindow.webContents.send('log', '>> Fetching students from Database...');

    let query = supabase.from("students").select("*, classes!inner(name)").in("classes.name", classNames);
    if (filterStatus === "CLEARED") query = query.eq("Clear", true);
    if (filterStatus === "NOT_CLEARED") query = query.eq("Clear", false);

    const { data: students, error } = await query;

    if (error) {
        throw new Error(`Supabase Error: ${error.message}`);
    }

    if (!students || students.length === 0) {
        mainWindow.webContents.send('log', '>> ⚠️ No students found for this selection.');
        mainWindow.webContents.send('sending-finished');
        return;
    }

    const recipients = [];
    const seen = new Set();
    for (const s of students) {
        const wid = toWid(s.mobilenumber);
        if (!wid || seen.has(wid)) continue;
        seen.add(wid);
        recipients.push({ ...s, class_name: s.classes ? s.classes.name : "Unknown", wid });
    }

    mainWindow.webContents.send('log', `>> Found ${recipients.length} valid recipients.`);
    
    // --- PREPARE MEDIA ---
    let media = null;
    let isGeneratedNotice = false;

    // 1. Check for manual file attachment (Base64 from UI)
    if (fileData) {
        mainWindow.webContents.send('log', `>> 📁 Processing Attachment: ${fileName}`);
        media = createMediaFromBase64(fileData, fileName, mimeType);
        
        if (media) {
            mainWindow.webContents.send('log', `>> ✅ Attachment Ready (${media.mimetype})`);
        } else {
            mainWindow.webContents.send('log', `>> ❌ Failed to process attachment.`);
        }
    }
    // 2. Check for Notice Mode
    else if (isNoticeMode) {
        mainWindow.webContents.send('log', '>> 🎨 Generating Premium Notice...');
        media = await generateNoticeImage(messageText); // returns MessageMedia object now
        isGeneratedNotice = true;
    }

    // --- SENDING LOOP ---
    let sentCount = 0;
    for (const r of recipients) {
        if (abortSending) {
            mainWindow.webContents.send('log', '🛑 Sending Aborted.');
            break;
        }

        try {
            let captionText = "";
            let studentDetails = "";

            if (includeDetails) {
                studentDetails = `*Student:* ${r.name}\n*Father:* ${r.fathername}\n*Status:* ${r.Clear ? "Cleared ✅" : "Pending ❌"}`;
            }

            if (isGeneratedNotice) {
                // Image Notice Mode
                captionText = studentDetails;
            } else if (media) {
                // File Mode
                captionText = messageText; 
                if (studentDetails) captionText += `\n\n${studentDetails}`;
            } else {
                // Text Mode
                captionText = messageText;
                if (studentDetails) captionText = `${studentDetails}\n\n${messageText}`;
            }

            if (media) {
                await whatsappClient.sendMessage(r.wid, media, { caption: captionText.trim() });
            } else {
                await whatsappClient.sendMessage(r.wid, captionText.trim());
            }

            mainWindow.webContents.send('log', `✅ Sent to ${r.name}`);
            sentCount++;
            mainWindow.webContents.send('progress', { current: sentCount, total: recipients.length });

            // Delays
            if (sentCount % 50 === 0) {
                mainWindow.webContents.send('log', '⏸ Taking a 30s safety break...');
                await delay(30000);
            } else {
                await delay(Math.floor(Math.random() * 2000) + 1500); 
            }

        } catch (e) {
            mainWindow.webContents.send('log', `❌ Failed ${r.name}: ${e.message}`);
        }
    }

    mainWindow.webContents.send('log', '🏁 Bulk sending finished.');
    mainWindow.webContents.send('sending-finished'); 
}
