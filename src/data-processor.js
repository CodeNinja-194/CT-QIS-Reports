// Data processing, normalization, mapping, and calculations

export const SECTION_CONFIG = [
  { key: 'verbal', name: 'Verbal Ability', label: 'Verbal(10M)', max: 10, defaultHeader: 'Verbal(10M)' },
  { key: 'java', name: 'Java MCQs', label: 'Java MCQ\'s (20M)', max: 20, defaultHeader: 'Java MCQ\'s (20M)' },
  { key: 'coding', name: 'Hands-on Coding', label: 'Coding (20M)', max: 20, defaultHeader: 'Coding (20M)' },
];

export const TOTAL_MAX = 50;

export const TARGET_FIELDS = [
  { key: 'id', label: 'Member Id', required: true, patterns: [/member[\s_-]*id/i, /roll[\s_-]*no/i, /reg[\s_-]*no/i, /student[\s_-]*id/i, /^id$/i] },
  { key: 'name', label: 'Student Name', required: true, patterns: [/student[\s_-]*name/i, /^name$/i, /candidate[\s_-]*name/i, /full[\s_-]*name/i] },
  { key: 'email', label: 'Email', required: false, patterns: [/email/i, /mail/i] },
  { key: 'group', label: 'Groups', required: true, patterns: [/group/i, /section/i, /branch/i, /batch/i, /class/i] },
  { key: 'verbal', label: 'Verbal (10M)', required: false, patterns: [/verbal/i, /english/i, /reading/i] },
  { key: 'java', label: 'Java MCQ\'s (20M)', required: false, patterns: [/java/i, /mcq/i, /aptitude/i] },
  { key: 'coding', label: 'Coding (20M)', required: false, patterns: [/code/i, /coding/i, /programming/i, /hands[\s_-]*on/i] },
  { key: 'total', label: 'Total (50M)', required: false, patterns: [/total/i, /aggregate/i, /overall/i, /score$/i] }
];

/**
 * Parses an individual cell score.
 * Distinguishes strictly between NA (Not Attempted) and numeric 0.
 */
export function parseScoreCell(rawVal) {
  if (rawVal === undefined || rawVal === null) {
    return { isAttempted: false, score: null, raw: 'NA', isError: false };
  }

  const str = String(rawVal).trim();
  if (str === '') {
    return { isAttempted: false, score: null, raw: 'NA', isError: false };
  }

  const upper = str.toUpperCase();
  if (['NA', 'N/A', 'NOT ATTEMPTED', 'NOT_ATTEMPTED', 'AB', 'ABSENT', 'NULL', '-'].includes(upper)) {
    return { isAttempted: false, score: null, raw: 'NA', isError: false };
  }

  const num = Number(str);
  if (!isNaN(num) && isFinite(num)) {
    return { isAttempted: true, score: num, raw: num, isError: false };
  }

  // Value could not be parsed as a number or NA
  return { isAttempted: false, score: null, raw: str, isError: true };
}

/**
 * Auto-detects best column mapping from a list of header strings.
 */
export function autoDetectMapping(headers) {
  const mapping = {};
  const used = new Set();

  for (const field of TARGET_FIELDS) {
    let matchedHeader = null;

    // First try exact or strong regex pattern match
    for (const h of headers) {
      if (used.has(h)) continue;
      const cleanH = h.trim();
      for (const pattern of field.patterns) {
        if (pattern.test(cleanH)) {
          matchedHeader = h;
          break;
        }
      }
      if (matchedHeader) break;
    }

    if (matchedHeader) {
      mapping[field.key] = matchedHeader;
      used.add(matchedHeader);
    } else {
      mapping[field.key] = '';
    }
  }

  return mapping;
}

/**
 * Normalizes raw rows into structured Student records.
 */
