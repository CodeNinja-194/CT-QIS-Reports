// Data processing, normalization, mapping, and calculations

export const DEFAULT_SECTION_CONFIG = [
  { key: 'verbal', name: 'Verbal Ability', label: 'Verbal (10M)', max: 10, header: 'Verbal(10M)' },
  { key: 'java', name: 'Java MCQs', label: 'Java MCQ\'s (20M)', max: 20, header: 'Java MCQ\'s (20M)' },
  { key: 'coding', name: 'Hands-on Coding', label: 'Coding (20M)', max: 20, header: 'Coding (20M)' },
];

export const SECTION_CONFIG = DEFAULT_SECTION_CONFIG;
export const TOTAL_MAX = 50;

export const TARGET_FIELDS = [
  { key: 'id', label: 'Member Id', required: true, patterns: [/member[\s_-]*id/i, /roll[\s_-]*no/i, /reg[\s_-]*no/i, /student[\s_-]*id/i, /^id$/i, /hall[\s_-]*ticket/i, /usn/i, /htno/i] },
  { key: 'name', label: 'Student Name', required: true, patterns: [/student[\s_-]*name/i, /^name$/i, /candidate[\s_-]*name/i, /full[\s_-]*name/i] },
  { key: 'email', label: 'Email', required: false, patterns: [/email/i, /mail/i] },
  { key: 'group', label: 'Groups', required: true, patterns: [/group/i, /^section$/i, /branch/i, /batch/i, /^class$/i, /dept/i, /division/i] },
  { key: 'total', label: 'Total Score', required: false, patterns: [/total/i, /aggregate/i, /overall/i, /score$/i] }
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
 * Canonicalizes test section names and keys so that naming variations across multiple files
 * (e.g. "Java MCQ's (20M)" and "Java MCQ (20M)", "Verbal Ability" and "Verbal (10M)",
 * "Hands-on Coding" and "Coding (20M)") correctly map to the same section.
 */
export function canonicalizeSection(rawHeader, maxMark = 20) {
  let cleanName = String(rawHeader || '')
    .replace(/\s*(?:\(|\[|\/|\-)\s*\d+(?:\.\d+)?\s*(?:m|marks)?(?:\)|\])?$/i, '')
    .replace(/\s*\d+(?:\.\d+)?\s*(?:m|marks)\b/i, '')
    .trim();

  if (!cleanName) cleanName = String(rawHeader).trim();

  // Normalize apostrophes, plurals, and special characters
  const normalized = cleanName
    .replace(/['’]s\b/gi, '')
    .replace(/\bmcqs\b/gi, 'mcq')
    .replace(/\bquestions\b/gi, 'question')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();

  let canonicalKey = normalized.replace(/\s+/g, '_');
  let displayName = cleanName.replace(/['’]s\b/gi, '');

  // Unify standard academic test sections across multi-file naming differences
  if (/^java\b.*mcq/i.test(normalized) || /^mcq\b.*java/i.test(normalized) || /^java$/i.test(normalized)) {
    canonicalKey = 'java_mcq';
    displayName = "Java MCQ's";
  } else if (/^verbal\b/i.test(normalized) || /^english\b/i.test(normalized)) {
    canonicalKey = 'verbal';
    displayName = 'Verbal';
  } else if (/(?:hands[\s_-]*on[\s_-]*)?coding\b/i.test(normalized) || /^programming\b/i.test(normalized)) {
    canonicalKey = 'coding';
    displayName = 'Coding';
  } else if (/^(?:quant(?:itative)?[\s_-]*)?aptitude\b/i.test(normalized)) {
    canonicalKey = 'aptitude';
    displayName = 'Aptitude';
  } else if (/^(?:logical[\s_-]*)?reasoning\b/i.test(normalized)) {
    canonicalKey = 'reasoning';
    displayName = 'Reasoning';
  } else if (/^python\b/i.test(normalized)) {
    canonicalKey = 'python';
    displayName = 'Python';
  }

  if (!canonicalKey) canonicalKey = 'sec_score';

  return {
    key: canonicalKey,
    name: displayName,
    label: `${displayName} (${maxMark}M)`,
    max: maxMark,
    header: rawHeader
  };
}

/**
 * Dynamically detects test assessment sections and their max marks from data headers and rows.
 */
export function detectSectionsFromData(headers, rows = []) {
  if (!headers || headers.length === 0) {
    return [...DEFAULT_SECTION_CONFIG];
  }

  // Regexes to identify non-section columns
  const isIdPattern = /^(?:member[\s_-]*id|roll[\s_-]*no|reg[\s_-]*no|student[\s_-]*id|^id$|hall[\s_-]*ticket|usn|htno)$/i;
  const isNamePattern = /^(?:student[\s_-]*name|^name$|candidate[\s_-]*name|full[\s_-]*name)$/i;
  const isEmailPattern = /^(?:email|mail|e-mail)$/i;
  const isTotalPattern = /^(?:total|grand[\s_-]*total|overall|aggregate|total[\s_-]*score|total[\s_-]*marks|final[\s_-]*score|^score)$/i;
  const isMetaPattern = /^(?:rank|percentage|pct|result|status|grade|remarks|source[\s_-]*sheet|source[\s_-]*file|s[\s_-]*no|sl[\s_-]*no)$/i;
  const isGroupPattern = /^(?:group|groups|class|branch|batch|dept|department|division|^section)$/i;

  const detectedSections = [];
  const usedKeys = new Set();

  headers.forEach((header, idx) => {
    const rawH = String(header).trim();
    if (!rawH) return;

    // Cleaned header without parentheses/brackets for regex checking
    const baseH = rawH.replace(/\s*(?:\(|\[|\/|\-|\:).*/, '').trim();

    // Check if it's explicitly an ID, Name, Email, Total, or Meta column
    if (
      isIdPattern.test(rawH) || isIdPattern.test(baseH) ||
      isNamePattern.test(rawH) || isNamePattern.test(baseH) ||
      isEmailPattern.test(rawH) || isEmailPattern.test(baseH) ||
      isTotalPattern.test(rawH) || isTotalPattern.test(baseH) ||
      isMetaPattern.test(rawH) || isMetaPattern.test(baseH)
    ) {
      return;
    }

    // Check if it's a student class/group column
    if (isGroupPattern.test(rawH) || isGroupPattern.test(baseH)) {
      // Check sample rows: if text values like "AIML", "CSE-1", "A", it's student groups, not a score section
      const sampleVals = rows.slice(0, 15).map(r => r[header]).filter(v => v !== undefined && v !== null && String(v).trim() !== '');
      const isTextGroups = sampleVals.some(v => isNaN(Number(v)) && !['NA', 'N/A', 'AB', 'ABSENT', '-'].includes(String(v).trim().toUpperCase()));
      if (isTextGroups || sampleVals.length === 0) {
        return; // It's a student group column, skip
      }
    }

    // Check known subject keywords or test score patterns
    const isKnownSubject = /(?:verbal|english|java|coding|aptitude|reasoning|python|c\+\+|sql|technical|dsa|math|quantitative|logical|module|test|section|part|paper)/i.test(rawH);

    // Sample rows in this column
    const sampleVals = rows.slice(0, 25).map(r => r[header]).filter(v => v !== undefined && v !== null && String(v).trim() !== '');
    let numericOrNaCount = 0;
    sampleVals.forEach(v => {
      const parsed = parseScoreCell(v);
      if (parsed.isAttempted || ['NA', 'N/A', 'AB', 'ABSENT', '-'].includes(String(v).trim().toUpperCase())) {
        numericOrNaCount++;
      }
    });

    const isScoreColumn = isKnownSubject || (sampleVals.length > 0 && numericOrNaCount / sampleVals.length >= 0.4);
    if (!isScoreColumn && sampleVals.length > 0) {
      return;
    }

    // Extract Max Marks from header like (20M), (20 Marks), [25], / 20, (10), etc.
    let maxMark = null;
    const markMatch = rawH.match(/(?:(?:\(|\[|\/|\-)\s*(\d+(?:\.\d+)?)\s*(?:m|marks)?(?:\)|\])?$)|(?:(?:^|\s)(\d+(?:\.\d+)?)\s*(?:m|marks)\b)/i);
    if (markMatch) {
      maxMark = parseFloat(markMatch[1] || markMatch[2]);
    }

    // If max mark not in header, check maximum numeric score seen in rows
    if (!maxMark || isNaN(maxMark) || maxMark <= 0) {
      let maxSeen = 0;
      rows.forEach(r => {
        const p = parseScoreCell(r[header]);
        if (p.isAttempted && p.score > maxSeen) {
          maxSeen = p.score;
        }
      });

      if (maxSeen > 0) {
        if (maxSeen <= 10) maxMark = 10;
        else if (maxSeen <= 20) maxMark = 20;
        else if (maxSeen <= 25) maxMark = 25;
        else if (maxSeen <= 30) maxMark = 30;
        else if (maxSeen <= 50) maxMark = 50;
        else if (maxSeen <= 100) maxMark = 100;
        else maxMark = Math.ceil(maxSeen / 10) * 10;
      } else {
        maxMark = 20;
      }
    }

    // Canonicalize section name & key across multiple files
    const canonical = canonicalizeSection(rawH, maxMark);

    let uniqueKey = canonical.key;
    let counter = 1;
    while (usedKeys.has(uniqueKey)) {
      uniqueKey = `${canonical.key}_${counter++}`;
    }
    usedKeys.add(uniqueKey);

    detectedSections.push({
      key: uniqueKey,
      name: canonical.name,
      label: `${canonical.name} (${maxMark}M)`,
      max: maxMark,
      header: rawH
    });
  });

  if (detectedSections.length === 0) {
    return [...DEFAULT_SECTION_CONFIG];
  }

  return detectedSections;
}

/**
 * Calculates total max marks for the test based on detected sections and header.
 */
export function detectTotalMax(headers, detectedSections = [], rows = []) {
  if (headers && headers.length > 0) {
    for (const h of headers) {
      if (/^(?:total|grand[\s_-]*total|overall|aggregate)/i.test(h.trim())) {
        const match = h.match(/(?:(?:\(|\[|\/|\-)\s*(\d+(?:\.\d+)?)\s*(?:m|marks)?(?:\)|\])?$)|(?:(?:^|\s)(\d+(?:\.\d+)?)\s*(?:m|marks)\b)/i);
        if (match) {
          const val = parseFloat(match[1] || match[2]);
          if (val > 0) return val;
        }
      }
    }
  }

  if (detectedSections && detectedSections.length > 0) {
    const sum = detectedSections.reduce((acc, s) => acc + s.max, 0);
    if (sum > 0) return sum;
  }

  return 50;
}

/**
 * Auto-detects best column mapping from a list of header strings.
 */
export function autoDetectMapping(headers, detectedSections = []) {
  const mapping = {
    id: '',
    name: '',
    email: '',
    group: '',
    total: '',
    sections: {}
  };
  const used = new Set();

  for (const field of TARGET_FIELDS) {
    let matchedHeader = null;
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

  // Map each detected section to its column header
  detectedSections.forEach(sec => {
    mapping.sections[sec.key] = sec.header;
    used.add(sec.header);
    if (['verbal', 'java', 'coding'].includes(sec.key)) {
      mapping[sec.key] = sec.header;
    }
    if (sec.key === 'java_mcq') {
      mapping['java'] = sec.header;
    }
  });

  return mapping;
}

/**
 * Normalizes raw rows into structured Student records.
 */
export function normalizeStudentRows(rows, mapping, sourceInfo = {}, detectedSections = [], totalMax = 50) {
  const students = [];
  const idCounts = {};
  const parseIssues = [];

  const effectiveSections = detectedSections && detectedSections.length > 0
    ? detectedSections
    : DEFAULT_SECTION_CONFIG;

  // Pass 1: create student objects and count member IDs
  rows.forEach((rawRow, idx) => {
    const rawId = mapping.id ? rawRow[mapping.id] : (rawRow['Member Id'] || rawRow['Roll No'] || rawRow['ID']);
    const id = rawId ? String(rawId).trim() : `UNKNOWN-${idx + 1}`;
    idCounts[id] = (idCounts[id] || 0) + 1;

    const rawName = mapping.name ? rawRow[mapping.name] : (rawRow['Name'] || rawRow['Student Name'] || 'Unknown Student');
    const name = String(rawName || 'Unknown Student').trim();

    const rawEmail = mapping.email ? rawRow[mapping.email] : (rawRow['Email'] || '');
    const email = String(rawEmail || '').trim();

    const rawGroup = mapping.group ? rawRow[mapping.group] : (rawRow['Groups'] || rawRow['Group'] || rawRow['Section'] || 'General');
    const group = String(rawGroup || 'General').trim();

    // Parse all detected sections dynamically
    const sections = {};
    let attemptedCount = 0;
    let attemptedScoreSum = 0;
    let attemptedMaxSum = 0;

    effectiveSections.forEach(sec => {
      const colHeader = (mapping.sections && mapping.sections[sec.key]) || mapping[sec.key] || sec.header;
      const rawCell = rawRow[colHeader];
      const parsed = parseScoreCell(rawCell);

      if (parsed.isError) {
        parseIssues.push({ row: idx + 1, id, field: sec.name, value: parsed.raw });
      }

      sections[sec.key] = {
        key: sec.key,
        name: sec.name,
        label: sec.label,
        max: sec.max,
        isAttempted: parsed.isAttempted,
        score: parsed.score,
        raw: parsed.raw,
        isError: parsed.isError
      };

      if (parsed.isAttempted && parsed.score !== null) {
        attemptedCount++;
        attemptedScoreSum += parsed.score;
        attemptedMaxSum += sec.max;
      }
    });

    const unattemptedCount = effectiveSections.length - attemptedCount;
    const isPartial = unattemptedCount > 0;

    // Total handling
    let totalScore = 0;
    let totalSuppliedInFile = false;
    let totalCell = mapping.total ? rawRow[mapping.total] : (rawRow['Total (50M)'] || rawRow['Total']);

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

    const percentage = totalMax > 0 ? Number(((totalScore / totalMax) * 100).toFixed(1)) : 0;
    const attemptedPercentage = attemptedMaxSum > 0 ? Number(((attemptedScoreSum / attemptedMaxSum) * 100).toFixed(1)) : 0;

    const studentRecord = {
      originalIndex: idx,
      id,
      name,
      email,
      group,
      sections,
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
    };

    // Attach section objects directly onto student object
    effectiveSections.forEach(sec => {
      studentRecord[sec.key] = sections[sec.key];
    });

    // Backward-compatibility aliases for verbal, java, coding
    studentRecord.verbal = sections.verbal || { isAttempted: false, score: 0, raw: 'NA' };
    studentRecord.java = sections.java_mcq || sections.java || { isAttempted: false, score: 0, raw: 'NA' };
    studentRecord.coding = sections.coding || { isAttempted: false, score: 0, raw: 'NA' };

    students.push(studentRecord);
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
 * Computes dashboard aggregates from a list of students based on dynamically detected sections.
 */
export function computeDashboardAggregates(students, threshold = 40, detectedSections = null, totalMax = null) {
  const count = students.length;

  // Resolve sections dynamically from parameter or student records or default
  const sections = detectedSections && detectedSections.length > 0
    ? detectedSections
    : (students.length > 0 && students[0].sections && Object.keys(students[0].sections).length > 0
        ? Object.values(students[0].sections)
        : DEFAULT_SECTION_CONFIG);

  const maxTotal = totalMax || (sections.length > 0 ? sections.reduce((acc, s) => acc + s.max, 0) : 50);

  if (count === 0) {
    const emptySecStats = {};
    sections.forEach(s => {
      emptySecStats[s.key] = {
        key: s.key,
        name: s.name,
        label: s.label || `${s.name} (${s.max}M)`,
        max: s.max,
        average: 0,
        avgPct: 0,
        highest: 0,
        attemptedCount: 0,
        unattemptedCount: 0,
        zeroCount: 0,
        attemptRate: 0
      };
    });

    return {
      totalStudents: 0,
      totalGroups: 0,
      totalMax: maxTotal,
      detectedSections: sections,
      averageTotal: 0,
      highestTotal: 0,
      highestStudents: [],
      studentsWithNA: 0,
      studentsWithNA_Pct: 0,
      fullyAttemptedCount: 0,
      passCount: 0,
      passRate: 0,
      sectionStats: emptySecStats,
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

  // Section accumulators for each detected section
  const sectionAccumulators = {};
  sections.forEach(sec => {
    sectionAccumulators[sec.key] = { sum: 0, attempted: 0, unattempted: 0, zero: 0, max: -Infinity };
  });

  // Score distribution thresholds based on test's max total
  const b1 = maxTotal * 0.4;
  const b2 = maxTotal * 0.6;
  const b3 = maxTotal * 0.8;

  const scoreDistribution = [0, 0, 0, 0];
  const attemptBreakdown = { full: 0, partial1: 0, partial2: 0, none: 0 };

  students.forEach(s => {
    // NA count & Attempt breakdown
    if (s.unattemptedCount > 0) {
      studentsWithNA++;
    } else {
      fullyAttemptedCount++;
    }

    if (s.attemptedCount === sections.length) attemptBreakdown.full++;
    else if (s.attemptedCount > 0) attemptBreakdown.partial1++;
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
    if (t < b1) scoreDistribution[0]++;
    else if (t < b2) scoreDistribution[1]++;
    else if (t < b3) scoreDistribution[2]++;
    else scoreDistribution[3]++;

    // Section calculations for all detected sections
    sections.forEach(sec => {
      let cell = (s.sections && s.sections[sec.key]) || s[sec.key];
      if (!cell && sec.key === 'java_mcq') {
        cell = (s.sections && (s.sections['java_mcq_s'] || s.sections['java'])) || s.java_mcq_s || s.java;
      }
      const acc = sectionAccumulators[sec.key];
      if (cell && cell.isAttempted && cell.score !== null) {
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

  // Build section stats for each detected section
  const sectionStats = {};
  sections.forEach(sec => {
    const acc = sectionAccumulators[sec.key];
    const avg = acc.attempted > 0 ? Number((acc.sum / acc.attempted).toFixed(1)) : 0;
    const hi = acc.max === -Infinity ? 0 : acc.max;
    sectionStats[sec.key] = {
      key: sec.key,
      name: sec.name,
      label: sec.label || `${sec.name} (${sec.max}M)`,
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
    totalMax: maxTotal,
    detectedSections: sections,
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
