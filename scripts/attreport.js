const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const { createClient } = require("@supabase/supabase-js");
// CHANGE 1: Imported 'startOfWeek' instead of 'subDays'
const { startOfWeek, format } = require("date-fns");
const puppeteer = require("puppeteer");
const path = require("path");
const fs = require("fs");
const qrcodeTerminal = require("qrcode-terminal");

// === CONFIGURATION ===
// NOTE: Paste your original keys inside the quotes below
const SUPABASE_URL = "https://tjdepqtouvbwqrakarkh.supabase.co"; 
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqZGVwcXRvdXZid3FyYWthcmtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDkxODM4NTMsImV4cCI6MjA2NDc1OTg1M30.5sippZdNYf3uLISBOHHlJkphtlJc_Q1ZRTzX9E8WYb8";// <--- PASTE YOUR KEY HERE
const ADMIN_NUMBER = "923174208576@s.whatsapp.net"; 
// const DAYS_LOOKBACK = 7; // No longer needed

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// === DATA PROCESSING ===
async function fetchAndProcessData() {
  console.log("🔄 Fetching attendance data...");

  // CHANGE 2: Set Start Date to Monday of the current week, End Date to Today (Friday)
  const startDate = format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");
  const endDate = format(new Date(), "yyyy-MM-dd");

  // 1. Fetch Classes
  const { data: classes } = await supabase.from("classes").select("id, name");
   
  // 2. Fetch Attendance (WITH CHUNKING)
  console.log("...fetching attendance in chunks");
  let allAttendance = [];
  let offset = 0;
  const CHUNK_SIZE = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data: chunk, error } = await supabase
      .from("attendance")
      .select(`
        status, 
        date, 
        class_id, 
        students (studentid, name, fathername)
      `)
      .gte("date", startDate)
      .lte("date", endDate)
      .range(offset, offset + CHUNK_SIZE - 1);

    if (error) throw new Error(error.message);

    if (chunk && chunk.length > 0) {
      allAttendance = allAttendance.concat(chunk);
      console.log(`Fetched ${chunk.length} records (Total: ${allAttendance.length})`);
    }

    if (!chunk || chunk.length < CHUNK_SIZE) {
      hasMore = false;
    } else {
      offset += CHUNK_SIZE;
    }
  }

  const classMap = new Map();

  // Initialize all classes
  classes.forEach(c => {
    classMap.set(c.id, {
      id: c.id,
      name: c.name,
      students: new Map()
    });
  });

  // Populate Data (using allAttendance instead of attendanceData)
  allAttendance.forEach(row => {
    const studentId = row.students?.studentid;
    const classId = row.class_id;

    if (!studentId || !classMap.has(classId)) return;

    const classObj = classMap.get(classId);

    if (!classObj.students.has(studentId)) {
      classObj.students.set(studentId, {
        name: row.students.name,
        fathername: row.students.fathername,
        present: 0,
        absent: 0,
        total: 0
      });
    }

    const stu = classObj.students.get(studentId);
    stu.total++;
    if (row.status === "Present") stu.present++;
    if (row.status === "Absent") stu.absent++;
  });

  // Process Final Report Structure
  const reportData = [];
  let schoolTotalRecords = 0;
  let schoolTotalPresent = 0;

  for (const [classId, data] of classMap) {
    const studentsArray = Array.from(data.students.values()).map(s => ({
      ...s,
      percentage: s.total > 0 ? (s.present / s.total) * 100 : 0
    }));

    // Calculate Class Stats
    const classTotalRec = studentsArray.reduce((acc, s) => acc + s.total, 0);
    const classTotalPres = studentsArray.reduce((acc, s) => acc + s.present, 0);
    const classAvg = classTotalRec > 0 ? (classTotalPres / classTotalRec) * 100 : 0;

    // Update School Stats
    schoolTotalRecords += classTotalRec;
    schoolTotalPresent += classTotalPres;

    // Filter: Top Absentees
    const topAbsentees = studentsArray
      .filter(s => s.absent > 0)
      .sort((a, b) => b.absent - a.absent)
      .slice(0, 5); // Increased to top 5 for better visibility

    reportData.push({
      classId: data.id,
      className: data.name,
      studentCount: studentsArray.length,
      average: classAvg.toFixed(1),
      topAbsentees
    });
  }

  // Sort by Class ID (Handle string or number IDs safely)
  reportData.sort((a, b) => (a.classId > b.classId ? 1 : -1));

  const schoolAvg = schoolTotalRecords > 0 ? (schoolTotalPresent / schoolTotalRecords) * 100 : 0;

  return {
    startDate,
    endDate,
    schoolAvg: schoolAvg.toFixed(1),
    classes: reportData
  };
}

