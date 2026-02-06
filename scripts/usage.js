/**
 * ============================================================================
 * 🧠 SCHOOL ANALYTICS INTELLIGENCE ENGINE (SAIE) - V2.0 PRO
 * ============================================================================
 * * FEATURES:
 * - Pagination Bypass (Fetch 10k+ rows)
 * - Deep Academic Linking (Tests <-> Marks)
 * - Strategic Insight Generation (Rule-based NLP)
 * - Attendance Ratio Analysis
 * - Operational Health Checks (HR, SMS, Admissions)
 * - Professional PDF Generation (CSS Grid/Flexbox)
 */

const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const { createClient } = require("@supabase/supabase-js");
const { startOfWeek, endOfDay, format, subDays, isSameDay } = require("date-fns");
const puppeteer = require("puppeteer");

// ======================
// 1. CONFIGURATION
// ======================
const CONFIG = {
  SUPABASE_URL: "https://tjdepqtouvbwqrakarkh.supabase.co",
  SUPABASE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqZGVwcXRvdXZid3FyYWthcmtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDkxODM4NTMsImV4cCI6MjA2NDc1OTg1M30.5sippZdNYf3uLISBOHHlJkphtlJc_Q1ZRTzX9E8WYb8",
  ADMIN_NUMBER: "923085333392@s.whatsapp.net",
  THRESHOLDS: {
    ACADEMIC_DANGER: 50, // Below 50% is danger
    ATTENDANCE_WARNING: 80, // Below 80% is warning
    UNMARKED_LIMIT: 3 // More than 3 unmarked tests is bad
  }
};

const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);

// ======================
// 2. DATA LAYER (The Fetch Engine)
// ======================
class DataEngine {
  constructor() {
    this.cache = new Map();
  }

  // 🔄 Pagination Handler: Breaking the 1000 row limit
  async fetchAll(table, select, dateCol = null, startDate = null, endDate = null, filters = {}) {
    let allRows = [];
    let rangeStart = 0;
    const step = 1000;
    let fetching = true;

    console.log(`📥 Fetching ${table}...`);

    while (fetching) {
      let query = supabase.from(table).select(select).range(rangeStart, rangeStart + step - 1);
      
      if (dateCol && startDate && endDate) {
        query = query.gte(dateCol, startDate).lte(dateCol, endDate);
      }
      
      for (const [key, val] of Object.entries(filters)) {
        query = query.eq(key, val);
      }

      const { data, error } = await query;
      if (error) throw new Error(`DB Error [${table}]: ${error.message}`);
      
      if (data && data.length > 0) {
        allRows = allRows.concat(data);
        rangeStart += step;
        if (data.length < step) fetching = false;
      } else {
        fetching = false;
      }
    }
    return allRows;
  }

  // 📅 Main Data Aggregator
  async getWeeklySnapshot() {
    const now = new Date();
    const startDate = format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd");
    const endDate = format(endOfDay(now), "yyyy-MM-dd");
    const period = `${startDate} to ${endDate}`;

    // Parallel Fetching for Speed
    const [
      classes, attendance, diaries, 
      tests, marks, complaints, 
      inquiries, staffAdvances, messages
    ] = await Promise.all([
      this.fetchAll("classes", "id, name"),
      this.fetchAll("attendance", "class_id, status, date", "date", startDate, endDate),
      this.fetchAll("diary", "class_id, date", "date", startDate, endDate),
      this.fetchAll("tests", "id, class_id, class_name, subject, date, test_name", "date", startDate, endDate),
      this.fetchAll("marks", "test_id, obtained_marks, total_marks"), // Need all marks to link to current tests
      this.fetchAll("complaints", "status, created_at", "created_at", startDate, endDate),
      this.fetchAll("inquiries", "id, status", "date", startDate, endDate),
      this.fetchAll("staff_advances", "amount, status", "requested_at", startDate, endDate),
      this.fetchAll("messages", "sent", "created_at", startDate, endDate)
    ]);

    return { 
      classes, attendance, diaries, tests, marks, 
      complaints, inquiries, staffAdvances, messages, period 
    };
  }
}

