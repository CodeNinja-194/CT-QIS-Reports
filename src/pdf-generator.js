// CT-QIS Test Reports - PDF Export & Progress Report Generator
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

/**
 * Downloads an Individual Student Progress Report as a high-quality PDF
 * Order:
 * 1. Institution Header & Date
 * 2. Student Name & Identity Details FIRST (prominent, clear)
 * 3. Overall Performance Summary KPIs (Total, %, Rank, Attempted/NA)
 * 4. Section-Wise Breakdown Table (Section Name, Max, Obtained, %, Status)
 * 5. Signatures Block (Faculty, HOD, Principal)
 */
export function downloadIndividualStudentPdf(student, sections, totalMax, rank, totalInClass, threshold = 40) {
  if (!student) return;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const isPass = student.percentage >= threshold;

  // 1. Institution Header Bar
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(0, 0, pageWidth, 24, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('CT-QISCET TEST REPORTS', 14, 11);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(203, 213, 225);
  doc.text('INDIVIDUAL STUDENT PROGRESS REPORT', 14, 18);

  const dateStr = `Date: ${new Date().toLocaleDateString('en-GB')}`;
  doc.text(dateStr, pageWidth - 14, 18, { align: 'right' });

  // 2. Student Name & Details Box - AT THE VERY FIRST
  let y = 30;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(14, y, pageWidth - 28, 38, 2, 2, 'FD');

  // Student Full Name
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(student.name, 19, y + 8);

  // Status Badge (PASS / FAIL)
  if (isPass) {
    doc.setFillColor(220, 252, 231);
    doc.setTextColor(21, 128, 61);
  } else {
    doc.setFillColor(254, 226, 226);
    doc.setTextColor(185, 28, 28);
  }
  doc.roundedRect(pageWidth - 40, y + 3, 22, 7, 1.5, 1.5, 'F');
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.text(isPass ? 'PASS' : 'FAIL', pageWidth - 29, y + 7.5, { align: 'center' });

  // Details Grid
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(100, 116, 139);

  // Row 1
  doc.text('Roll / Member ID:', 19, y + 17);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  doc.text(String(student.id), 55, y + 17);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text('Class / Section:', 110, y + 17);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  doc.text(student.group || '—', 142, y + 17);

  // Row 2
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text('Email Address:', 19, y + 24);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(30, 41, 59);
  doc.text(student.email || '—', 55, y + 24);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text('Class Rank:', 110, y + 24);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(37, 99, 235);
  doc.text(`#${rank} of ${totalInClass} students`, 142, y + 24);

  // Row 3
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text('Source Sheet:', 19, y + 31);
  doc.setTextColor(30, 41, 59);
  doc.text(student.sourceSheet || '—', 55, y + 31);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text('Attempt Status:', 110, y + 31);
  doc.setTextColor(30, 41, 59);
  doc.text(`${student.attemptedCount}/${sections.length} Attempted (${student.unattemptedCount} NA)`, 142, y + 31);

  // 3. Performance Summary KPIs (4 Cards)
  y = 74;
  const boxWidth = (pageWidth - 28 - 9) / 4;
  const kpis = [
    { label: 'TOTAL SCORE', val: `${student.totalScore} / ${totalMax}M`, sub: student.isPartial ? '* Partial Total' : 'Full Attempt' },
    { label: 'PERCENTAGE', val: `${student.percentage}%`, sub: `Pass Mark: >= ${threshold}%` },
    { label: 'CLASS RANK', val: `#${rank}`, sub: `of ${totalInClass} students` },
    { label: 'FINAL RESULT', val: isPass ? 'PASSED' : 'FAILED', sub: isPass ? 'Qualified' : 'Needs Support' },
  ];

  kpis.forEach((kpi, idx) => {
    const bx = 14 + idx * (boxWidth + 3);
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(bx, y, boxWidth, 20, 1.5, 1.5, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(kpi.label, bx + boxWidth / 2, y + 5.5, { align: 'center' });

    doc.setFontSize(10.5);
    if (idx === 3) {
      doc.setTextColor(isPass ? 21 : 185, isPass ? 128 : 28, isPass ? 61 : 28);
    } else {
      doc.setTextColor(15, 23, 42);
    }
    doc.text(kpi.val, bx + boxWidth / 2, y + 12.5, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(148, 163, 184);
    doc.text(kpi.sub, bx + boxWidth / 2, y + 17, { align: 'center' });
  });

  // 4. Section Breakdown Table
  y = 100;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text('Detailed Section Scores', 14, y);

  const tableHead = [['#', 'Section Name', 'Max Marks', 'Marks Obtained', 'Percentage', 'Status']];
  const tableRows = sections.map((sec, index) => {
    const c = (student.sections && student.sections[sec.key]) || student[sec.key] || { isAttempted: false, score: null };
    const isAtt = c.isAttempted && c.score !== null;
    const scoreVal = isAtt ? String(c.score) : 'NA';
    const pct = isAtt && sec.max > 0 ? `${((c.score / sec.max) * 100).toFixed(1)}%` : '—';
    const status = isAtt ? (c.score === 0 ? 'Zero Marks' : 'Attempted') : 'Not Attempted (NA)';
    return [String(index + 1), sec.name, `${sec.max}M`, scoreVal, pct, status];
  });

  // Summary Row
  tableRows.push([
    '—',
    'Overall Total',
    `${totalMax}M`,
    `${student.totalScore}M ${student.isPartial ? '*' : ''}`,
    `${student.percentage}%`,
    isPass ? 'PASS' : 'FAIL'
  ]);

  autoTable(doc, {
    startY: y + 3,
    head: tableHead,
    body: tableRows,
    theme: 'grid',
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
      fontSize: 8,
      fontStyle: 'bold',
      halign: 'left',
    },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 26, halign: 'center' },
      3: { cellWidth: 30, halign: 'center', fontStyle: 'bold' },
      4: { cellWidth: 26, halign: 'center' },
      5: { cellWidth: 36, halign: 'center' },
    },
    bodyStyles: {
      fontSize: 8,
      textColor: [30, 41, 59],
      cellPadding: 3,
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    didParseCell: (data) => {
      if (data.row.index === tableRows.length - 1) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [241, 245, 249];
      }
    },
    margin: { left: 14, right: 14 },
  });

  // 5. Signatures Block
  const finalY = doc.lastAutoTable.finalY || 160;
  const sigY = Math.max(finalY + 22, 235);
  const sigColWidth = (pageWidth - 28) / 3;

  ['Faculty Evaluator', 'Head of Department (HOD)', 'Principal'].forEach((title, i) => {
    const sx = 14 + i * sigColWidth;
    doc.setDrawColor(148, 163, 184);
    doc.line(sx + 8, sigY, sx + sigColWidth - 8, sigY);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    doc.text(title, sx + sigColWidth / 2, sigY + 5, { align: 'center' });
  });

  // Footer
  doc.setFontSize(7);
  doc.setTextColor(148, 163, 184);
  doc.text('Generated by CT-QISCET Test Reports Platform • Scoring rules: NA = Skipped, 0 = Scored zero, * = Partial Total', 14, 287);
  doc.text('Page 1 of 1', pageWidth - 14, 287, { align: 'right' });

  // Save and Download PDF
  const safeName = student.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeId = String(student.id).replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = `Progress_Report_${safeId}_${safeName}.pdf`;
  doc.save(fileName);
  return fileName;
}