// === PDF GENERATION (Using Puppeteer) ===
async function generatePDF(data) {
  console.log("🎨 Generating Aesthetic PDF Report...");
   
  const htmlContent = `
  <!DOCTYPE html>
  <html>
  <head>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
      body { 
        font-family: 'Inter', sans-serif; 
        background-color: #f1f5f9; 
        color: #334155; 
        margin: 0; 
        padding: 40px; 
        -webkit-print-color-adjust: exact; 
      }
       
      /* Header Section */
      .header { 
        background: white;
        padding: 25px 30px; 
        border-radius: 12px; 
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
        margin-bottom: 30px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-left: 6px solid #3b82f6;
      }
      .header-title h1 { margin: 0; font-size: 24px; font-weight: 800; color: #1e293b; letter-spacing: -0.5px; }
      .header-title p { margin: 4px 0 0 0; color: #64748b; font-size: 13px; font-weight: 500; }
       
      .score-box { 
        text-align: right; 
        background: #f8fafc;
        padding: 10px 20px;
        border-radius: 8px;
        border: 1px solid #e2e8f0;
      }
      .score-val { font-size: 28px; font-weight: 800; color: #3b82f6; line-height: 1; }
      .score-label { font-size: 10px; text-transform: uppercase; color: #64748b; font-weight: 600; margin-top: 4px; }

      /* Class Cards */
      .class-card {
        background: white;
        border-radius: 12px;
        margin-bottom: 25px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.02);
        border: 1px solid #e2e8f0;
        overflow: hidden;
        page-break-inside: avoid;
      }

      .card-header {
        padding: 15px 25px;
        background: #f8fafc;
        border-bottom: 1px solid #e2e8f0;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
       
      .class-name { font-size: 16px; font-weight: 700; color: #0f172a; }
       
      .badge {
        font-size: 12px; font-weight: 600; padding: 4px 12px; border-radius: 20px; color: white;
      }

      /* Table Styles */
      .table-wrapper { padding: 0; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
       
      th { 
        text-align: left; 
        background: #fdfdfd;
        color: #64748b; 
        padding: 12px 25px; 
        font-size: 10px; 
        text-transform: uppercase; 
        letter-spacing: 0.05em; 
        font-weight: 600;
        border-bottom: 1px solid #e2e8f0; 
      }
       
      td { padding: 12px 25px; border-bottom: 1px solid #f1f5f9; color: #334155; vertical-align: middle; }
      tr:last-child td { border-bottom: none; }
      tr:nth-child(even) { background-color: #fafafa; }

      .st-name { font-weight: 600; display: block; color: #1e293b; font-size: 13px; }
      .st-father { font-size: 11px; color: #94a3b8; }
       
      .absent-pill {
        background: #fee2e2; color: #991b1b; padding: 3px 8px; border-radius: 6px; font-weight: 700; font-size: 11px; display: inline-block;
      }
      .pct-text { color: #64748b; font-size: 11px; margin-left: 5px; }

      /* GRAPH SECTION FIXED */
      .graph-section {
        margin-top: 50px;
        page-break-before: always;
        background: white;
        padding: 40px;
        border-radius: 16px;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
        border: 1px solid #e2e8f0;
      }
      .graph-title { font-size: 20px; font-weight: 800; margin-bottom: 30px; text-align: center; color: #1e293b; }
       
      .chart-container {
        display: flex;
        align-items: flex-end; /* Align items to bottom */
        justify-content: space-around;
        height: 300px;
        padding: 0 20px 30px 20px; /* Bottom padding for labels */
        border-bottom: 1px solid #cbd5e1;
        position: relative;
        background-image: linear-gradient(#f1f5f9 1px, transparent 1px);
        background-size: 100% 25%; /* Creates grid lines at 0, 25, 50, 75, 100 */
      }
       
      /* Wrapper for Bar + Label */
      .bar-group {
        display: flex;
        flex-direction: column;
        justify-content: flex-end; /* Pushes content to bottom of container */
        align-items: center;
        height: 100%; /* Important: Must take full height */
        width: 40px;
        position: relative;
      }
       
      .bar {
        width: 100%;
        border-radius: 6px 6px 0 0;
        transition: height 0.3s;
        position: relative;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
      }
       
      .bar-val { 
        position: absolute; 
        top: -25px; 
        width: 100px; 
        left: 50%;
        transform: translateX(-50%);
        text-align: center; 
        font-size: 11px; 
        font-weight: 700; 
        color: #475569; 
      }
       
      .bar-label { 
        position: absolute;
        bottom: -35px; /* Push label below the chart line */
        font-size: 10px; 
        font-weight: 600; 
        color: #64748b; 
        text-align: center; 
        width: 80px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .footer { text-align: center; margin-top: 50px; color: #94a3b8; font-size: 11px; font-weight: 500; border-top: 1px solid #e2e8f0; padding-top: 20px; }
    </style>
  </head>
  <body>

    <div class="header">
      <div class="header-title">
        <h1>Attendance Report</h1>
        <p>Period: ${data.startDate} — ${data.endDate}</p>
      </div>
      <div class="score-box">
        <div class="score-val">${data.schoolAvg}%</div>
        <div class="score-label">School Average</div>
      </div>
    </div>

    ${data.classes.map(cls => {
      // Color Logic
      const avg = parseFloat(cls.average);
      let color = '#10b981'; // Green
      let statusText = 'Excellent';
       
      if(avg < 75) { color = '#ef4444'; statusText = 'Critical'; } // Red
      else if(avg < 90) { color = '#f59e0b'; statusText = 'Needs Imp.'; } // Orange

      return `
      <div class="class-card" style="border-left: 5px solid ${color};">
        <div class="card-header">
          <div class="class-name">${cls.className}</div>
          <div class="badge" style="background: ${color};">
            ${cls.average}% ${statusText}
          </div>
        </div>

        <div class="table-wrapper">
          ${cls.topAbsentees.length > 0 ? `
            <table>
              <thead>
                <tr>
                  <th width="45%">Student Details</th>
                  <th width="30%">Absences</th>
                  <th width="25%">Att. Rate</th>
                </tr>
              </thead>
              <tbody>
                ${cls.topAbsentees.map(stu => `
                  <tr>
                    <td>
                      <span class="st-name">${stu.name}</span>
                      <span class="st-father">${stu.fathername}</span>
                    </td>
                    <td>
                      <div class="absent-pill">${stu.absent} Days</div>
                      <span class="pct-text">of ${stu.total}</span>
                    </td>
                    <td>
                      <div style="width: 100%; background: #e2e8f0; height: 6px; border-radius: 3px; margin-bottom: 4px;">
                        <div style="width: ${stu.percentage}%; background: ${stu.percentage < 75 ? '#ef4444' : '#3b82f6'}; height: 6px; border-radius: 3px;"></div>
                      </div>
                      <div style="font-size: 10px; font-weight: 700; color: #475569;">${stu.percentage.toFixed(0)}%</div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : `
            <div style="padding: 25px; text-align: center; color: #10b981; background: #f0fdf4;">
              <div style="font-size: 24px; margin-bottom: 5px;">🎉</div>
              <div style="font-weight: 600; font-size: 13px;">Perfect Attendance!</div>
              <div style="font-size: 11px; opacity: 0.8;">No students were absent in this period.</div>
            </div>
          `}
        </div>
      </div>
      `;
    }).join('')}

    <div class="graph-section">
      <div class="graph-title">📊 Class Performance Comparison</div>
       
      <div class="chart-container">
        ${data.classes.map(cls => {
           const h = parseFloat(cls.average);
           // Dynamic Bar Color
           let bg = '#3b82f6';
           if(h < 75) bg = '#ef4444';
           else if(h >= 95) bg = '#10b981';

           return `
           <div class="bar-group">
             <div class="bar" style="height: ${h}%; background: ${bg};">
               <div class="bar-val">${h.toFixed(0)}%</div>
             </div>
             <div class="bar-label">${cls.className.replace(/Class\s?/i, '')}</div>
           </div>
           `;
        }).join('')}
      </div>
    </div>

    <div class="footer">
      Generated automatically via WhatsApp Bot • ${new Date().toLocaleTimeString()} • ${new Date().toLocaleDateString()}
    </div>

  </body>
  </html>
  `;

  const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
   
  const pdfBuffer = await page.pdf({ 
    format: 'A4', 
    printBackground: true,
    margin: { top: "30px", bottom: "30px", left: "30px", right: "30px" } 
  });
   
  await browser.close();
   
  return pdfBuffer;
}