export function normalizeStudentRows(rows, mapping, sourceInfo = {}) {
  const students = [];
  const idCounts = {};
  const parseIssues = [];

  // Pass 1: create student objects and count member IDs
  rows.forEach((rawRow, idx) => {
    const rawId = mapping.id ? rawRow[mapping.id] : (rawRow['Member Id'] || rawRow['Roll No'] || rawRow['ID']);
    const id = rawId ? String(rawId).trim() : `UNKNOWN-${idx + 1}`;
    idCounts[id] = (idCounts[id] || 0) + 1;

    const rawName = mapping.name ? rawRow[mapping.name] : (rawRow['Name'] || rawRow['Student Name'] || 'Unknown Student');
    const name = String(rawName || 'Unknown Student').trim();

    const rawEmail = mapping.email ? rawRow[mapping.email] : (rawRow['Email'] || '');
    const email = String(rawEmail || '').trim();

    const rawGroup = mapping.group ? rawRow[mapping.group] : (rawRow['Groups'] || rawRow['Group'] || 'General');
    const group = String(rawGroup || 'General').trim();

    // Parse sections
    const verbalData = parseScoreCell(mapping.verbal ? rawRow[mapping.verbal] : rawRow['Verbal(10M)']);
    const javaData = parseScoreCell(mapping.java ? rawRow[mapping.java] : rawRow['Java MCQ\'s (20M)']);
    const codingData = parseScoreCell(mapping.coding ? rawRow[mapping.coding] : rawRow['Coding (20M)']);

    if (verbalData.isError) parseIssues.push({ row: idx + 1, id, field: 'Verbal', value: verbalData.raw });
    if (javaData.isError) parseIssues.push({ row: idx + 1, id, field: 'Java', value: javaData.raw });
    if (codingData.isError) parseIssues.push({ row: idx + 1, id, field: 'Coding', value: codingData.raw });

    const sections = {
      verbal: verbalData,
      java: javaData,
      coding: codingData
    };

    // Count attempts
    let attemptedCount = 0;
    let attemptedScoreSum = 0;
    let attemptedMaxSum = 0;

    SECTION_CONFIG.forEach(sec => {
      const secData = sections[sec.key];
      if (secData && secData.isAttempted && secData.score !== null) {
        attemptedCount++;
        attemptedScoreSum += secData.score;
        attemptedMaxSum += sec.max;
      }
    });

    const unattemptedCount = SECTION_CONFIG.length - attemptedCount;
    const isPartial = unattemptedCount > 0;

    // Total handling:
    let totalScore = 0;
    let totalSuppliedInFile = false;
    let totalCell = mapping.total ? rawRow[mapping.total] : rawRow['Total (50M)'];

    if (totalCell !== undefined && totalCell !== null && String(totalCell).trim() !== '') {
      const parsedTotal = parseScoreCell(totalCell);
      if (parsedTotal.isAttempted && parsedTotal.score !== null) {
        totalScore = parsedTotal.score;
        totalSuppliedInFile = true;
      } else {
        totalScore = attemptedScoreSum;
      }
    } else {
      totalScore = attemptedScoreSum;
    }

    // Percentage calculation: overall test percentage against full 50M
    const percentage = Number(((totalScore / TOTAL_MAX) * 100).toFixed(1));
    const attemptedPercentage = attemptedMaxSum > 0 ? Number(((attemptedScoreSum / attemptedMaxSum) * 100).toFixed(1)) : 0;

    students.push({
      originalIndex: idx,
      id,
      name,
      email,
      group,
      sections,
      verbal: verbalData,
      java: javaData,
      coding: codingData,
      totalScore,
      totalSuppliedInFile,
      attemptedCount,
      unattemptedCount,
      isPartial,
      attemptedScoreSum,
      attemptedMaxSum,
      percentage,
      attemptedPercentage,
      sourceSheet: sourceInfo.sheetName || 'Current Sheet',
      sourceFile: sourceInfo.fileName || 'Spreadsheet',
      isDuplicate: false,
      duplicateSheets: []
    });
  });

  // Pass 2: mark duplicates within this sheet
  let duplicateCount = 0;
  students.forEach(s => {
    if (idCounts[s.id] > 1) {
      s.isDuplicate = true;
      duplicateCount++;
    }
  });

  return {
    students,
    duplicateCount,
    parseIssues
  };
}

/**
 * Computes dashboard aggregates from a list of students.
 */
