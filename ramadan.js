const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { registerFont, createCanvas, loadImage } = require('canvas');
const moment = require('moment');

// --- 1. CONFIGURATION ---
const EXCEL_FILE = 'datar.xlsx';
const OUTPUT_DIR = './output';
const LOGO_PATH = 'logo.png'; 

// Theme Colors: Royal Navy & Gold
const COLORS = {
    bg: '#FAFAFA',             
    primary: '#002147',        // Royal Navy Blue
    secondary: '#C5A059',      // Metallic Gold
    textMain: '#2C3E50',        
    textLight: '#FFFFFF',
    archBg: '#F4F6F7'          // Light grey for inside the arch
};

// --- 2. FONT REGISTRATION ---
try {
    registerFont('jnn.ttf', { family: 'UrduFont' });
    registerFont('revue.ttf', { family: 'Revue' }); 
} catch (e) {
    console.warn("Warning: Fonts not found. Please ensure jnn.ttf and revue.ttf are present.");
}

const FONT_URDU = '"UrduFont", "Arial", sans-serif'; 
const FONT_BRAND = '"Revue", "Impact", sans-serif'; 
const FONT_ENG = '"Century Gothic", "Segoe UI", sans-serif'; 

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

// --- 3. DATA HANDLER ---
function getOrMakeData() {
    if (fs.existsSync(EXCEL_FILE)) {
        const wb = XLSX.readFile(EXCEL_FILE);
        const sheet = wb.Sheets[wb.SheetNames[0]];
        return XLSX.utils.sheet_to_json(sheet);
    } else {
        return [{
            date: '06-02-2026',
            hijri: '6',
            day: 'Friday',
            hadith: 'مسلمان مسلمان کا بھائی ہے، نہ اس پر ظلم کرتا ہے اور نہ اسے بے یار و مددگار چھوڑتا ہے۔',
            reference: 'صحیح بخاری: 123',
            sehr: '04:15 AM',
            iftaar: '06:46 PM'
        }];
    }
}

// --- 4. DRAWING HELPERS ---

const toUrduDigits = (str) => {
    return str.toString().replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
};

function drawCorner(ctx, x, y, size, rotation) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(size, 0);
    ctx.lineTo(size, size/4);
    ctx.quadraticCurveTo(size/2, size/4, size/4, size/2);
    ctx.lineTo(0, size);
    ctx.closePath();
    ctx.fillStyle = COLORS.secondary;
    ctx.fill();
    ctx.restore();
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

// B - CHANGE: Better Vector Phone Icon
function drawPhoneIcon(ctx, x, y, size) {
    ctx.save();
    ctx.translate(x, y);
    const scale = size / 24; // Base path on 24px grid
    ctx.scale(scale, scale);
    ctx.fillStyle = COLORS.secondary;
    ctx.beginPath();
    // Standard Phone Receiver Path
    ctx.moveTo(6.62, 10.79);
    ctx.bezierCurveTo(8.06, 13.62, 10.38, 15.94, 13.21, 17.38);
    ctx.lineTo(15.41, 15.18);
    ctx.bezierCurveTo(15.69, 14.9, 16.08, 14.82, 16.43, 14.93);
    ctx.bezierCurveTo(17.55, 15.3, 18.75, 15.5, 20, 15.5);
    ctx.bezierCurveTo(20.55, 15.5, 21, 15.95, 21, 16.5);
    ctx.lineTo(21, 20);
    ctx.bezierCurveTo(21, 20.55, 20.55, 21, 20, 21);
    ctx.bezierCurveTo(9.5, 21, 1, 12.5, 1, 2);
    ctx.bezierCurveTo(1, 1.45, 1.45, 1, 2, 1);
    ctx.lineTo(5.5, 1);
    ctx.bezierCurveTo(6.05, 1, 6.5, 1.45, 6.5, 2);
    ctx.bezierCurveTo(6.5, 3.25, 6.7, 4.45, 7.07, 5.57);
    ctx.bezierCurveTo(7.18, 5.92, 7.1, 6.31, 6.82, 6.59);
    ctx.lineTo(6.62, 10.79);
    ctx.fill();
    ctx.restore();
}

function drawDynamicText(ctx, text, x, y, maxWidth, maxHeight, fontFace) {
    let fontSize = 60; 
    let lines = [];
    let lineHeight = fontSize * 1.6;

    do {
        ctx.font = `${fontSize}px ${fontFace}`;
        lineHeight = fontSize * 1.6;
        lines = [];
        const words = text.split(' ');
        let currentLine = words[0];

        for (let i = 1; i < words.length; i++) {
            const width = ctx.measureText(currentLine + " " + words[i]).width;
            if (width < maxWidth) {
                currentLine += " " + words[i];
            } else {
                lines.push(currentLine);
                currentLine = words[i];
            }
        }
        lines.push(currentLine);
        
        const totalHeight = lines.length * lineHeight;
        if (totalHeight <= maxHeight) break;
        
        fontSize -= 2; 
    } while (fontSize > 20);

    const totalBlockHeight = lines.length * lineHeight;
    let currentY = y - (totalBlockHeight / 2) + (lineHeight / 2); 

    lines.forEach(line => {
        ctx.fillText(line, x, currentY);
        currentY += lineHeight;
    });
}

