const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const { createClient } = require("@supabase/supabase-js");
const { startOfMonth, endOfMonth, format } = require("date-fns");
const puppeteer = require("puppeteer");

// === CONFIGURATION ===
const SUPABASE_URL = "https://tjdepqtouvbwqrakarkh.supabase.co"; 
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqZGVwcXRvdXZid3FyYWthcmtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDkxODM4NTMsImV4cCI6MjA2NDc1OTg1M30.5sippZdNYf3uLISBOHHlJkphtlJc_Q1ZRTzX9E8WYb8";
const ADMIN_NUMBER = "923085333392@s.whatsapp.net"; 

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// === DATA ENGINE ===
async function fetchAcademicData() {
  console.log("🧠 Crunching Deep Analytics...");

  const startDate = format(startOfMonth(new Date()), "yyyy-MM-dd");
  const endDate = format(endOfMonth(new Date()), "yyyy-MM-dd");

  // 1. Fetch Tests
  const { data: tests, error: testError } = await supabase
    .from("tests")
    .select("id, class_name, subject, date")
    .gte("date", startDate)
    .lte("date", endDate);

  if (testError || !tests || tests.length === 0) return null;

  const testIds = tests.map(t => t.id);

  // 2. Fetch Marks
  const { data: marks, error: marksError } = await supabase
    .from("marks")
    .select(`
      test_id, obtained_marks, total_marks,
      students (studentid, name, fathername)
    `)
    .in("test_id", testIds);

  if (marksError) throw new Error(marksError.message);

  // === PROCESSING LOGIC ===
  const classStats = new Map();
  const globalSubjectStats = new Map(); 
  const testMap = new Map();
  
  tests.forEach(t => testMap.set(t.id, 0));

  marks.forEach(record => {
    const test = tests.find(t => t.id === record.test_id);
    if (!test) return;

    testMap.set(test.id, (testMap.get(test.id) || 0) + 1);

    const percentage = record.total_marks > 0 
      ? (record.obtained_marks / record.total_marks) * 100 
      : 0;

    // --- Global Subject Aggregation ---
    if (!globalSubjectStats.has(test.subject)) {
      globalSubjectStats.set(test.subject, { total: 0, count: 0 });
    }
    const gSub = globalSubjectStats.get(test.subject);
    gSub.total += percentage;
    gSub.count++;

    // --- Class Level Aggregation ---
    if (!classStats.has(test.class_name)) {
      classStats.set(test.class_name, {
        className: test.class_name,
        subjects: new Map(),
        students: new Map(),
        gradeDist: { A: 0, B: 0, C: 0, F: 0 } 
      });
    }
    const classData = classStats.get(test.class_name);

    // Subject Stats (within class)
    if (!classData.subjects.has(test.subject)) {
      classData.subjects.set(test.subject, { total: 0, count: 0, max: 0, min: 100 });
    }
    const sub = classData.subjects.get(test.subject);
    sub.total += percentage;
    sub.count++;
    if (percentage > sub.max) sub.max = percentage;
    if (percentage < sub.min) sub.min = percentage;

    // Student Stats
    const sId = record.students?.studentid;
    if (sId) {
      if (!classData.students.has(sId)) {
        classData.students.set(sId, {
          name: record.students.name,
          father: record.students.fathername,
          total: 0, count: 0
        });
      }
      const stu = classData.students.get(sId);
      stu.total += percentage;
      stu.count++;
    }
  });

  // === ANALYTICS GENERATION ===
  const reportClasses = [];
  let schoolSum = 0;
  let schoolCount = 0;
  const missingTests = tests.filter(t => testMap.get(t.id) === 0)
    .map(t => `${t.class_name} - ${t.subject}`);

  // Process Global Subjects
  const globalSubjects = [];
  for (const [subName, data] of globalSubjectStats) {
    globalSubjects.push({
      name: subName,
      average: data.count > 0 ? data.total / data.count : 0
    });
  }
  globalSubjects.sort((a,b) => b.average - a.average);

  // Process Classes
  for (const [className, data] of classStats) {
    const subjectReport = [];
    let classSum = 0;
    let classEntries = 0;

    // Subjects
    for (const [subName, subData] of data.subjects) {
      const avg = subData.count > 0 ? subData.total / subData.count : 0;
      subjectReport.push({ name: subName, average: avg, max: subData.max });
      classSum += subData.total;
      classEntries += subData.count;
    }

    // Students
    const studentList = [];
    let passingCount = 0;
    
    for (const s of data.students.values()) {
      const avg = s.count > 0 ? (s.total / s.count) : 0;
      
      // Calculate Grade Distribution
      if (avg >= 80) data.gradeDist.A++;
      else if (avg >= 60) data.gradeDist.B++;
      else if (avg >= 40) data.gradeDist.C++;
      else data.gradeDist.F++;

      if (avg >= 40) passingCount++;

      studentList.push({ name: s.name, average: avg });
    }

    studentList.sort((a, b) => a.average - b.average); // Low to High

    const topStudent = studentList.length > 0 ? studentList[studentList.length - 1] : null;
    const bottomStudents = studentList.slice(0, 5);
    const classAvg = classEntries > 0 ? classSum / classEntries : 0;
    const passRate = studentList.length > 0 ? (passingCount / studentList.length) * 100 : 0;
    
    schoolSum += classSum;
    schoolCount += classEntries;

    reportClasses.push({
      className,
      classAvg,
      passRate,
      subjects: subjectReport.sort((a,b) => b.average - a.average),
      bottomStudents,
      topStudent,
      gradeDist: data.gradeDist,
      totalStudents: studentList.length
    });
  }

  // School Stats
  const schoolAvg = schoolCount > 0 ? (schoolSum / schoolCount) : 0;
  
  // Sort classes by performance (Highest to Lowest)
  reportClasses.sort((a,b) => b.classAvg - a.classAvg);

  // === NEW: Cross-Class Subject Comparison ===
  // We want to map: "Mathematics" -> [{className: "9th", average: 50}, {className: "10th", average: 80}]
  const subjectComparison = new Map();
  
  reportClasses.forEach(cls => {
    cls.subjects.forEach(sub => {
      if(!subjectComparison.has(sub.name)) {
        subjectComparison.set(sub.name, []);
      }
      subjectComparison.get(sub.name).push({
        className: cls.className,
        average: sub.average
      });
    });
  });

  const comparisonData = [];
  for (const [subject, classes] of subjectComparison) {
    // Sort classes alphabetically for consistent chart reading
    classes.sort((a,b) => a.className.localeCompare(b.className, undefined, {numeric: true}));
    comparisonData.push({ subject, classes });
  }
  
  // Sort comparisons by Subject Name
  comparisonData.sort((a,b) => a.subject.localeCompare(b.subject));

  return {
    period: format(new Date(), 'MMMM yyyy'),
    schoolAvg: schoolAvg.toFixed(1),
    classes: reportClasses,
    globalSubjects,
    comparisonData, // Added this
    missingTests,
    bestClass: reportClasses.length > 0 ? reportClasses[0] : null
  };
}