// ======================
// 3. ANALYTICS LAYER (The Brain)
// ======================
class AnalyticsEngine {
  constructor(rawData) {
    this.raw = rawData;
    this.report = [];
    this.globalStats = {};
  }

  process() {
    // 1. Build Class Map
    const classMap = new Map();
    this.raw.classes.forEach(c => {
      classMap.set(c.id, c.name);
      // Initialize Report Object
      this.report.push({
        classId: c.id,
        className: c.name,
        attendance: { total: 0, present: 0, absent: 0, percentage: 0 },
        academics: { subjects: {}, average: 0, unmarkedCount: 0, unmarkedDetails: [] },
        operations: { diaryDays: 0 },
        insights: []
      });
    });

    // 2. 📊 Process Attendance (Ratio Analysis)
    this.raw.attendance.forEach(att => {
      const cIndex = this.report.findIndex(r => r.classId == att.class_id);
      if (cIndex > -1) {
        const entry = this.report[cIndex];
        entry.attendance.total++;
        if (att.status === 'Present' || att.status === 'Late') {
          entry.attendance.present++;
        } else {
          entry.attendance.absent++;
        }
      }
    });

    // Calculate Percentages
    this.report.forEach(r => {
      if (r.attendance.total > 0) {
        r.attendance.percentage = ((r.attendance.present / r.attendance.total) * 100).toFixed(1);
      }
    });

    // 3. 🎓 Process Academics (Deep Dive)
    const marksMap = new Map(); // Group marks by test_id
    this.raw.marks.forEach(m => {
      if (!marksMap.has(m.test_id)) marksMap.set(m.test_id, { obtained: 0, total: 0, count: 0 });
      const t = marksMap.get(m.test_id);
      t.obtained += Number(m.obtained_marks || 0);
      t.total += Number(m.total_marks || 0);
      t.count++;
    });

    this.raw.tests.forEach(test => {
      // Resolve Class Name (Hybrid Logic: ID first, then Name string)
      let r = this.report.find(x => x.classId == test.class_id);
      if (!r && test.class_name) r = this.report.find(x => x.className === test.class_name);
      
      if (r) {
        // Check Marking Status
        const marksData = marksMap.get(test.id);
        
        if (!marksData || marksData.count === 0) {
          r.academics.unmarkedCount++;
          r.academics.unmarkedDetails.push(`${test.subject}: ${test.test_name}`);
        } else {
          // Calculate Subject Performance
          const sub = test.subject || "General";
          if (!r.academics.subjects[sub]) r.academics.subjects[sub] = { score: 0, count: 0 };
          
          const percentage = (marksData.obtained / marksData.total) * 100;
          r.academics.subjects[sub].score += percentage;
          r.academics.subjects[sub].count++;
        }
      }
    });

    // Average out subject scores
    this.report.forEach(r => {
      let totalScore = 0;
      let subjectCount = 0;
      for (const sub in r.academics.subjects) {
        const s = r.academics.subjects[sub];
        s.finalAvg = (s.score / s.count).toFixed(1);
        totalScore += parseFloat(s.finalAvg);
        subjectCount++;
      }
      r.academics.average = subjectCount ? (totalScore / subjectCount).toFixed(1) : 0;
    });

    // 4. 📝 Process Diaries
    const diarySet = new Set();
    this.raw.diaries.forEach(d => {
      diarySet.add(`${d.class_id}-${d.date}`);
    });
    this.report.forEach(r => {
      // Count how many unique days marked for this class in diary set
      // (Simplified estimation based on iteration of set vs class id)
      // For accurate count, we filter the raw set
      const count = Array.from(diarySet).filter(k => k.startsWith(`${r.classId}-`)).length;
      r.operations.diaryDays = count;
    });

    // 5. 🧠 Strategic Insight Generation (The "AI" Logic)
    this.report.forEach(r => {
      // Attendance Insight
      if (r.attendance.total > 0 && r.attendance.percentage < CONFIG.THRESHOLDS.ATTENDANCE_WARNING) {
        r.insights.push({ type: 'danger', text: `Attendance Critical (${r.attendance.percentage}%)` });
      }
      
      // Academic Insight
      if (r.academics.average > 0 && r.academics.average < CONFIG.THRESHOLDS.ACADEMIC_DANGER) {
        r.insights.push({ type: 'danger', text: `Academic Performance Low (${r.academics.average}%)` });
      }

      // Operational Insight
      if (r.academics.unmarkedCount > CONFIG.THRESHOLDS.UNMARKED_LIMIT) {
        r.insights.push({ type: 'warning', text: `${r.academics.unmarkedCount} Unmarked Tests Pending` });
      }

      // Correlation Insight (The "Smart" Part)
      if (r.attendance.percentage < 75 && r.academics.average < 50 && r.academics.average > 0) {
        r.insights.unshift({ type: 'critical', text: `🚨 CORRELATION ALERT: Truancy affecting Grades.` });
      }
    });

    // 6. Global Stats
    this.globalStats = {
      inquiries: this.raw.inquiries.length,
      conversionRate: this.raw.inquiries.filter(i => i.status === 'Admitted').length,
      hrPending: this.raw.staffAdvances.filter(a => a.status === 'pending').length,
      hrValue: this.raw.staffAdvances.filter(a => a.status === 'pending').reduce((a,b)=>a+Number(b.amount),0),
      smsSent: this.raw.messages.filter(m => m.sent).length,
      smsFailed: this.raw.messages.filter(m => !m.sent).length,
      complaintsOpen: this.raw.complaints.filter(c => c.status !== 'Resolved').length
    };

    return { details: this.report, globals: this.globalStats, period: this.raw.period };
  }
}