/**
 * Downloads Class-Wise Progress Report as a high-quality landscape PDF.
 * If selectedGroupName is provided, exports that specific class.
 * Otherwise, exports all classes grouped cleanly class-by-class.
 *
 * Order:
 * 1. Institution Header Bar & Active Section Title
 * 2. Class Summary Box (Students, Average, Highest, Pass Rate)
 * 3. Student Table with:
 *    - Rank
 *    - Student Name (prominently at FIRST)
 *    - Roll No / ID
 *    - Class
 *    - Email
 *    - Each detected section score
 *    - Total Marks (/50M)
 *    - Percentage %
 *    - Result (PASS / FAIL)
 */
export function downloadClassWiseProgressReportPdf({
  groupsData,
  sections,
  totalMax,
  threshold = 40,
  selectedGroupName = null,
  sheetTitle = 'Active Spreadsheet'
}) {
  if (!groupsData || groupsData.length === 0) return null;

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const reportSubtitle = selectedGroupName
    ? `SECTION PROGRESS REPORT: ${selectedGroupName} • ${sheetTitle}`
    : `CLASS-WISE STUDENT ASSESSMENT & PROGRESS REPORT • ${sheetTitle}`;

  groupsData.forEach((grp, grpIndex) => {
    if (grpIndex > 0) {
      doc.addPage();
    }

    // Header Band
    doc.setFillColor(15, 23, 42); // slate-900
    doc.rect(0, 0, pageWidth, 22, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text('CT-QISCET TEST REPORTS', 14, 10);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(203, 213, 225);
    doc.text(reportSubtitle, 14, 17);

    const dateStr = `Date: ${new Date().toLocaleDateString('en-GB')}`;
    doc.text(dateStr, pageWidth - 14, 17, { align: 'right' });

    // Class Summary Banner Box
    const y = 27;
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(14, y, pageWidth - 28, 15, 2, 2, 'FD');

    // Class Name
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11.5);
    doc.text(`Class / Section: ${grp.groupName}`, 19, y + 10);

    // Class Stats
    const rightStartX = pageWidth - 165;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);

    doc.text('Students: ', rightStartX, y + 10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(`${grp.students.length}`, rightStartX + 14, y + 10);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text('Average: ', rightStartX + 30, y + 10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(37, 99, 235);
    doc.text(`${grp.averageTotal} / ${totalMax}M`, rightStartX + 43, y + 10);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text('Highest: ', rightStartX + 72, y + 10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(16, 185, 129);
    doc.text(`${grp.highestTotal} / ${totalMax}M`, rightStartX + 85, y + 10);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text('Pass Rate: ', rightStartX + 112, y + 10);
    doc.setFont('helvetica', 'bold');
    const isGoodPass = grp.passRate >= 50;
    doc.setTextColor(isGoodPass ? 21 : 185, isGoodPass ? 128 : 28, isGoodPass ? 61 : 28);
    doc.text(`${grp.passRate}%`, rightStartX + 128, y + 10);

    // Table Header & Rows: Student Name and Details at the FIRST
    const tableHead = [
      [
        'Rank',
        'Student Name',
        'Roll / ID',
        'Class',
        'Email',
        ...sections.map(s => `${s.name}\n(${s.max}M)`),
        `Total\n(${totalMax}M)`,
        '%',
        'Result'
      ]
    ];

    const sortedStudents = [...grp.students].sort((a, b) => b.totalScore - a.totalScore);

    const tableRows = sortedStudents.map((s, idx) => {
      const isPass = s.percentage >= threshold;
      const secScores = sections.map(sec => {
        const c = (s.sections && s.sections[sec.key]) || s[sec.key];
        return c && c.isAttempted && c.score !== null ? String(c.score) : 'NA';
      });

      return [
        String(idx + 1),
        s.name,
        String(s.id),
        s.group,
        s.email || '—',
        ...secScores,
        `${s.totalScore}${s.isPartial ? '*' : ''}`,
        `${s.percentage}%`,
        isPass ? 'PASS' : 'FAIL'
      ];
    });

    autoTable(doc, {
      startY: y + 19,
      head: tableHead,
      body: tableRows,
      theme: 'grid',
      headStyles: {
        fillColor: [30, 41, 59],
        textColor: [255, 255, 255],
        fontSize: 7.5,
        fontStyle: 'bold',
        halign: 'center',
        valign: 'middle',
      },
      columnStyles: {
        0: { cellWidth: 12, halign: 'center' },
        1: { cellWidth: 38, fontStyle: 'bold', halign: 'left' }, // Student Name at first!
        2: { cellWidth: 24, halign: 'center' }, // Roll / ID
        3: { cellWidth: 18, halign: 'center' }, // Class
        4: { cellWidth: 42, halign: 'left' }, // Email
        // Dynamic Section Columns centered
        ...sections.reduce((acc, _, i) => {
          acc[5 + i] = { halign: 'center' };
          return acc;
        }, {}),
        [5 + sections.length]: { halign: 'center', fontStyle: 'bold' },
        [6 + sections.length]: { halign: 'center' },
        [7 + sections.length]: { halign: 'center', fontStyle: 'bold' },
      },
      bodyStyles: {
        fontSize: 7,
        textColor: [30, 41, 59],
        cellPadding: 2,
        valign: 'middle',
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      didParseCell: (data) => {
        if (data.column.index === 7 + sections.length) {
          if (data.cell.raw === 'PASS') {
            data.cell.styles.textColor = [21, 128, 61];
          } else if (data.cell.raw === 'FAIL') {
            data.cell.styles.textColor = [185, 28, 28];
          }
        }
      },
      margin: { left: 14, right: 14, bottom: 14 },
    });
  });

  // Page Numbers on all pages
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text('Generated by CT-QISCET Test Reports Platform • Scoring rules: NA = Skipped, 0 = Scored zero, * = Partial Total', 14, pageHeight - 6);
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - 14, pageHeight - 6, { align: 'right' });
  }

  // Filename based on whether single class or all classes
  const dateStr = new Date().toISOString().slice(0, 10);
  const fileName = selectedGroupName
    ? `Progress_Report_${selectedGroupName.replace(/[^a-zA-Z0-9_-]/g, '_')}_${dateStr}.pdf`
    : `Classwise_Progress_Report_All_Classes_${dateStr}.pdf`;

  doc.save(fileName);
  return fileName;
}