// === PDF GENERATOR ===
async function generatePDF(data) {
  if (!data) return null;
  
  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&display=swap" rel="stylesheet">
    <style>
      body { font-family: 'Inter', sans-serif; background: #fff; padding: 40px; color: #1f2937; -webkit-print-color-adjust: exact; }
      
      /* --- Header --- */
      .header { display: flex; justify-content: space-between; border-bottom: 2px solid #111; padding-bottom: 20px; margin-bottom: 30px; }
      .title h1 { margin: 0; font-size: 26px; text-transform: uppercase; letter-spacing: -1px; font-weight: 800; }
      .title p { margin: 5px 0 0; color: #6b7280; font-size: 14px; }
      .score-box { text-align: right; }
      .score-big { font-size: 48px; font-weight: 800; color: #2563eb; line-height: 1; }
      .score-label { font-size: 11px; text-transform: uppercase; color: #6b7280; font-weight: 600; letter-spacing: 0.5px; }

      /* --- Global Analytics Section --- */
      .global-section { background: #f3f4f6; padding: 20px; border-radius: 12px; margin-bottom: 40px; display: grid; grid-template-columns: 1fr 1fr; gap: 30px; }
      .chart-box h3 { margin-top: 0; font-size: 14px; text-transform: uppercase; color: #4b5563; border-bottom: 1px solid #d1d5db; padding-bottom: 8px; }
      
      .global-bar-row { display: flex; align-items: center; margin-bottom: 8px; font-size: 12px; }
      .global-bar-label { width: 100px; font-weight: 600; }
      .global-bar-track { flex: 1; background: #e5e7eb; height: 12px; border-radius: 6px; overflow: hidden; margin: 0 10px; }
      .global-bar-fill { height: 100%; background: #4f46e5; border-radius: 6px; }
      .global-bar-val { width: 40px; text-align: right; font-weight: 700; }

      /* --- Class Cards --- */
      .class-card { break-inside: avoid; margin-bottom: 40px; border: 1px solid #e5e7eb; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); overflow: hidden; }
      .class-header { background: #1f2937; color: white; padding: 15px 25px; display: flex; justify-content: space-between; align-items: center; }
      .class-title { font-size: 20px; font-weight: 700; }
      .class-meta { display: flex; gap: 15px; font-size: 13px; font-weight: 500; }
      .badge { background: rgba(255,255,255,0.2); padding: 4px 10px; border-radius: 20px; }

      .card-body { padding: 25px; display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 40px; }
      
      h4 { font-size: 12px; text-transform: uppercase; color: #9ca3af; margin: 0 0 15px 0; font-weight: 700; letter-spacing: 0.5px; }

      /* Visual Bars */
      .subject-row { display: flex; align-items: center; margin-bottom: 10px; font-size: 13px; }
      .sub-name { width: 110px; font-weight: 500; }
      .sub-track { flex: 1; background: #f3f4f6; height: 8px; border-radius: 4px; overflow: hidden; margin-right: 10px; }
      .sub-fill { height: 100%; }
      .sub-val { width: 35px; text-align: right; font-weight: 700; color: #374151; }

      /* Grade Distribution Bar */
      .grade-bar { display: flex; height: 20px; width: 100%; border-radius: 4px; overflow: hidden; margin-bottom: 15px; background: #f3f4f6; }
      .grade-seg { height: 100%; display: flex; align-items: center; justify-content: center; color: white; font-size: 10px; font-weight: 700; }
      .g-a { background: #10b981; } /* Green */
      .g-b { background: #3b82f6; } /* Blue */
      .g-c { background: #f59e0b; } /* Yellow */
      .g-f { background: #ef4444; } /* Red */
      
      .grade-legend { display: flex; gap: 10px; font-size: 10px; color: #6b7280; margin-bottom: 20px; }
      .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 4px; }

      /* Table */
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      td { padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
      .rank { color: #d1d5db; font-weight: 700; width: 25px; display: inline-block; }
      .danger-text { color: #ef4444; font-weight: 700; }

      /* --- NEW: Cross Comparison Section --- */
      .comparison-section { margin-top: 50px; break-before: page; }
      .comparison-title { font-size: 18px; font-weight: 800; border-bottom: 2px solid #374151; padding-bottom: 10px; margin-bottom: 20px; text-transform: uppercase; }
      .comp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; }
      .comp-card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 15px; break-inside: avoid; }
      .comp-card h5 { margin: 0 0 15px 0; font-size: 14px; font-weight: 700; color: #111; border-bottom: 1px solid #f3f4f6; padding-bottom: 5px; }
      
      .comp-row { display: flex; align-items: center; margin-bottom: 6px; font-size: 11px; }
      .comp-label { width: 80px; font-weight: 500; color: #4b5563; }
      .comp-bar-area { flex: 1; height: 16px; background: #f9fafb; border-radius: 3px; display: flex; align-items: center; }
      .comp-bar { height: 10px; background: #6366f1; border-radius: 2px; }
      .comp-val { font-size: 10px; font-weight: 700; margin-left: 6px; width: 30px; }

      /* Footer Alerts */
      .alert { margin-top: 20px; padding: 15px; background: #fff1f2; border-left: 4px solid #f43f5e; color: #be123c; font-size: 12px; border-radius: 4px; }
    </style>
  </head>
  <body>
    
    <div class="header">
      <div class="title">
        <h1>Academic Intelligence Report</h1>
        <p>Advanced Performance Analytics • ${data.period}</p>
      </div>
      <div class="score-box">
        <div class="score-big">${data.schoolAvg}%</div>
        <div class="score-label">Institutional Average</div>
      </div>
    </div>

    <div class="global-section">
      <div class="chart-box">
        <h3>📊 Subject Performance (School-Wide)</h3>
        ${data.globalSubjects.map(sub => `
          <div class="global-bar-row">
            <div class="global-bar-label">${sub.name}</div>
            <div class="global-bar-track">
              <div class="global-bar-fill" style="width: ${sub.average}%;"></div>
            </div>
            <div class="global-bar-val">${sub.average.toFixed(0)}%</div>
          </div>
        `).join('')}
      </div>
      <div class="chart-box">
        <h3>🏆 Top Performing Class</h3>
        ${data.bestClass ? `
          <div style="text-align: center; padding: 20px;">
            <div style="font-size: 32px; font-weight: 800; color: #10b981;">${data.bestClass.className}</div>
            <div style="font-size: 14px; color: #6b7280;">Average Score: <strong>${data.bestClass.classAvg.toFixed(1)}%</strong></div>
            <div style="margin-top: 10px; font-size: 12px; color: #059669; background: #d1fae5; display: inline-block; padding: 4px 12px; border-radius: 12px;">
              Pass Rate: ${data.bestClass.passRate.toFixed(0)}%
            </div>
          </div>
        ` : '<div>No Data</div>'}
      </div>
    </div>

    ${data.classes.map((cls, idx) => {
      const total = cls.totalStudents || 1;
      const wA = (cls.gradeDist.A / total) * 100;
      const wB = (cls.gradeDist.B / total) * 100;
      const wC = (cls.gradeDist.C / total) * 100;
      const wF = (cls.gradeDist.F / total) * 100;

      return `
      <div class="class-card">
        <div class="class-header">
          <div class="class-title"><span style="color:#9ca3af; margin-right:10px; font-weight:400;">#${idx+1}</span> ${cls.className}</div>
          <div class="class-meta">
            <div class="badge">Avg: ${cls.classAvg.toFixed(1)}%</div>
            <div class="badge">Pass: ${cls.passRate.toFixed(0)}%</div>
            <div class="badge">Students: ${cls.totalStudents}</div>
          </div>
        </div>
        
        <div class="card-body">
          <div>
            <h4>Subject Breakdown</h4>
            ${cls.subjects.map(sub => `
              <div class="subject-row">
                <div class="sub-name">${sub.name}</div>
                <div class="sub-track">
                  <div class="sub-fill" style="width: ${sub.average}%; background: ${sub.average < 40 ? '#ef4444' : '#3b82f6'}"></div>
                </div>
                <div class="sub-val">${sub.average.toFixed(0)}%</div>
              </div>
            `).join('')}

            ${cls.topStudent ? `
              <div style="margin-top: 25px; padding: 12px; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px;">
                <div style="font-size: 10px; font-weight: 700; color: #059669; text-transform: uppercase;">🌟 Star Student</div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 5px;">
                  <span style="font-weight: 700; color: #064e3b;">${cls.topStudent.name}</span>
                  <span style="font-weight: 700; color: #10b981;">${cls.topStudent.average.toFixed(1)}%</span>
                </div>
              </div>
            ` : ''}
          </div>

          <div>
            <h4>Performance Spectrum</h4>
            <div class="grade-bar">
              ${wA > 0 ? `<div class="grade-seg g-a" style="width: ${wA}%">${wA > 15 ? cls.gradeDist.A : ''}</div>` : ''}
              ${wB > 0 ? `<div class="grade-seg g-b" style="width: ${wB}%">${wB > 15 ? cls.gradeDist.B : ''}</div>` : ''}
              ${wC > 0 ? `<div class="grade-seg g-c" style="width: ${wC}%">${wC > 15 ? cls.gradeDist.C : ''}</div>` : ''}
              ${wF > 0 ? `<div class="grade-seg g-f" style="width: ${wF}%">${wF > 15 ? cls.gradeDist.F : ''}</div>` : ''}
            </div>
            <div class="grade-legend">
              <div><span class="dot" style="background:#10b981"></span>A (>80%)</div>
              <div><span class="dot" style="background:#3b82f6"></span>B (>60%)</div>
              <div><span class="dot" style="background:#f59e0b"></span>C (>40%)</div>
              <div><span class="dot" style="background:#ef4444"></span>Fail</div>
            </div>

            <h4 style="margin-top: 25px;">Needs Attention (Bottom 5)</h4>
            <table>
              ${cls.bottomStudents.map((stu, i) => `
                <tr>
                  <td><span class="rank">#${i+1}</span> ${stu.name}</td>
                  <td style="text-align: right;" class="${stu.average < 40 ? 'danger-text' : ''}">${stu.average.toFixed(1)}%</td>
                </tr>
              `).join('')}
            </table>
          </div>
        </div>
      </div>
      `;
    }).join('')}

    <div class="comparison-section">
      <div class="comparison-title">🔎 Subject Cross-Analysis</div>
      <p style="font-size:12px; color:#666; margin-bottom:20px;">Comparing performance of specific subjects across different classes.</p>
      
      <div class="comp-grid">
        ${data.comparisonData.map(item => `
          <div class="comp-card">
            <h5>${item.subject}</h5>
            ${item.classes.map(c => `
              <div class="comp-row">
                <div class="comp-label">${c.className}</div>
                <div class="comp-bar-area">
                  <div class="comp-bar" style="width: ${c.average}%; background: ${c.average < 40 ? '#ef4444' : '#6366f1'};"></div>
                </div>
                <div class="comp-val">${c.average.toFixed(0)}%</div>
              </div>
            `).join('')}
          </div>
        `).join('')}
      </div>
    </div>

    ${data.missingTests.length > 0 ? `
      <div class="alert">
        <strong>⚠️ Data Incomplete:</strong> Zero marks recorded for: ${data.missingTests.join(', ')}
      </div>
    ` : ''}

  </body>
  </html>
  `;

  const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  const pdf = await page.pdf({ 
    format: 'A4', 
    printBackground: true, 
    margin: { top: 30, bottom: 30, left: 30, right: 30 } 
  });
  await browser.close();
  return pdf;
}

// === BOT LOGIC ===
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_session_stable");
  const sock = makeWASocket({ auth: state, printQRInTerminal: true });
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "close") {
      const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) startBot();
    } else if (connection === "open") {
      console.log("🟢 Connected.");
      const stats = await fetchAcademicData();
      if (stats) {
        const pdf = await generatePDF(stats);
        await sock.sendMessage(ADMIN_NUMBER, { 
          document: pdf, 
          mimetype: 'application/pdf', 
          fileName: `Academic_Report_${format(new Date(), 'yyyy-MM')}.pdf`,
          caption: `📊 *Monthly Academic Intelligence*\n\n📈 School Average: ${stats.schoolAvg}%\n🏆 Best Class: ${stats.bestClass?.className || 'N/A'}\n\n_Generated via Supabase Engine_`
        });
        console.log("✅ Analytics Sent.");
      } else {
        console.log("⚠️ No sufficient data found for report.");
      }
      setTimeout(() => process.exit(0), 5000);
    }
  });
}

startBot();