export function computeDashboardAggregates(students, threshold = 40) {
  const count = students.length;
  if (count === 0) {
    return {
      totalStudents: 0,
      totalGroups: 0,
      averageTotal: 0,
      highestTotal: 0,
      highestStudents: [],
      studentsWithNA: 0,
      studentsWithNA_Pct: 0,
      fullyAttemptedCount: 0,
      passCount: 0,
      passRate: 0,
      sectionStats: {
        verbal: { average: 0, avgPct: 0, highest: 0, attemptedCount: 0, unattemptedCount: 0, zeroCount: 0, attemptRate: 0 },
        java: { average: 0, avgPct: 0, highest: 0, attemptedCount: 0, unattemptedCount: 0, zeroCount: 0, attemptRate: 0 },
        coding: { average: 0, avgPct: 0, highest: 0, attemptedCount: 0, unattemptedCount: 0, zeroCount: 0, attemptRate: 0 }
      },
      groupStats: [],
      scoreDistribution: [0, 0, 0, 0],
      attemptBreakdown: { full: 0, partial1: 0, partial2: 0, none: 0 }
    };
  }

  // Groups
  const groupMap = new Map();
  let studentsWithNA = 0;
  let fullyAttemptedCount = 0;
  let passCount = 0;
  let totalScoreSum = 0;
  let attemptedStudentsForTotal = 0;
  let highestTotal = -Infinity;
  let highestStudents = [];

  // Section accumulators
  const sectionAccumulators = {
    verbal: { sum: 0, attempted: 0, unattempted: 0, zero: 0, max: -Infinity },
    java: { sum: 0, attempted: 0, unattempted: 0, zero: 0, max: -Infinity },
    coding: { sum: 0, attempted: 0, unattempted: 0, zero: 0, max: -Infinity }
  };

  // Score distribution buckets: [0-19, 20-29, 30-39, 40-50]
  const scoreDistribution = [0, 0, 0, 0];
  const attemptBreakdown = { full: 0, partial1: 0, partial2: 0, none: 0 };

  students.forEach(s => {
    // NA count & Attempt breakdown
    if (s.unattemptedCount > 0) {
      studentsWithNA++;
    } else {
      fullyAttemptedCount++;
    }

    if (s.attemptedCount === 3) attemptBreakdown.full++;
    else if (s.attemptedCount === 2) attemptBreakdown.partial1++;
    else if (s.attemptedCount === 1) attemptBreakdown.partial2++;
    else attemptBreakdown.none++;

    // Totals & Highs
    if (s.attemptedCount > 0) {
      totalScoreSum += s.totalScore;
      attemptedStudentsForTotal++;
    }

    if (s.totalScore > highestTotal) {
      highestTotal = s.totalScore;
      highestStudents = [s];
    } else if (s.totalScore === highestTotal) {
      highestStudents.push(s);
    }

    // Pass/Fail
    const isPass = s.percentage >= threshold;
    if (isPass) passCount++;

    // Distribution
    const t = s.totalScore;
    if (t < 20) scoreDistribution[0]++;
    else if (t < 30) scoreDistribution[1]++;
    else if (t < 40) scoreDistribution[2]++;
    else scoreDistribution[3]++;

    // Section calculations (Excluding NAs from section average)
    SECTION_CONFIG.forEach(sec => {
      const cell = s.sections[sec.key];
      const acc = sectionAccumulators[sec.key];
      if (cell.isAttempted && cell.score !== null) {
        acc.attempted++;
        acc.sum += cell.score;
        if (cell.score === 0) acc.zero++;
        if (cell.score > acc.max) acc.max = cell.score;
      } else {
        acc.unattempted++;
      }
    });

    // Group mapping
    if (!groupMap.has(s.group)) {
      groupMap.set(s.group, {
        name: s.group,
        count: 0,
        totalScoreSum: 0,
        passCount: 0,
        naCount: 0,
        students: []
      });
    }
    const gObj = groupMap.get(s.group);
    gObj.count++;
    gObj.totalScoreSum += s.totalScore;
    if (isPass) gObj.passCount++;
    if (s.unattemptedCount > 0) gObj.naCount++;
    gObj.students.push(s);
  });

  const averageTotal = attemptedStudentsForTotal > 0 ? Number((totalScoreSum / attemptedStudentsForTotal).toFixed(1)) : 0;
  const passRate = Number(((passCount / count) * 100).toFixed(1));
  const studentsWithNA_Pct = Number(((studentsWithNA / count) * 100).toFixed(1));

  // Build section stats
  const sectionStats = {};
  SECTION_CONFIG.forEach(sec => {
    const acc = sectionAccumulators[sec.key];
    const avg = acc.attempted > 0 ? Number((acc.sum / acc.attempted).toFixed(1)) : 0;
    const hi = acc.max === -Infinity ? 0 : acc.max;
    sectionStats[sec.key] = {
      name: sec.name,
      label: sec.label,
      max: sec.max,
      average: avg,
      avgPct: Number(((avg / sec.max) * 100).toFixed(1)),
      highest: hi,
      attemptedCount: acc.attempted,
      unattemptedCount: acc.unattempted,
      zeroCount: acc.zero,
      attemptRate: Number(((acc.attempted / count) * 100).toFixed(1))
    };
  });

  // Build group stats
  const groupStats = Array.from(groupMap.values()).map(g => {
    return {
      name: g.name,
      count: g.count,
      averageTotal: Number((g.totalScoreSum / g.count).toFixed(1)),
      passCount: g.passCount,
      passRate: Number(((g.passCount / g.count) * 100).toFixed(1)),
      naCount: g.naCount
    };
  }).sort((a, b) => b.averageTotal - a.averageTotal);

  return {
    totalStudents: count,
    totalGroups: groupMap.size,
    averageTotal,
    highestTotal: highestTotal === -Infinity ? 0 : highestTotal,
    highestStudents,
    studentsWithNA,
    studentsWithNA_Pct,
    fullyAttemptedCount,
    passCount,
    passRate,
    sectionStats,
    groupStats,
    scoreDistribution,
    attemptBreakdown
  };
}

