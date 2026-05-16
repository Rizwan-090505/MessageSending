const { createClient } = require("@supabase/supabase-js");
const { startOfMonth, endOfMonth, format } = require("date-fns");
const fs = require("fs");
const PDFDocument = require("pdfkit-table"); // Note the new package

// === CONFIGURATION ===
const SUPABASE_URL = "https://tjdepqtouvbwqrakarkh.supabase.co"; 
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqZGVwcXRvdXZid3FyYWthcmtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDkxODM4NTMsImV4cCI6MjA2NDc1OTg1M30.5sippZdNYf3uLISBOHHlJkphtlJc_Q1ZRTzX9E8WYb8";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// === DATA ANALYTICS ENGINE ===
async function fetchAcademicData() {
  console.log("🧠 Crunching Deep Analytics Engine...");

  const startDate = format(startOfMonth(new Date()), "yyyy-MM-dd");
  const endDate = format(endOfMonth(new Date()), "yyyy-MM-dd");

  const { data: tests, error: testError } = await supabase
    .from("tests")
    .select("id, class_name, subject, date")
    .gte("date", startDate)
    .lte("date", endDate);

  if (testError || !tests || tests.length === 0) return null;
  const testIds = tests.map(t => t.id);

  const { data: marks, error: marksError } = await supabase
    .from("marks")
    .select(`
      test_id, obtained_marks, total_marks,
      students (studentid, name, fathername)
    `)
    .in("test_id", testIds);

  if (marksError) throw new Error(marksError.message);

  const classStats = new Map();
  const globalSubjectStats = new Map(); 
  const testMap = new Map();
  
  tests.forEach(t => testMap.set(t.id, 0));

  marks.forEach(record => {
    const test = tests.find(t => t.id === record.test_id);
    if (!test) return;

    testMap.set(test.id, (testMap.get(test.id) || 0) + 1);
    const percentage = record.total_marks > 0 ? (record.obtained_marks / record.total_marks) * 100 : 0;

    if (!globalSubjectStats.has(test.subject)) {
      globalSubjectStats.set(test.subject, { total: 0, count: 0 });
    }
    const gSub = globalSubjectStats.get(test.subject);
    gSub.total += percentage;
    gSub.count++;

    if (!classStats.has(test.class_name)) {
      classStats.set(test.class_name, {
        className: test.class_name,
        subjects: new Map(),
        students: new Map(),
        gradeDist: { A: 0, B: 0, C: 0, F: 0 } 
      });
    }
    const classData = classStats.get(test.class_name);

    if (!classData.subjects.has(test.subject)) {
      classData.subjects.set(test.subject, { total: 0, count: 0, max: 0, min: 100 });
    }
    const sub = classData.subjects.get(test.subject);
    sub.total += percentage;
    sub.count++;
    if (percentage > sub.max) sub.max = percentage;
    if (percentage < sub.min) sub.min = percentage;

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

  const reportClasses = [];
  let schoolSum = 0;
  let schoolCount = 0;
  const missingTests = tests.filter(t => testMap.get(t.id) === 0).map(t => `${t.class_name} - ${t.subject}`);

  const globalSubjects = [];
  for (const [subName, data] of globalSubjectStats) {
    globalSubjects.push({ name: subName, average: data.count > 0 ? data.total / data.count : 0 });
  }
  globalSubjects.sort((a,b) => b.average - a.average);

  for (const [className, data] of classStats) {
    const subjectReport = [];
    let classSum = 0;
    let classEntries = 0;

    for (const [subName, subData] of data.subjects) {
      const avg = subData.count > 0 ? subData.total / subData.count : 0;
      subjectReport.push({ name: subName, average: avg, max: subData.max });
      classSum += subData.total;
      classEntries += subData.count;
    }

    const studentList = [];
    let passingCount = 0;
    
    for (const s of data.students.values()) {
      const avg = s.count > 0 ? (s.total / s.count) : 0;
      if (avg >= 80) data.gradeDist.A++;
      else if (avg >= 60) data.gradeDist.B++;
      else if (avg >= 40) data.gradeDist.C++;
      else data.gradeDist.F++;

      if (avg >= 40) passingCount++;
      studentList.push({ name: s.name, average: avg });
    }

    studentList.sort((a, b) => a.average - b.average);
    const topStudent = studentList.length > 0 ? studentList[studentList.length - 1] : null;
    const bottomStudents = studentList.slice(0, 5);
    const classAvg = classEntries > 0 ? classSum / classEntries : 0;
    const passRate = studentList.length > 0 ? (passingCount / studentList.length) * 100 : 0;
    
    schoolSum += classSum;
    schoolCount += classEntries;

    reportClasses.push({
      className,
      classAvg: parseFloat(classAvg.toFixed(1)),
      passRate: parseFloat(passRate.toFixed(0)),
      subjects: subjectReport.sort((a,b) => b.average - a.average),
      bottomStudents,
      topStudent,
      gradeDist: data.gradeDist,
      totalStudents: studentList.length
    });
  }

  const schoolAvg = schoolCount > 0 ? (schoolSum / schoolCount) : 0;
  reportClasses.sort((a,b) => b.classAvg - a.classAvg);

  const subjectComparison = new Map();
  reportClasses.forEach(cls => {
    cls.subjects.forEach(sub => {
      if(!subjectComparison.has(sub.name)) subjectComparison.set(sub.name, []);
      subjectComparison.get(sub.name).push({ className: cls.className, average: sub.average });
    });
  });

  const comparisonData = [];
  for (const [subject, classes] of subjectComparison) {
    classes.sort((a,b) => a.className.localeCompare(b.className, undefined, {numeric: true}));
    comparisonData.push({ subject, classes });
  }
  comparisonData.sort((a,b) => a.subject.localeCompare(b.subject));

  return {
    period: format(new Date(), 'MMMM yyyy'),
    schoolAvg: schoolAvg.toFixed(1),
    classes: reportClasses,
    globalSubjects,
    comparisonData,
    missingTests,
    bestClass: reportClasses.length > 0 ? reportClasses[0] : null
  };
}

// === PROFESSIONAL PDF GENERATOR ===
async function generatePDFReport(stats) {
  return new Promise(async (resolve, reject) => {
    const fileName = `Academic_Report_${stats.period.replace(' ', '_')}.pdf`;
    
    // Set bufferPages to true so we can add page numbers at the very end
    const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });
    const writeStream = fs.createWriteStream(fileName);

    doc.pipe(writeStream);

    const themeColor = '#2c3e50'; // Dark Slate
    const accentColor = '#2980b9'; // Professional Blue
    const dangerColor = '#e74c3c'; // Red for missing data

    // ==========================================
    // 1. COVER PAGE
    // ==========================================
    doc.moveDown(5);
    doc.fontSize(28).font('Helvetica-Bold').fillColor(themeColor)
       .text('ACADEMIC ANALYTICS REPORT', { align: 'center' });
    doc.moveDown(0.5);
    doc.rect(150, doc.y, 295, 2).fill(accentColor); // Decorative line
    doc.moveDown(2);
    doc.fontSize(16).font('Helvetica').fillColor('#7f8c8d')
       .text(`Reporting Period: ${stats.period}`, { align: 'center' });
    
    doc.addPage();

    // ==========================================
    // 2. EXECUTIVE SUMMARY
    // ==========================================
    doc.fontSize(20).font('Helvetica-Bold').fillColor(themeColor).text('Executive Summary');
    doc.moveDown(1);
    
    doc.fontSize(12).fillColor('#333333').font('Helvetica');
    doc.text(`Total School Average: `, { continued: true }).font('Helvetica-Bold').text(`${stats.schoolAvg}%`);
    if (stats.bestClass) {
      doc.font('Helvetica').text(`Top Performing Class: `, { continued: true })
         .font('Helvetica-Bold').fillColor(accentColor).text(`${stats.bestClass.className} (${stats.bestClass.classAvg}%)`);
    }
    doc.moveDown(2);

    // Global Subjects Table
    const globalSubjectTable = {
      title: "Global Subject Performance (School-Wide)",
      headers: ["Subject", "Average Score"],
      rows: stats.globalSubjects.map(s => [s.name, `${s.average.toFixed(1)}%`])
    };

    await doc.table(globalSubjectTable, {
      prepareHeader: () => doc.font("Helvetica-Bold").fontSize(10).fillColor('#ffffff'),
      prepareRow: (row, indexColumn, indexRow, rectRow, rectCell) => {
        doc.font("Helvetica").fontSize(10).fillColor('#333333');
      },
    });

    // ==========================================
    // 3. CLASS-WISE DETAILED ANALYSIS
    // ==========================================
    for (const cls of stats.classes) {
      doc.addPage();
      
      // Header
      doc.fontSize(20).font('Helvetica-Bold').fillColor(themeColor).text(`Class Analysis: ${cls.className}`);
      doc.moveDown(0.5);
      
      // Key Metrics Box
      doc.rect(50, doc.y, 495, 30).fill('#ecf0f1');
      doc.fillColor(themeColor).fontSize(11).font('Helvetica-Bold')
         .text(`Class Average: ${cls.classAvg}%    |    Pass Rate: ${cls.passRate}%    |    Total Students: ${cls.totalStudents}`, 50, doc.y + 10, { align: 'center' });
      doc.moveDown(2);

      // Grade Distribution Table
      doc.fontSize(14).font('Helvetica-Bold').fillColor(accentColor).text('Grade Distribution', 50);
      doc.moveDown(0.5);
      const gradeTable = {
        headers: ["A (80%+)", "B (60-79%)", "C (40-59%)", "F (<40%)"],
        rows: [[cls.gradeDist.A.toString(), cls.gradeDist.B.toString(), cls.gradeDist.C.toString(), cls.gradeDist.F.toString()]]
      };
      await doc.table(gradeTable, { width: 495 });
      doc.moveDown(1);

      // Subject Breakdown Table
      doc.fontSize(14).font('Helvetica-Bold').fillColor(accentColor).text('Subject Breakdown', 50);
      doc.moveDown(0.5);
      const subjectTable = {
        headers: ["Subject", "Class Average", "Highest Score"],
        rows: cls.subjects.map(s => [s.name, `${s.average.toFixed(1)}%`, `${s.max.toFixed(1)}%`])
      };
      await doc.table(subjectTable, { width: 495 });
      doc.moveDown(1);

      // Student Insights Section
      doc.fontSize(14).font('Helvetica-Bold').fillColor(accentColor).text('Student Insights', 50);
      doc.moveDown(0.5);
      doc.fontSize(11).fillColor('#333333');
      
      if (cls.topStudent) {
        doc.font('Helvetica-Bold').text('Top Performer: ', { continued: true })
           .font('Helvetica').text(`${cls.topStudent.name} (${cls.topStudent.average.toFixed(1)}%)`);
      }

      if (cls.bottomStudents.length > 0) {
         doc.moveDown(0.5);
         doc.font('Helvetica-Bold').text('Needs Attention (Lowest Averages):');
         doc.font('Helvetica');
         cls.bottomStudents.forEach(stu => {
            doc.text(`  • ${stu.name} (${stu.average.toFixed(1)}%)`);
         });
      }
    }

    // ==========================================
    // 4. MISSING DATA / WARNINGS
    // ==========================================
    if (stats.missingTests && stats.missingTests.length > 0) {
      doc.addPage();
      doc.fontSize(20).font('Helvetica-Bold').fillColor(dangerColor).text('Alert: Missing Test Data');
      doc.moveDown(1);
      doc.fontSize(12).fillColor('#333333').font('Helvetica');
      doc.text('The following scheduled tests currently have no marks entered into the system. Please follow up with the respective teachers.');
      doc.moveDown(1);
      stats.missingTests.forEach(mt => {
        doc.text(`  • ${mt}`);
      });
    }

    // ==========================================
    // 5. ADD PAGE NUMBERS TO FOOTER
    // ==========================================
    

    // Finalize PDF file
    doc.end();

    writeStream.on('finish', () => resolve(fileName));
    writeStream.on('error', (err) => reject(err));
  });
}

// === RUNNER ===
async function run() {
  try {
    const stats = await fetchAcademicData();
    if (stats) {
      console.log("✅ Academic Analytics generated successfully.");
      console.log("📄 Generating professional PDF report...");
      
      const fileName = await generatePDFReport(stats);
      
      console.log(`🎉 Success! Report saved locally as: ${fileName}`);
    } else {
      console.log("⚠️ No tests or data found for the current month.");
    }
  } catch (error) {
    console.error("❌ An error occurred while fetching data or creating the PDF:", error);
  }
}

run();
