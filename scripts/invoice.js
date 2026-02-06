// ==========================================
//  SCHOOL INVOICE AUTOMATION (LIVE PRODUCTION)
//  ** SENDS TO ACTUAL STUDENT NUMBERS **
// ==========================================

const fs = require('fs');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const { createClient } = require('@supabase/supabase-js');
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const P = require('pino');

// --- CONFIGURATION ---
const INPUT_EXCEL = 'data.xlsx';
const SUPABASE_URL = "https://tjdepqtouvbwqrakarkh.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqZGVwcXRvdXZid3FyYWthcmtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDkxODM4NTMsImV4cCI6MjA2NDc1OTg1M30.5sippZdNYf3uLISBOHHlJkphtlJc_Q1ZRTzX9E8WYb8";
const AUTH_FOLDER = 'auth_session_stable';

// --- COLOR PALETTE ---
const COLORS = {
    brand: '#1F2937',    // Dark Charcoal
    accent: '#B91C1C',   // Red
    sub_bg: '#F9FAFB',   // Very Light Grey
    header_text: '#FFF',
    text: '#374151',     // Dark Grey
    border: '#E5E7EB'    // Light Border
};

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const delay = ms => new Promise(res => setTimeout(res, ms));

// ==========================================
//  1. PDF GENERATION ENGINE (CLEAN & PARENT COPY ONLY)
// ==========================================