/**
 * Computes Multi-Test & Combined Sheet Analytics:
 * - Breakdown of each uploaded sheet/test
 * - Cross-sheet student tracking & duplicate detection
 * - Top 10 and Below 10 student performers
 * - Group performance benchmarks
 */
export function computeMultiSheetOverview(sheets, threshold = 40) {
  if (!sheets || sheets.length === 0) {
    return {
      totalTests: 0,
      totalSubmissions: 0,
      uniqueStudentsCount: 0,
      duplicateStudentsCount: 0,
      sheetSummaries: [],
      top10Performers: [],
      below10Performers: [],
      combinedAggregates: computeDashboardAggregates([], threshold),
      duplicateStudentsMap: new Map()
    };
  }

  // 1. Sheet Summaries (Each test / sheet stats)
  const sheetSummaries = sheets.map(sh => {
    const agg = computeDashboardAggregates(sh.students, threshold);
    return {
      sheetId: sh.id,
      name: sh.name,
      fileName: sh.fileName,
      studentCount: sh.students.length,
      averageTotal: agg.averageTotal,
      passRate: agg.passRate,
      highestTotal: agg.highestTotal,
      sectionStats: agg.sectionStats
    };
  });

  // 2. Cross-Sheet Student Mapping & Duplicates
  const studentMap = new Map(); // id -> array of student records across sheets
  const allCombinedStudents = [];

  sheets.forEach(sh => {
    sh.students.forEach(s => {
      allCombinedStudents.push(s);
      if (!studentMap.has(s.id)) {
        studentMap.set(s.id, []);
      }
      studentMap.get(s.id).push(s);
    });
  });

  let duplicateStudentsCount = 0;
  const duplicateStudentsMap = new Map();

  studentMap.forEach((records, id) => {
    if (records.length > 1) {
      duplicateStudentsCount++;
      const sheetNames = records.map(r => r.sourceSheet);
      records.forEach(r => {
        r.isDuplicate = true;
        r.duplicateSheets = sheetNames;
      });
      duplicateStudentsMap.set(id, {
        id,
        name: records[0].name,
        recordsCount: records.length,
        sheets: sheetNames,
        records
      });
    }
  });

  // 3. Combined Aggregates
  const combinedAggregates = computeDashboardAggregates(allCombinedStudents, threshold);

  // 4. Top 10 and Below 10 Performers
  const sortedDesc = [...allCombinedStudents].sort((a, b) => b.totalScore - a.totalScore);
  const top10Performers = sortedDesc.slice(0, 10);

  const sortedAsc = [...allCombinedStudents].sort((a, b) => a.totalScore - b.totalScore);
  const below10Performers = sortedAsc.slice(0, 10);

  return {
    totalTests: sheets.length,
    totalSubmissions: allCombinedStudents.length,
    uniqueStudentsCount: studentMap.size,
    duplicateStudentsCount,
    sheetSummaries,
    top10Performers,
    below10Performers,
    combinedAggregates,
    duplicateStudentsMap
  };
}