// ======================
// 4. PRESENTATION LAYER (PDF)
// ======================
async function generateHighEndPDF(data) {
  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Inter:wght@300;400;600;800&display=swap" rel="stylesheet">
    <style>
      :root {
        --primary: #2563eb; --secondary: #1e40af; --accent: #f59e0b;
        --danger: #dc2626; --success: #16a34a; --bg: #f8fafc; --surface: #ffffff;
      }
      body { font-family: 'Inter', sans-serif; background: var(--bg); color: #0f172a; padding: 40px; -webkit-print-color-adjust: exact; }
      
      /* HEADER */
      .header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #0f172a; padding-bottom: 20px; margin-bottom: 40px; }
      .brand h1 { font-size: 32px; font-weight: 800; letter-spacing: -1px; margin: 0; text-transform: uppercase; }
      .brand p { color: #64748b; font-size: 14px; margin: 5px 0 0; font-weight: 500; }
      .meta { text-align: right; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #64748b; }

      /* EXECUTIVE GRID */
      .exec-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin-bottom: 40px; }
      .stat-card { background: var(--surface); padding: 20px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); border-top: 4px solid var(--primary); }
      .stat-card.danger { border-top-color: var(--danger); }
      .stat-card.warn { border-top-color: var(--accent); }
      .stat-val { font-size: 36px; font-weight: 800; color: #0f172a; line-height: 1; margin-bottom: 5px; }
      .stat-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; font-weight: 700; }
      .stat-sub { font-size: 11px; color: #94a3b8; margin-top: 5px; }

      /* CLASS TABLE */
      .section-title { font-size: 18px; font-weight: 800; margin-bottom: 20px; display: flex; align-items: center; gap: 10px; }
      .section-title::before { content: ''; width: 6px; height: 24px; background: var(--primary); display: block; border-radius: 2px; }
      
      .data-table { width: 100%; border-collapse: separate; border-spacing: 0 10px; }
      .data-table th { text-align: left; color: #64748b; font-size: 11px; text-transform: uppercase; padding: 0 15px; font-weight: 700; }
      .data-row { background: var(--surface); box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
      .data-row td { padding: 15px; vertical-align: middle; border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; }
      .data-row td:first-child { border-left: 1px solid #e2e8f0; border-top-left-radius: 8px; border-bottom-left-radius: 8px; font-weight: 700; color: var(--secondary); }
      .data-row td:last-child { border-right: 1px solid #e2e8f0; border-top-right-radius: 8px; border-bottom-right-radius: 8px; }

      /* COMPONENTS */
      .progress-track { width: 80px; height: 6px; background: #e2e8f0; border-radius: 10px; display: inline-block; margin-right: 8px; }
      .progress-fill { height: 100%; border-radius: 10px; }
      .pill { padding: 4px 8px; border-radius: 6px; font-size: 10px; font-weight: 700; display: inline-block; margin: 2px; }
      .pill.danger { background: #fee2e2; color: #991b1b; }
      .pill.warn { background: #fef3c7; color: #92400e; }
      .pill.success { background: #dcfce7; color: #166534; }
      .pill.critical { background: #7f1d1d; color: white; border: 1px solid #991b1b; }

      .subject-grid { display: flex; gap: 5px; flex-wrap: wrap; }
      .sub-score { font-size: 10px; background: #f1f5f9; padding: 2px 5px; border-radius: 3px; color: #475569; }
      
      /* FOOTER */
      .footer { margin-top: 50px; border-top: 1px solid #cbd5e1; padding-top: 20px; font-size: 10px; color: #94a3b8; display: flex; justify-content: space-between; }
    </style>
  </head>
  <body>
    
    <div class="header">
      <div class="brand">
        <h1>Intelligence Report</h1>
        <p>Strategic Academic & Operational Analysis</p>
      </div>
      <div class="meta">
        REPORT ID: #${Math.floor(Math.random() * 10000)}<br>
        PERIOD: ${data.period}<br>
        GENERATED: ${new Date().toLocaleString()}
      </div>
    </div>

    <div class="exec-grid">
      <div class="stat-card">
        <div class="stat-val">${data.globals.inquiries}</div>
        <div class="stat-label">New Leads</div>
        <div class="stat-sub">Admissions Funnel</div>
      </div>
      <div class="stat-card ${data.globals.hrPending > 0 ? 'warn' : ''}">
        <div class="stat-val">$${data.globals.hrValue}</div>
        <div class="stat-label">Pending Advances</div>
        <div class="stat-sub">${data.globals.hrPending} Requests Waiting</div>
      </div>
      <div class="stat-card ${data.globals.complaintsOpen > 0 ? 'danger' : ''}">
        <div class="stat-val">${data.globals.complaintsOpen}</div>
        <div class="stat-label">Open Issues</div>
        <div class="stat-sub">Complaints & Tickets</div>
      </div>
      <div class="stat-card">
        <div class="stat-val">${((data.globals.smsSent / (data.globals.smsSent + data.globals.smsFailed || 1))*100).toFixed(0)}%</div>
        <div class="stat-label">SMS Health</div>
        <div class="stat-sub">${data.globals.smsFailed} Failed Deliveries</div>
      </div>
    </div>

    <div class="section-title">Class Performance Matrix</div>
    <table class="data-table">
      <thead>
        <tr>
          <th width="15%">Class</th>
          <th width="20%">Attendance Health</th>
          <th width="25%">Subject Performance (Avg %)</th>
          <th width="40%">Strategic Insights & Operations</th>
        </tr>
      </thead>
      <tbody>
        ${data.details.map(row => {
          const attColor = row.attendance.percentage < 80 ? '#ef4444' : '#22c55e';
          const acadColor = row.academics.average < 50 ? '#ef4444' : '#3b82f6';
          
          return `
          <tr class="data-row">
            <td>
              ${row.className}<br>
              <span style="font-size:10px; font-weight:400; color:#94a3b8;">ID: ${row.classId}</span>
            </td>
            
            <td>
              <div style="font-weight:800; font-size:14px; color:${attColor};">${row.attendance.percentage}%</div>
              <div class="progress-track"><div class="progress-fill" style="width:${row.attendance.percentage}%; background:${attColor}"></div></div>
              <div style="font-size:10px; color:#64748b; margin-top:2px;">
                ${row.attendance.present} Pres / ${row.attendance.absent} Abs
              </div>
            </td>

            <td>
               <div style="font-weight:800; font-size:14px; margin-bottom:4px; color:${acadColor};">
                 ${row.academics.average > 0 ? row.academics.average + '%' : 'No Data'}
               </div>
               <div class="subject-grid">
                 ${Object.entries(row.academics.subjects).map(([sub, stats]) => 
                   `<span class="sub-score"><strong>${sub.substring(0,3)}</strong> ${parseFloat(stats.finalAvg).toFixed(0)}%</span>`
                 ).join('')}
               </div>
            </td>

            <td>
              ${row.insights.length > 0 ? 
                row.insights.map(i => `<span class="pill ${i.type}">${i.text}</span>`).join('') 
                : `<span class="pill success" style="opacity:0.5">Operations Normal</span>`
              }
              ${row.operations.diaryDays < 3 ? `<span class="pill warn">Low Diary (${row.operations.diaryDays} days)</span>` : ''}
              
              ${row.academics.unmarkedCount > 0 ? `
                <div style="margin-top:8px; font-size:10px; color:#ef4444; background:#fef2f2; padding:5px; border-radius:4px;">
                  <strong>⚠️ Unmarked Tests:</strong><br>
                  ${row.academics.unmarkedDetails.slice(0,2).join(', ')}
                  ${row.academics.unmarkedDetails.length > 2 ? `...(+${row.academics.unmarkedDetails.length-2})` : ''}
                </div>
              ` : ''}
            </td>
          </tr>
          `
        }).join('')}
      </tbody>
    </table>

    <div class="footer">
      <div>School Analytics Intelligence Engine (SAIE) v2.0</div>
      <div>CONFIDENTIAL DOCUMENT</div>
    </div>

  </body>
  </html>
  `;

  const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: 20, bottom: 20, left: 20, right: 20 } });
  await browser.close();
  return pdf;
}

// ======================
// 5. BOT CONTROLLER
// ======================
async function startBot() {
  console.log("🤖 Booting SAIE v2.0...");
  const { state, saveCreds } = await useMultiFileAuthState("auth_session_stable");
  const sock = makeWASocket({ auth: state, printQRInTerminal: true });
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;
    
    if (connection === "close") {
      const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) startBot();
    } 
    
    else if (connection === "open") {
      console.log("✅ Connected to WhatsApp.");
      
      try {
        // 1. Fetch
        const db = new DataEngine();
        const rawData = await db.getWeeklySnapshot();
        
        // 2. Analyze
        const analytics = new AnalyticsEngine(rawData);
        const results = analytics.process();
        
        // 3. Generate
        const pdfBuffer = await generateHighEndPDF(results);
        
        // 4. Send
        const caption = `📊 *Weekly Strategic Intelligence Report*\n\n` +
          `🗓️ _Period: ${results.period}_\n\n` +
          `🚨 *Executive Attention Required:*\n` +
          `- Unmarked Tests detected in ${results.details.filter(d=>d.academics.unmarkedCount > 0).length} classes.\n` +
          `- ${results.globals.hrPending} Pending Staff Advance Requests ($${results.globals.hrValue})\n` +
          `- ${results.globals.complaintsOpen} Unresolved Complaints.\n\n` +
          `_Detailed class-wise forensics attached._`;

        await sock.sendMessage(CONFIG.ADMIN_NUMBER, { 
          document: pdfBuffer, 
          mimetype: 'application/pdf', 
          fileName: `Strategic_Report_${format(new Date(), 'yyyy-MM-dd')}.pdf`,
          caption: caption
        });

        console.log("🚀 Intelligence Report Dispatched.");
        setTimeout(() => process.exit(0), 5000);

      } catch (err) {
        console.error("❌ CRITICAL FAILURE:", err);
        process.exit(1);
      }
    }
  });
}

startBot();