async function generateInvoicePDF(data, outputPath) {
    return new Promise((resolve, reject) => {
        // A4 Portrait, standard margins
        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        const stream = fs.createWriteStream(outputPath);
        doc.pipe(stream);

        const pageW = 595.28; // A4 Width
        const margin = 50;
        const contentW = pageW - (margin * 2);

        // --- HEADER BACKGROUND ---
        doc.rect(0, 0, pageW, 140).fill(COLORS.brand);

        // --- SCHOOL INFO (Left) ---
        doc.fillColor(COLORS.header_text).font('Helvetica-Bold').fontSize(24)
            .text("DAR-E-ARQAM SCHOOL", margin, 45);
        
        doc.fillColor('#D1D5DB').font('Helvetica').fontSize(10)
            .text("Q MODEL TOWN CAMPUS", margin, 75)
            .text("Phone: +92 323 4447292", margin, 90);

        // --- INVOICE BADGE (Right) ---
        doc.fillColor(COLORS.header_text).font('Helvetica-Bold').fontSize(16)
            .text("FEE VOUCHER", 0, 45, { align: 'right', width: pageW - margin });
        
        doc.fillColor('#9CA3AF').fontSize(10)
            .text("PARENT COPY", 0, 70, { align: 'right', width: pageW - margin });

        // --- METADATA STRIP (Floating White Box) ---
        const metaY = 120;
        const metaH = 80;
        
        // Shadow/Border for the info box
        doc.roundedRect(margin, metaY, contentW, metaH, 5).fill(COLORS.header_text);
        doc.lineWidth(0.5).strokeColor(COLORS.border)
            .roundedRect(margin, metaY, contentW, metaH, 5).stroke();

        // Data Columns inside the box
        const col1X = margin + 20;
        const col2X = margin + 250;
        const textY = metaY + 20;
        const lineHeight = 15;

        doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(10);
        
        // Column 1 (Student Info)
        doc.text("Student Name:", col1X, textY);
        doc.font('Helvetica').text(data.name, col1X + 80, textY);
        
        doc.font('Helvetica-Bold').text("Father Name:", col1X, textY + lineHeight);
        doc.font('Helvetica').text(data.father, col1X + 80, textY + lineHeight);

        doc.font('Helvetica-Bold').text("Class:", col1X, textY + (lineHeight*2));
        doc.font('Helvetica').text(`${data.grade} - ${data.sec}`, col1X + 80, textY + (lineHeight*2));

        // Column 2 (Inv Info)
        doc.font('Helvetica-Bold').text("Invoice #:", col2X, textY);
        doc.font('Helvetica').text(data.inv, col2X + 70, textY);

        doc.font('Helvetica-Bold').text("Reg ID:", col2X, textY + lineHeight);
        doc.font('Helvetica').text(data.reg, col2X + 70, textY + lineHeight);

        doc.font('Helvetica-Bold').fillColor(COLORS.accent).text("Due Date:", col2X, textY + (lineHeight*2));
        doc.font('Helvetica-Bold').text(data.due_date, col2X + 70, textY + (lineHeight*2));

        // --- FEE TABLE ---
        let cursorY = metaY + metaH + 40;

        // Table Header
        doc.rect(margin, cursorY, contentW, 25).fill(COLORS.brand);
        doc.fillColor(COLORS.header_text).font('Helvetica-Bold').fontSize(10)
            .text("DESCRIPTION", margin + 15, cursorY + 8)
            .text("AMOUNT (PKR)", 0, cursorY + 8, { align: 'right', width: pageW - (margin + 15) });
        
        cursorY += 25;

        // Table Rows
        const fees = [];
        if (data.current > 0) fees.push(["Tuition Fee", data.current]);
        if (data.arrears > 0) fees.push(["Arrears", data.arrears]);
        if (data.annual > 0)  fees.push(["Annual Charges", data.annual]);
        if (data.stationery > 0) fees.push(["Stationery", data.stationery]);

        fees.forEach((row, i) => {
            const rowH = 30;
            if (i % 2 === 0) doc.rect(margin, cursorY, contentW, rowH).fill(COLORS.sub_bg);

            doc.fillColor(COLORS.text).font('Helvetica').fontSize(10)
                .text(row[0], margin + 15, cursorY + 10);
            
            doc.text(row[1].toLocaleString(), 0, cursorY + 10, { align: 'right', width: pageW - (margin + 15) });
            
            cursorY += rowH;
        });

        // --- TOTAL ROW ---
        cursorY += 10;
        doc.moveTo(margin, cursorY).lineTo(pageW - margin, cursorY).strokeColor(COLORS.brand).lineWidth(1.5).stroke();
        
        cursorY += 10;
        doc.font('Helvetica-Bold').fontSize(14).fillColor(COLORS.brand)
            .text("TOTAL PAYABLE", margin + 15, cursorY);
        
        doc.fontSize(14).fillColor(COLORS.accent)
            .text(`Rs. ${data.total.toLocaleString()}`, 0, cursorY, { align: 'right', width: pageW - (margin + 15) });


        // --- FOOTER / INSTRUCTIONS ---
        const footerY = 700;
        doc.moveTo(margin, footerY).lineTo(pageW - margin, footerY).strokeColor('#E5E7EB').lineWidth(1).stroke();

        doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.brand)
            .text("Instructions:", margin, footerY + 15);

        doc.font('Helvetica').fontSize(8).fillColor('#6B7280')
            .text("1. Please pay the fee before the 10th of the month.", margin, footerY + 30)
            .text("2. A late fee of Rs. 50 per day will be charged after the due date.", margin, footerY + 42)
            .text("3. This is a computer-generated invoice and requires no signature.", margin, footerY + 54);

        doc.end();
        stream.on('finish', resolve);
        stream.on('error', reject);
    });
}

// ==========================================
//  2. DATA PROCESSING
// ==========================================

function getColVal(row, headers, keys) {
    const colIndex = headers.findIndex(h => {
        if (!h) return false;
        const cleanH = h.toString().toLowerCase().replace(/[^a-z]/g, '');
        return keys.some(k => cleanH.includes(k));
    });
    return colIndex > -1 ? row.getCell(colIndex + 1).value : null;
}