// --- 5. MAIN GENERATOR ---
async function generateImage(row, index) {
    const width = 1080;
    const height = 1080;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // 1. Background
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, width, height);

    // Pattern Watermark
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 33, 71, 0.04)';
    ctx.lineWidth = 2;
    for(let i=0; i<width; i+=60) {
        ctx.beginPath(); ctx.arc(i, height/2, 300, 0, Math.PI*2); ctx.stroke();
    }
    ctx.restore();

    // 2. Main Border
    const pad = 30;
    ctx.strokeStyle = COLORS.primary;
    ctx.lineWidth = 3;
    ctx.strokeRect(pad, pad, width - pad*2, height - pad*2);
    
    // Corners
    const cSize = 60;
    drawCorner(ctx, pad, pad, cSize, 0); 
    drawCorner(ctx, width-pad, pad, cSize, Math.PI/2); 
    drawCorner(ctx, width-pad, height-pad, cSize, Math.PI); 
    drawCorner(ctx, pad, height-pad, cSize, -Math.PI/2); 


    // --- HEADER SECTION ---
    const headerH = 180;
    const margin = 80;

    const [d, m, y] = row.date.split('-'); 
    const mDate = moment(`${y}-${m}-${d}`);
    const engMonthYear = mDate.format('MMMM YYYY').toUpperCase(); 
    
    const hDay = toUrduDigits(row.hijri || "01");
    const hMonth = "رمضان المبارک";
    const hYear = "۱۴۴۷";

    // English Date (Left)
    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.primary;
    ctx.font = `bold 80px ${FONT_ENG}`;
    ctx.fillText(d, margin + 40, margin + 50);
    
    ctx.fillStyle = COLORS.secondary;
    ctx.font = `bold 18px ${FONT_ENG}`;
    ctx.fillText(engMonthYear, margin + 40, margin + 90);

    // Center Badge
    const badgeW = 340;
    const badgeH = 100;
    const badgeX = (width - badgeW) / 2;
    const badgeY = margin;

    ctx.fillStyle = COLORS.primary;
    ctx.beginPath();
    ctx.moveTo(badgeX, badgeY); 
    ctx.lineTo(badgeX + badgeW, badgeY); 
    ctx.lineTo(badgeX + badgeW, badgeY + badgeH - 20); 
    ctx.quadraticCurveTo(badgeX + badgeW/2, badgeY + badgeH + 20, badgeX, badgeY + badgeH - 20); 
    ctx.closePath();
    ctx.fill();
    
    ctx.strokeStyle = COLORS.secondary;
    ctx.lineWidth = 4;
    ctx.stroke();

    const urduDays = {
        'Sunday': 'اتوار', 'Monday': 'پیر', 'Tuesday': 'منگل', 'Wednesday': 'بدھ',
        'Thursday': 'جمعرات', 'Friday': 'جمعہ', 'Saturday': 'ہفتہ'
    };
    const urduDay = urduDays[row.day] || row.day;

    ctx.fillStyle = '#fff';
    ctx.font = `bold 45px ${FONT_URDU}`;
    ctx.fillText(urduDay, width/2, badgeY + 50);
    
    ctx.font = `bold 20px ${FONT_ENG}`;
    ctx.fillStyle = COLORS.secondary;
    ctx.fillText(row.day.toUpperCase(), width/2, badgeY + 85);

    // Hijri Date
    ctx.fillStyle = COLORS.primary;
    ctx.font = `bold 80px ${FONT_URDU}`;
    ctx.fillText(hDay, width - margin - 50, margin + 50);

    ctx.fillStyle = COLORS.secondary;
    ctx.font = `22px ${FONT_URDU}`;
    ctx.fillText(`${hMonth} ${hYear}`, width - margin - 50, margin + 90);

    
    // --- BODY SECTION ---
    // A - CHANGE: Adjusted dimensions to fix overlap
    const bodyY = headerH + 120; 
    const bodyH = 460; // Reduced height to pull up from pills
    const archMargin = 100;
    const archW = width - (archMargin * 2);

    ctx.save();
    ctx.translate(archMargin, bodyY);
    ctx.beginPath();
    ctx.moveTo(0, bodyH); 
    ctx.lineTo(0, 80);    
    ctx.quadraticCurveTo(0, -50, archW/2, -80);
    ctx.quadraticCurveTo(archW, -50, archW, 80);
    ctx.lineTo(archW, bodyH); 
    ctx.closePath();
    
    ctx.fillStyle = COLORS.archBg;
    ctx.fill();
    ctx.strokeStyle = COLORS.secondary;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    // Hadees Label Pill
    const labelPillW = 320;
    const labelPillH = 65;
    const labelPillX = (width - labelPillW) / 2;
    const labelPillY = bodyY + 30;

    ctx.fillStyle = COLORS.secondary;
    drawRoundedRect(ctx, labelPillX, labelPillY, labelPillW, labelPillH, 30);
    ctx.fill();

    ctx.fillStyle = COLORS.primary;
    ctx.font = `bold 32px ${FONT_URDU}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText("حدیثِ نبوی ﷺ", width/2, labelPillY + (labelPillH/2) + 5);
    ctx.textBaseline = 'alphabetic';

    // Dynamic Hadith Text
    ctx.fillStyle = '#000';
    drawDynamicText(
        ctx, 
        row.hadith, 
        width/2, 
        bodyY + (bodyH/2) + 20, 
        archW - 60, 
        bodyH - 150, 
        "UrduFont"
    );

    ctx.fillStyle = '#666';
    ctx.font = `25px ${FONT_URDU}`;
    ctx.fillText(row.reference || "صحیح بخاری", width/2, bodyY + bodyH - 30);


    // --- FOOTER SECTION ---
    // C - CHANGE: Smaller footer
    const footerH = 170;
    const footerY = height - footerH;

    // A - CHANGE: Move Pills up based on new footer Y
    const pillW = 220;
    const pillH = 70;
    // Ensure gap between Body End (bodyY + bodyH) and Pill Start
    const pillY = footerY - 90; 
    const gap = 40;
    const pillRadius = 25;

    const centerX = width / 2;
    const sehrPillX = centerX - pillW - gap/2;
    const iftarPillX = centerX + gap/2;

    ctx.fillStyle = COLORS.secondary;
    drawRoundedRect(ctx, sehrPillX, pillY, pillW, pillH, pillRadius);
    ctx.fill();
    drawRoundedRect(ctx, iftarPillX, pillY, pillW, pillH, pillRadius);
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.primary;
    ctx.font = `bold 32px ${FONT_ENG}`;
    ctx.fillText(row.sehr, sehrPillX + (pillW/2), pillY + (pillH/2) + 5);
    ctx.fillText(row.iftaar, iftarPillX + (pillW/2), pillY + (pillH/2) + 5);

    ctx.font = `bold 45px ${FONT_URDU}`;
    ctx.lineWidth = 6;
    ctx.lineJoin = 'round';
    ctx.textBaseline = 'alphabetic';

    const labelOffset = pillY + 15;
    const drawOutlinedText = (text, x, y) => {
        ctx.strokeStyle = COLORS.bg;
        ctx.strokeText(text, x, y);
        ctx.fillStyle = COLORS.primary; 
        ctx.fillText(text, x, y);
    };

    drawOutlinedText("سحر", sehrPillX + (pillW/2), labelOffset);
    drawOutlinedText("افطار", iftarPillX + (pillW/2), labelOffset);

    // --- MAIN FOOTER ---
    ctx.fillStyle = COLORS.primary;
    ctx.beginPath();
    ctx.moveTo(pad, footerY);
    ctx.lineTo(width-pad, footerY);
    ctx.lineTo(width-pad, height-pad);
    ctx.lineTo(pad, height-pad);
    ctx.fill();

    // Logo & Branding
    const logoSize = 120; // Slightly smaller to fit tidy footer
    const logoX = pad + 40;
    const logoY = footerY + (footerH - logoSize)/2;

    try {
        if (fs.existsSync(LOGO_PATH)) {
            const logo = await loadImage(LOGO_PATH);
            ctx.drawImage(logo, logoX, logoY, logoSize, logoSize);
        }
    } catch(e) {}

    // C - CHANGE: Combined Row for Address and Phone
    const textStart = logoX + logoSize + 30;
    ctx.textAlign = 'left';
    
    // English School Name
    ctx.fillStyle = '#fff';
    ctx.font = `45px ${FONT_BRAND}`; 
    ctx.fillText("DAR-E-ARQAM SCHOOL", textStart, footerY + 65);

    // Address & Phone Row
    const addressText = "583 Q BLOCK MODEL TOWN";
    const phoneText = "0323 4447292";

    ctx.fillStyle = COLORS.secondary;
    ctx.font = `20px ${FONT_ENG}`;
    ctx.letterSpacing = "1px";
    
    // Draw Address
    ctx.fillText(addressText, textStart, footerY + 115);
    
    // Calculate space for icon
    const addrWidth = ctx.measureText(addressText).width;
    const iconX = textStart + addrWidth + 30;
    
    // Draw Phone Icon
    drawPhoneIcon(ctx, iconX, footerY + 98, 22);

    // Draw Phone Number
    ctx.fillStyle = '#fff'; // White for phone to pop
    ctx.font = `bold 22px ${FONT_ENG}`;
    ctx.fillText(phoneText, iconX + 35, footerY + 115);

    // --- SAVE ---
    const buffer = canvas.toBuffer('image/png');
    const safeDate = row.date.replace(/[\/\\]/g, '-');
    const fileName = path.join(OUTPUT_DIR, `post_${safeDate}_${index}.png`);
    fs.writeFileSync(fileName, buffer);
    console.log(`Generated: ${fileName}`);
}

// --- EXECUTION ---
(async () => {
    console.log("Starting...");
    try {
        const data = getOrMakeData();
        for (let i = 0; i < data.length; i++) {
            await generateImage(data[i], i);
        }
        console.log("Done!");
    } catch (e) {
        console.error(e);
    }
})();