// === WHATSAPP BOT LOGIC ===
async function sendReportToAdmin() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_session_stable");
  const sock = makeWASocket({ auth: state, printQRInTerminal: true });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "close") {
      const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) sendReportToAdmin();
    } 
     
    else if (connection === "open") {
      console.log("✅ Connected! Generating Class-Wise Report...");

      try {
        const reportData = await fetchAndProcessData();
        const pdfBuffer = await generatePDF(reportData);
         
        const caption = `📊 *Weekly Attendance Report*\n🗓️ _${reportData.startDate} to ${reportData.endDate}_\n\n✅ School Avg: *${reportData.schoolAvg}%*\n\nIncludes detailed absentee lists and performance graphs.`;

        console.log(`📤 Sending PDF to Admin (${ADMIN_NUMBER})...`);
        await sock.sendMessage(ADMIN_NUMBER, { 
          document: pdfBuffer, 
          mimetype: 'application/pdf', 
          fileName: `Class_Report_${reportData.endDate}.pdf`,
          caption: caption
        });

        console.log("🎉 Report Sent Successfully!");
         
        setTimeout(() => {
            console.log("👋 Shutting down.");
            process.exit(0);
        }, 3000); 

      } catch (err) {
        console.error("❌ Error:", err);
        process.exit(1);
      }
    }
  });
}

// Run
sendReportToAdmin();