async function readExcelData() {
    console.log("📊 Reading Excel...");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(INPUT_EXCEL);
    const sheet = workbook.getWorksheet(1);
    const headers = sheet.getRow(1).values.slice(1);
    const invoices = [];

    sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const id = getColVal(row, headers, ['id', 'reg','Student ID']);
        if (id) {
            const current = parseFloat(getColVal(row, headers, ['current', 'tuition']) || 0);
            const arrears = parseFloat(getColVal(row, headers, ['arrears','arrear']) || 0);
            const annual = parseFloat(getColVal(row, headers, ['annual']) || 0);
            const stationery = parseFloat(getColVal(row, headers, ['stationery']) || 0);
            
            invoices.push({
                id: id.toString(),
                name: getColVal(row, headers, ['name']) || 'Student',
                father: getColVal(row, headers, ['father']) || '',
                grade: getColVal(row, headers, ['grade']) || '',
                sec: getColVal(row, headers, ['sec']) || '',
                inv: getColVal(row, headers, ['inv']) || Date.now(),
                due_date: '10-Feb',
                current, arrears, annual, stationery,
                total: current + arrears + annual + stationery
            });
        }
    });
    console.log(`✅ Loaded ${invoices.length} invoices.`);
    return invoices;
}

async function getMobileFromSupabase(studentId) {
    const { data, error } = await supabase.from('students').select('mobilenumber').eq('studentid', studentId).single();
    if (error || !data) return null;
    return data.mobilenumber;
}

// ==========================================
//  3. BAILEYS ORCHESTRATOR
// ==========================================

async function startBaileys() {
    if (!fs.existsSync(INPUT_EXCEL)) {
        console.error("❌ 'data.xlsx' not found!"); return;
    }
    
    // Auth State
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: P({ level: 'silent' }),
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log("📸 Scan QR Code:");
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBaileys();
        } 
        
        else if (connection === 'open') {
            console.log("\n🚀 WhatsApp Connected! Starting LIVE PRODUCTION Batch Process...");
            await processBatch(sock);
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// ==========================================
//  4. BATCH SENDER LOGIC (LIVE PRODUCTION)
// ==========================================

async function processBatch(sock) {
    const invoices = await readExcelData();
    let sentCount = 0;

    for (let i = 0; i < invoices.length; i++) {
        const inv = invoices[i];
        console.log(`\n[${i+1}/${invoices.length}] Processing ${inv.name} (${inv.id})...`);

        // A. Lookup Mobile Number from DB
        const rawMobile = await getMobileFromSupabase(inv.id);
        
        if (!rawMobile) {
            console.log(`   ❌ Skipped: No number found in Database for ID ${inv.id}`);
            continue;
        }

        // B. Sanitize Number for WhatsApp (Convert 03xx to 923xx)
        // 1. Remove non-digits
        let cleanNumber = rawMobile.toString().replace(/\D/g, '');
        // 2. Replace leading '0' with '92'
        if (cleanNumber.startsWith('0')) {
            cleanNumber = '92' + cleanNumber.slice(1);
        }
        // 3. Append suffix
        const whatsappID = `${cleanNumber}@s.whatsapp.net`;

        console.log(`   📞 Sending to: ${cleanNumber}`);

        // C. Generate PDF
        const pdfName = `inv_${inv.id}.pdf`;
        await generateInvoicePDF(inv, pdfName);

        // D. Send Message
        try {
            const caption = `Dear Parent,\n\nPlease find attached the fee voucher for *${inv.name}*.\nTotal Payable: *Rs. ${inv.total.toLocaleString()}*.\n\n_Dar-e-Arqam School_`;
            
            const pdfBuffer = fs.readFileSync(pdfName);

            await sock.sendMessage(whatsappID, { 
                document: pdfBuffer, 
                mimetype: 'application/pdf', 
                fileName: `Fee_Voucher_${inv.name}.pdf`,
                caption: caption
            });

            console.log(`   ✅ Invoice Sent Successfully.`);
            sentCount++;
        } catch (err) {
            console.error(`   ❌ Failed to send: ${err.message}`);
        }

        // E. Cleanup
        if (fs.existsSync(pdfName)) fs.unlinkSync(pdfName);
        
        // Safety Delay (Random 3-6s to avoid spam filters)
        await delay(Math.floor(Math.random() * 3000) + 3000);
    }

    console.log(`\n🏁 Production Batch Complete. Sent ${sentCount} invoices. Exiting...`);
    
    await delay(5000);
    process.exit(0);
}

// Start
startBaileys();
