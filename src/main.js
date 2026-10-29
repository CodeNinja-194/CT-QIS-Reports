// CT-QISCET Test Reports - Main Application Controller
import * as XLSX from 'xlsx';
import { SAMPLE_SHEET_1, SAMPLE_SHEET_2 } from './sample-data.js';
import {
  SECTION_CONFIG,
  TOTAL_MAX,
  autoDetectMapping,
  normalizeStudentRows,
  computeDashboardAggregates
} from './data-processor.js';
import { DashboardCharts } from './charts-manager.js';

// Application State
const state = {
  // Collection of uploaded sheets: [{ id, name, fileName, rawRows, headers, mapping, students, duplicateCount, parseIssues }]
  sheets: [],
  viewMode: 'single', // 'single' | 'multiple'
  activeSheetId: null,

  // Filters (preserved across sheet switches)
  searchQuery: '',
  selectedGroups: new Set(),
  statusFilter: 'all', // 'all' | 'full' | 'has_na' | 'has_zero' | 'failed'
  threshold: 40, // percent

  // Table Sorting & Pagination
  sortColumn: 'totalScore',
  sortDirection: 'desc',
  pageSize: 25,
  currentPage: 1,

  // Queued files in upload dialog
  queuedFiles: [],

  // Currently inspected student in modal
  currentModalStudent: null,

  // Validation
  duplicateCount: 0,
  parseIssues: []
};

// Initialize Chart Manager
const charts = new DashboardCharts();

// DOM Element Selectors Helper
const $ = (id) => document.getElementById(id);

/**
 * Toast Notification Helper
 */
function showToast(message, duration = 3000) {
  const toast = $('toastMessage');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

/**
 * Escape HTML for safe rendering
 */
function escapeHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Formats a score cell value with distinctive styling for NA vs 0
 */
function formatScoreCell(cellData, maxScore) {
  if (!cellData || !cellData.isAttempted || cellData.score === null) {
    return `<span class="score-badge badge-na" title="Not Attempted">NA</span>`;
  }

  const score = cellData.score;
  if (score === 0) {
    return `<span class="score-badge tier-zero" title="Attempted with 0 marks">0</span>`;
  }

  const pct = (score / maxScore) * 100;
  let tierClass = 'tier-low';
  if (pct >= 75) tierClass = 'tier-high';
  else if (pct >= 40) tierClass = 'tier-mid';

  return `<span class="score-badge ${tierClass}" title="${score}/${maxScore} (${pct.toFixed(0)}%)">${score}</span>`;
}

/**
 * Formats the total score with partial indicator if NA exists
 */
function formatTotalCell(student) {
  const isPartial = student.isPartial;
  const scoreText = student.totalScore;

  if (isPartial) {
    const unattempted = student.unattemptedCount;
    return `
      <div class="total-cell-wrap" title="Partial total: ${unattempted} section(s) not attempted">
        <span class="num">${scoreText}</span>
        <span class="partial-star-tag">* Partial (${unattempted} NA)</span>
      </div>
    `;
  }

  return `
    <div class="total-cell-wrap" title="Full attempt total">
      <span class="num">${scoreText}</span>
    </div>
  `;
}

/**
 * Initializes sheets from raw data using background auto-detection
 */
function initializeSheet(sheetRaw) {
  const headers = sheetRaw.columns || Object.keys(sheetRaw.rows[0] || {});
  const mapping = autoDetectMapping(headers);
  const normalized = normalizeStudentRows(sheetRaw.rows, mapping, {
    sheetName: sheetRaw.name,
    fileName: sheetRaw.fileName
  });

  return {
    id: sheetRaw.id || `sheet-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    name: sheetRaw.name || 'Sheet 1',
    fileName: sheetRaw.fileName || 'Spreadsheet.xlsx',
    rawRows: sheetRaw.rows,
    headers,
    mapping,
    students: normalized.students,
    duplicateCount: normalized.duplicateCount,
    parseIssues: normalized.parseIssues
  };
}

/**
 * Returns the currently active dataset of students based on viewing mode
 */
function getActiveDataset() {
  if (state.sheets.length === 0) return [];

  if (state.viewMode === 'single') {
    const activeSheet = state.sheets.find(s => s.id === state.activeSheetId) || state.sheets[0];
    return activeSheet ? activeSheet.students : [];
  } else {
    // Combine all sheets while keeping source tags intact
    const combined = [];
    const seenIds = new Set();
    let totalDuplicates = 0;

    state.sheets.forEach(sh => {
      sh.students.forEach(s => {
        combined.push(s);
        if (seenIds.has(s.id)) {
          totalDuplicates++;
        }
        seenIds.add(s.id);
      });
    });

    state.duplicateCount = totalDuplicates;
    return combined;
  }
}

/**
 * Filters and sorts the active dataset
 */
function getFilteredAndSortedStudents() {
  let list = getActiveDataset();

  // 1. Search Query Filter
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    list = list.filter(s =>
      String(s.id).toLowerCase().includes(q) ||
      String(s.name).toLowerCase().includes(q) ||
      String(s.email).toLowerCase().includes(q) ||
      String(s.group).toLowerCase().includes(q)
    );
  }

  // 2. Group Filter
  if (state.selectedGroups.size > 0) {
    list = list.filter(s => state.selectedGroups.has(s.group));
  }

  // 3. Status Tab Filter
  if (state.statusFilter === 'full') {
    list = list.filter(s => s.attemptedCount === 3);
  } else if (state.statusFilter === 'has_na') {
    list = list.filter(s => s.unattemptedCount > 0);
  } else if (state.statusFilter === 'has_zero') {
    list = list.filter(s =>
      (s.verbal.isAttempted && s.verbal.score === 0) ||
      (s.java.isAttempted && s.java.score === 0) ||
      (s.coding.isAttempted && s.coding.score === 0)
    );
  } else if (state.statusFilter === 'failed') {
    list = list.filter(s => s.percentage < state.threshold);
  }

  // 4. Sorting
  const key = state.sortColumn;
  const dir = state.sortDirection === 'asc' ? 1 : -1;

  list = [...list].sort((a, b) => {
    let va, vb;

    if (key === 'verbal') {
      va = a.verbal.isAttempted && a.verbal.score !== null ? a.verbal.score : -1;
      vb = b.verbal.isAttempted && b.verbal.score !== null ? b.verbal.score : -1;
    } else if (key === 'java') {
      va = a.java.isAttempted && a.java.score !== null ? a.java.score : -1;
      vb = b.java.isAttempted && b.java.score !== null ? b.java.score : -1;
    } else if (key === 'coding') {
      va = a.coding.isAttempted && a.coding.score !== null ? a.coding.score : -1;
      vb = b.coding.isAttempted && b.coding.score !== null ? b.coding.score : -1;
    } else {
      va = a[key];
      vb = b[key];
    }

    if (typeof va === 'string') {
      return dir * va.localeCompare(vb);
    }
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return 0;
  });

  return list;
}

/**
 * Updates UI topbar, sheet selector dropdown, and context ribbon
 */
function updateHeaderAndContext() {
  const sheetSelect = $('sheetSelector');
  const totalSheetsSpan = $('totalSheetsCount');
  const contextSheetName = $('contextSheetName');
  const contextTotalStudents = $('contextTotalStudents');
  const thSourceFile = $('thSourceFile');
  const contextSheetSelectorWrap = $('contextSheetSelectorWrap');

  totalSheetsSpan.textContent = state.sheets.length;

  // Populate sheet dropdown
  sheetSelect.innerHTML = state.sheets.map(sh =>
    `<option value="${sh.id}" ${sh.id === state.activeSheetId ? 'selected' : ''}>${escapeHtml(sh.name)} (${sh.students.length} students)</option>`
  ).join('');

  if (state.viewMode === 'single') {
    $('btnModeSingle').classList.add('active');
    $('btnModeMultiple').classList.remove('active');
    $('btnModeSingle').setAttribute('aria-selected', 'true');
    $('btnModeMultiple').setAttribute('aria-selected', 'false');
    
    // In Single mode, show the sheet selector inside the context ribbon (not jumping in the topbar!)
    contextSheetSelectorWrap.style.display = 'inline-flex';
    contextSheetName.style.display = 'none';
    thSourceFile.style.display = 'none';
  } else {
    $('btnModeSingle').classList.remove('active');
    $('btnModeMultiple').classList.add('active');
    $('btnModeSingle').setAttribute('aria-selected', 'false');
    $('btnModeMultiple').setAttribute('aria-selected', 'true');
    
    // In Combined mode, hide the single sheet selector and show combined tag
    contextSheetSelectorWrap.style.display = 'none';
    contextSheetName.style.display = 'inline';
    contextSheetName.innerHTML = `Viewing: <strong>Combined Sheets (${state.sheets.length})</strong>`;
    thSourceFile.style.display = '';
  }

  const activeStudents = getActiveDataset();
  contextTotalStudents.innerHTML = `Total Students: <strong>${activeStudents.length}</strong>`;

  // Validation Banner check
  updateValidationBanner();
}

/**
 * Updates the Data Validation Banner if duplicate IDs or parsing errors exist
 */
function updateValidationBanner() {
  const banner = $('validationBanner');
  const msg = $('validationMessage');

  let dupCount = 0;
  let issueCount = 0;

  if (state.viewMode === 'single') {
    const cur = state.sheets.find(s => s.id === state.activeSheetId);
    if (cur) {
      dupCount = cur.duplicateCount;
      issueCount = cur.parseIssues.length;
    }
  } else {
    dupCount = state.duplicateCount;
    state.sheets.forEach(s => {
      issueCount += s.parseIssues.length;
    });
  }

  state.duplicateCount = dupCount;

  if (dupCount > 0 || issueCount > 0) {
    banner.style.display = 'flex';
    const parts = [];
    if (dupCount > 0) parts.push(`${dupCount} duplicate Member ID(s) detected`);
    if (issueCount > 0) parts.push(`${issueCount} unparseable score cell(s) flagged`);
    msg.textContent = parts.join(' and ') + '. Data was sanitized for reporting.';
  } else {
    banner.style.display = 'none';
  }
}

/**
 * Updates KPI Summary Cards & Section Breakdown Cards
 */
function updateKPIsAndSections(aggregates) {
  // Main KPIs
  $('kpiTotalStudents').textContent = aggregates.totalStudents;
  $('kpiSheetsSub').textContent = state.viewMode === 'single'
    ? 'In active spreadsheet'
    : `Across ${state.sheets.length} spreadsheets combined`;

  $('kpiTotalGroups').textContent = aggregates.totalGroups;
  $('kpiGroupsSub').textContent = aggregates.totalGroups > 0
    ? aggregates.groupStats.map(g => g.name.replace(/2025-2029-Prime-/, '')).slice(0, 3).join(', ')
    : 'No groups found';

  $('kpiAverageTotal').textContent = aggregates.averageTotal.toFixed(1);
  $('kpiAvgPctSub').textContent = `${((aggregates.averageTotal / TOTAL_MAX) * 100).toFixed(1)}% class average`;

  $('kpiHighestTotal').textContent = aggregates.highestTotal;
  const hiCount = aggregates.highestStudents.length;
  $('kpiTopStudentsSub').textContent = hiCount > 0
    ? `${hiCount} top performer${hiCount > 1 ? 's' : ''}`
    : 'Top score recorded';

  $('kpiStudentsWithNA').textContent = aggregates.studentsWithNA;
  $('kpiNaRateBadge').textContent = `${aggregates.studentsWithNA_Pct}%`;

  $('kpiPassRate').textContent = `${aggregates.passRate}%`;
  $('kpiPassCountSub').textContent = `${aggregates.passCount} of ${aggregates.totalStudents} passed`;
  $('kpiThresholdLabel').textContent = `Pass Mark: ≥ ${state.threshold}% (${(TOTAL_MAX * state.threshold / 100).toFixed(0)}M)`;

  // Section Breakdown Cards
  const sec = aggregates.sectionStats;

  // Verbal (10M)
  $('verbalAvgVal').innerHTML = `${sec.verbal.average.toFixed(1)} <small>/ 10</small>`;
  $('verbalHighVal').innerHTML = `${sec.verbal.highest} <small>/ 10</small>`;
  $('verbalAttemptedVal').textContent = `${sec.verbal.attemptedCount} / ${aggregates.totalStudents}`;
  $('verbalAvgPctChip').textContent = `${sec.verbal.avgPct}% Avg`;
  $('verbalAttemptRate').textContent = `${sec.verbal.attemptRate}%`;
  $('verbalAttemptBar').style.width = `${sec.verbal.attemptRate}%`;

  // Java MCQ's (20M)
  $('javaAvgVal').innerHTML = `${sec.java.average.toFixed(1)} <small>/ 20</small>`;
  $('javaHighVal').innerHTML = `${sec.java.highest} <small>/ 20</small>`;
  $('javaAttemptedVal').textContent = `${sec.java.attemptedCount} / ${aggregates.totalStudents}`;
  $('javaAvgPctChip').textContent = `${sec.java.avgPct}% Avg`;
  $('javaAttemptRate').textContent = `${sec.java.attemptRate}%`;
  $('javaAttemptBar').style.width = `${sec.java.attemptRate}%`;

  // Coding (20M)
  $('codingAvgVal').innerHTML = `${sec.coding.average.toFixed(1)} <small>/ 20</small>`;
  $('codingHighVal').innerHTML = `${sec.coding.highest} <small>/ 20</small>`;
  $('codingAttemptedVal').textContent = `${sec.coding.attemptedCount} / ${aggregates.totalStudents}`;
  $('codingAvgPctChip').textContent = `${sec.coding.avgPct}% Avg`;
  $('codingAttemptRate').textContent = `${sec.coding.attemptRate}%`;
  $('codingAttemptBar').style.width = `${sec.coding.attemptRate}%`;
}

/**
 * Updates Combined Sheets Special Panel:
 * 1. Average of every section
 * 2. Top 10 and Below 10 persons separately
 */
function updateCombinedAnalyticsPanel(allCombinedStudents) {
  const panel = $('combinedAnalyticsPanel');
  if (state.viewMode !== 'multiple' || allCombinedStudents.length === 0) {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = 'flex';
  $('combinedSheetsTag').textContent = `${state.sheets.length} Sheets Combined`;

  // 1. Calculate Combined Section Averages
  const aggregates = computeDashboardAggregates(allCombinedStudents, state.threshold);
  const sec = aggregates.sectionStats;

  // Verbal (10M)
  $('combAvgVerbal').textContent = sec.verbal.average.toFixed(1);
  $('combPctVerbal').textContent = `${sec.verbal.avgPct}% Average Score`;
  $('combAttemptVerbal').textContent = `Attempt Rate: ${sec.verbal.attemptRate}% (${sec.verbal.attemptedCount} students)`;

  // Java (20M)
  $('combAvgJava').textContent = sec.java.average.toFixed(1);
  $('combPctJava').textContent = `${sec.java.avgPct}% Average Score`;
  $('combAttemptJava').textContent = `Attempt Rate: ${sec.java.attemptRate}% (${sec.java.attemptedCount} students)`;

  // Coding (20M)
  $('combAvgCoding').textContent = sec.coding.average.toFixed(1);
  $('combPctCoding').textContent = `${sec.coding.avgPct}% Average Score`;
  $('combAttemptCoding').textContent = `Attempt Rate: ${sec.coding.attemptRate}% (${sec.coding.attemptedCount} students)`;

  // Total (50M)
  $('combAvgTotal').textContent = aggregates.averageTotal.toFixed(1);
  $('combPctTotal').textContent = `${((aggregates.averageTotal / TOTAL_MAX) * 100).toFixed(1)}% Combined Average`;
  $('combPassRate').textContent = `Pass Rate: ${aggregates.passRate}% (${aggregates.passCount} passed)`;

  // 2. Calculate Top 10 and Below 10 Persons
  // Sort all students by totalScore descending
  const sortedDesc = [...allCombinedStudents].sort((a, b) => b.totalScore - a.totalScore);

  const top10 = sortedDesc.slice(0, 10);
  const topCount = top10.length;
  $('top10CountPill').textContent = `${topCount} Student${topCount > 1 ? 's' : ''}`;

  // Below 10: Sort ascending (lowest totalScore first)
  const sortedAsc = [...allCombinedStudents].sort((a, b) => a.totalScore - b.totalScore);
  const below10 = sortedAsc.slice(0, 10);
  const belowCount = below10.length;
  $('below10CountPill').textContent = `${belowCount} Student${belowCount > 1 ? 's' : ''}`;

  // Render Top 10 Table Rows
  const topTbody = $('top10TableBody');
  topTbody.innerHTML = top10.map((s, idx) => {
    const rank = idx + 1;
    let rankBadgeClass = 'rank-general';
    if (rank === 1) rankBadgeClass = 'rank-1';
    else if (rank === 2) rankBadgeClass = 'rank-2';
    else if (rank === 3) rankBadgeClass = 'rank-3';

    return `
      <tr class="clickable-row" data-id="${escapeHtml(s.id)}">
        <td><span class="rank-badge ${rankBadgeClass}">#${rank}</span></td>
        <td>
          <div style="font-weight:700;color:var(--ink-primary);">${escapeHtml(s.name)}</div>
          <div style="font-size:0.7rem;color:var(--ink-muted);" class="num">${escapeHtml(s.id)}</div>
        </td>
        <td><span class="cell-group-badge">${escapeHtml(s.group)}</span></td>
        <td style="text-align:right;">${formatScoreCell(s.verbal, 10)}</td>
        <td style="text-align:right;">${formatScoreCell(s.java, 20)}</td>
        <td style="text-align:right;">${formatScoreCell(s.coding, 20)}</td>
        <td style="text-align:right;">${formatTotalCell(s)}</td>
        <td><span class="source-sheet-badge">${escapeHtml(s.sourceSheet)}</span></td>
      </tr>
    `;
  }).join('');

  // Render Below 10 Table Rows
  const belowTbody = $('below10TableBody');
  belowTbody.innerHTML = below10.map((s, idx) => {
    const bottomRank = sortedDesc.length - (belowCount - 1 - idx);

    return `
      <tr class="clickable-row" data-id="${escapeHtml(s.id)}">
        <td><span class="rank-badge rank-low">#${bottomRank}</span></td>
        <td>
          <div style="font-weight:700;color:var(--ink-primary);">${escapeHtml(s.name)}</div>
          <div style="font-size:0.7rem;color:var(--ink-muted);" class="num">${escapeHtml(s.id)}</div>
        </td>
        <td><span class="cell-group-badge">${escapeHtml(s.group)}</span></td>
        <td style="text-align:right;">${formatScoreCell(s.verbal, 10)}</td>
        <td style="text-align:right;">${formatScoreCell(s.java, 20)}</td>
        <td style="text-align:right;">${formatScoreCell(s.coding, 20)}</td>
        <td style="text-align:right;">${formatTotalCell(s)}</td>
        <td><span class="source-sheet-badge">${escapeHtml(s.sourceSheet)}</span></td>
      </tr>
    `;
  }).join('');

  // Attach click listeners to open student modal on row click
  topTbody.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', () => {
      const s = allCombinedStudents.find(x => x.id === tr.dataset.id);
      if (s) openStudentDetailModal(s);
    });
  });

  belowTbody.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', () => {
      const s = allCombinedStudents.find(x => x.id === tr.dataset.id);
      if (s) openStudentDetailModal(s);
    });
  });

  // Render Combined-Only Charts
  // 1. Test Average Comparison (one bar per sheet)
  const sheetSummaries = state.sheets.map(sh => {
    const agg = computeDashboardAggregates(sh.students, state.threshold);
    return {
      name: sh.name,
      averageTotal: parseFloat(agg.averageTotal.toFixed(1)),
      passRate: agg.passRate,
      highestTotal: agg.highestTotal,
      studentCount: agg.totalStudents
    };
  });
  charts.renderTestAveragesChart('chartTestAverages', sheetSummaries);

  // 2. Combined Section Average Graph
  charts.renderCombinedSectionAvgChart('chartCombinedSectionAvg', aggregates);

  // 3. Attempted vs Not Attempted (section-level)
  charts.renderAttemptedVsNotAttemptedChart('chartAttemptedVsNot', aggregates);

  // 4. Group Performance Benchmark (combined)
  charts.renderCombinedGroupPerformance('chartCombinedGroupPerf', aggregates);
}

/**
 * Updates filter tab counts and group chips
 */
function updateFilterControls(allStudentsInDataset) {
  const total = allStudentsInDataset.length;
  let fullCount = 0;
  let naCount = 0;
  let zeroCount = 0;
  let failCount = 0;

  const groupCounts = new Map();

  allStudentsInDataset.forEach(s => {
    if (s.attemptedCount === 3) fullCount++;
    if (s.unattemptedCount > 0) naCount++;
    if (
      (s.verbal.isAttempted && s.verbal.score === 0) ||
      (s.java.isAttempted && s.java.score === 0) ||
      (s.coding.isAttempted && s.coding.score === 0)
    ) {
      zeroCount++;
    }
    if (s.percentage < state.threshold) failCount++;

    groupCounts.set(s.group, (groupCounts.get(s.group) || 0) + 1);
  });

  // Update tab labels
  $('countTabAll').textContent = total;
  $('countTabFull').textContent = fullCount;
  $('countTabNa').textContent = naCount;
  $('countTabZero').textContent = zeroCount;
  $('countTabFailed').textContent = failCount;

  // Render Group Chips
  const container = $('groupChipsContainer');
  let chipsHtml = `
    <button class="group-chip ${state.selectedGroups.size === 0 ? 'active' : ''}" data-group="__ALL__" type="button">
      <span>All Groups</span>
      <span class="group-chip-count">${total}</span>
    </button>
  `;

  Array.from(groupCounts.entries()).sort((a, b) => b[1] - a[1]).forEach(([grp, count]) => {
    const isSelected = state.selectedGroups.has(grp);
    chipsHtml += `
      <button class="group-chip ${isSelected ? 'active' : ''}" data-group="${escapeHtml(grp)}" type="button">
        <span>${escapeHtml(grp.replace(/2025-2029-Prime-/, ''))}</span>
        <span class="group-chip-count">${count}</span>
      </button>
    `;
  });

  container.innerHTML = chipsHtml;

  // Attach group chip listeners
  container.querySelectorAll('.group-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const g = btn.dataset.group;
      if (g === '__ALL__') {
        state.selectedGroups.clear();
      } else {
        if (state.selectedGroups.has(g)) {
          state.selectedGroups.delete(g);
        } else {
          state.selectedGroups.add(g);
        }
      }
      state.currentPage = 1;
      renderDashboard();
    });
  });

  // Filter feedback row
  const feedbackRow = $('filterFeedbackRow');
  const feedbackText = $('filterFeedbackText');
  const activeFilters = [];

  if (state.searchQuery) activeFilters.push(`Search: "${state.searchQuery}"`);
  if (state.selectedGroups.size > 0) activeFilters.push(`Groups: ${Array.from(state.selectedGroups).join(', ')}`);
  if (state.statusFilter !== 'all') activeFilters.push(`Status: ${state.statusFilter.replace('_', ' ').toUpperCase()}`);

  if (activeFilters.length > 0) {
    feedbackRow.style.display = 'flex';
    feedbackText.textContent = `Active Filters: ${activeFilters.join(' | ')}`;
  } else {
    feedbackRow.style.display = 'none';
  }
}

/**
 * Renders the Student Results Table with pagination
 */
function renderStudentTable(students) {
  const tbody = $('studentTableBody');
  const emptyState = $('tableEmptyState');
  const summaryText = $('tableSummaryText');
  const paginationControls = $('paginationControls');

  const total = students.length;

  if (total === 0) {
    tbody.innerHTML = '';
    emptyState.style.display = 'flex';
    summaryText.textContent = 'Showing 0 students';
    paginationControls.innerHTML = '';
    return;
  }

  emptyState.style.display = 'none';

  // Calculate pagination
  const pageSize = state.pageSize === 'all' ? total : parseInt(state.pageSize, 10);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (state.currentPage > totalPages) state.currentPage = totalPages;
  const startIdx = (state.currentPage - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, total);
  const pageStudents = students.slice(startIdx, endIdx);

  summaryText.textContent = `Showing ${startIdx + 1} to ${endIdx} of ${total} students`;

  // Render Table Rows
  tbody.innerHTML = pageStudents.map(s => {
    const isPass = s.percentage >= state.threshold;
    const resultPill = isPass
      ? `<span class="status-pill pass">Pass</span>`
      : `<span class="status-pill fail">Fail</span>`;

    const attemptPill = s.attemptedCount === 3
      ? `<span class="attempt-pill full" title="All 3 sections attempted">Full (3/3)</span>`
      : `<span class="attempt-pill partial" title="${s.unattemptedCount} section(s) not attempted">Partial (${s.attemptedCount}/3)</span>`;

    const sourceCell = state.viewMode === 'multiple'
      ? `<td><span class="source-sheet-badge">${escapeHtml(s.sourceSheet)}</span></td>`
      : '';

    return `
      <tr data-student-id="${escapeHtml(s.id)}" class="${s.isDuplicate ? 'row-duplicate' : ''}">
        <td class="cell-member-id num">${escapeHtml(s.id)}</td>
        <td class="cell-student-name">${escapeHtml(s.name)}</td>
        <td class="cell-email">${escapeHtml(s.email || '—')}</td>
        <td><span class="cell-group-badge">${escapeHtml(s.group)}</span></td>
        <td class="score-cell">${formatScoreCell(s.verbal, 10)}</td>
        <td class="score-cell">${formatScoreCell(s.java, 20)}</td>
        <td class="score-cell">${formatScoreCell(s.coding, 20)}</td>
        <td class="score-cell">${formatTotalCell(s)}</td>
        <td>${attemptPill}</td>
        <td>${resultPill}</td>
        ${sourceCell}
        <td>
          <button class="btn btn-xs btn-outline btn-view-report" data-id="${escapeHtml(s.id)}" type="button">
            View
          </button>
        </td>
      </tr>
    `;
  }).join('');

  // Row Click Listener (Opens Student Detail Modal)
  tbody.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', (e) => {
      const studentId = tr.dataset.studentId;
      const student = students.find(x => x.id === studentId);
      if (student) openStudentDetailModal(student);
    });
  });

  // Render Pagination Controls
  renderPagination(totalPages);

  // Update Sorting Column Headers UI
  updateSortHeadersUI();
}

/**
 * Builds pagination buttons
 */
function renderPagination(totalPages) {
  const container = $('paginationControls');
  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = `
    <button class="page-btn" ${state.currentPage === 1 ? 'disabled' : ''} data-page="${state.currentPage - 1}" type="button">
      ‹
    </button>
  `;

  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p - state.currentPage) <= 1) {
      html += `
        <button class="page-btn ${p === state.currentPage ? 'active' : ''}" data-page="${p}" type="button">
          ${p}
        </button>
      `;
    } else if (Math.abs(p - state.currentPage) === 2) {
      html += `<span class="page-ellipsis">…</span>`;
    }
  }

  html += `
    <button class="page-btn ${state.currentPage === totalPages ? 'disabled' : ''} data-page="${state.currentPage + 1}" type="button">
      ›
    </button>
  `;

  container.innerHTML = html;

  container.querySelectorAll('button[data-page]').forEach(b => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const p = parseInt(b.dataset.page, 10);
      if (p >= 1 && p <= totalPages) {
        state.currentPage = p;
        const students = getFilteredAndSortedStudents();
        renderStudentTable(students);
      }
    });
  });
}

/**
 * Updates sort icons on table headers
 */
function updateSortHeadersUI() {
  document.querySelectorAll('th.th-sortable').forEach(th => {
    const col = th.dataset.sort;
    th.classList.remove('sorted-asc', 'sorted-desc');
    const icon = th.querySelector('.sort-icon');
    if (col === state.sortColumn) {
      if (state.sortDirection === 'asc') {
        th.classList.add('sorted-asc');
        if (icon) icon.textContent = '▲';
      } else {
        th.classList.add('sorted-desc');
        if (icon) icon.textContent = '▼';
      }
    } else {
      if (icon) icon.textContent = '⇅';
    }
  });
}

/**
 * Master Render Cycle: computes aggregates, updates charts, tables, KPIs, and zero state
 */
function renderDashboard() {
  const zeroState = $('zeroStateContainer');
  const dashboard = $('dashboardContent');

  // If no spreadsheets are uploaded yet, show clean zero state
  if (state.sheets.length === 0) {
    zeroState.style.display = 'flex';
    dashboard.style.display = 'none';
    $('totalSheetsCount').textContent = '0';
    $('btnModeSingle').classList.add('active');
    $('btnModeMultiple').classList.remove('active');
    $('validationBanner').style.display = 'none';
    return;
  }

  zeroState.style.display = 'none';
  dashboard.style.display = 'block';

  updateHeaderAndContext();

  const activeDataset = getActiveDataset();
  const aggregates = computeDashboardAggregates(activeDataset, state.threshold);

  // Combined Section Averages & Top 10 / Below 10 Persons
  updateCombinedAnalyticsPanel(activeDataset);

  // If switching away from combined mode, destroy combined-only charts
  if (state.viewMode !== 'multiple') {
    charts.destroy('testAverages');
    charts.destroy('attemptedVsNot');
    charts.destroy('combinedGroupPerf');
    charts.destroy('combinedSectionAvg');
  }

  updateKPIsAndSections(aggregates);
  updateFilterControls(activeDataset);

  // Render Charts
  charts.renderScoreDistribution('chartScoreDistribution', aggregates);
  charts.renderSectionPerformance('chartSectionPerformance', aggregates);
  charts.renderGroupPerformance('chartGroupPerformance', aggregates);
  charts.renderAttemptStatus('chartAttemptStatus', aggregates);

  // Render Student Results Table
  const filteredStudents = getFilteredAndSortedStudents();
  renderStudentTable(filteredStudents);
}

/**
 * Opens the Individual Student Assessment Modal
 */
function openStudentDetailModal(student) {
  state.currentModalStudent = student;

  $('studentDetailAvatar').textContent = student.name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0])
    .join('')
    .toUpperCase() || 'ST';

  $('studentDetailName').textContent = student.name;
  $('studentDetailId').textContent = `ID: ${student.id}`;
  $('studentDetailEmail').textContent = student.email || 'No email registered';
  $('studentDetailGroup').textContent = student.group;
  $('studentDetailSource').textContent = `Source: ${student.sourceSheet}`;

  const isPass = student.percentage >= state.threshold;
  const pill = $('studentDetailResultPill');
  pill.className = `status-pill ${isPass ? 'pass' : 'fail'}`;
  pill.textContent = isPass ? 'Pass' : 'Fail';

  $('studentModalTotal').innerHTML = `${student.totalScore} <small>/ 50M</small>`;
  $('studentModalPartialNote').textContent = student.isPartial
    ? `* Partial Total (${student.unattemptedCount} section NA)`
    : 'Full test attempted';

  $('studentModalPct').textContent = `${student.percentage}%`;

  // Rank calculation within current dataset
  const dataset = getActiveDataset();
  const sorted = [...dataset].sort((a, b) => b.totalScore - a.totalScore);
  const rank = sorted.findIndex(s => s.id === student.id) + 1;
  $('studentModalRank').textContent = `#${rank}`;
  $('studentModalTotalStudents').textContent = `of ${dataset.length} students`;

  $('studentModalAttemptStatus').textContent = `${student.attemptedCount} / 3`;
  $('studentModalNaStatus').textContent = `${student.unattemptedCount} Unattempted`;

  // Populate Section Table inside modal
  const tbody = $('studentModalSecTableBody');
  tbody.innerHTML = SECTION_CONFIG.map(sec => {
    const c = student.sections[sec.key];
    const isAtt = c.isAttempted && c.score !== null;
    const scoreVal = isAtt ? c.score : 'NA';
    const pct = isAtt ? ((c.score / sec.max) * 100).toFixed(0) + '%' : '—';
    const statusPill = isAtt
      ? (c.score === 0 ? '<span class="status-pill fail">Scored 0</span>' : '<span class="status-pill pass">Attempted</span>')
      : '<span class="score-badge badge-na">Not Attempted</span>';

    return `
      <tr>
        <td><strong>${escapeHtml(sec.name)}</strong></td>
        <td class="num">${sec.max}M</td>
        <td class="num"><strong>${scoreVal}</strong></td>
        <td class="num">${pct}</td>
        <td>${statusPill}</td>
      </tr>
    `;
  }).join('');

  // Render Mini Modal Chart
  charts.renderStudentModalChart('studentModalChartCanvas', student);

  $('modalStudentDetail').style.display = 'flex';
}

function closeStudentDetailModal() {
  $('modalStudentDetail').style.display = 'none';
  state.currentModalStudent = null;
}

/**
 * Prints the Individual Student Report Card
 */
function printIndividualStudentReport() {
  const s = state.currentModalStudent;
  if (!s) return;

  $('printStudentName').textContent = s.name;
  $('printStudentId').textContent = s.id;
  $('printStudentEmail').textContent = s.email || '—';
  $('printStudentGroup').textContent = s.group;
  $('printStudentSource').textContent = s.sourceSheet;

  const dataset = getActiveDataset();
  const sorted = [...dataset].sort((a, b) => b.totalScore - a.totalScore);
  const rank = sorted.findIndex(x => x.id === s.id) + 1;
  $('printStudentRank').textContent = `#${rank} of ${dataset.length}`;

  const isPass = s.percentage >= state.threshold;
  $('printReportDate').textContent = `Date: ${new Date().toLocaleDateString('en-GB')}`;

  // Populate Print KPIs
  $('printStudentKpis').innerHTML = `
    <div class="print-kpi-item">
      <div class="label">Total Score</div>
      <div class="value num">${s.totalScore} / 50M ${s.isPartial ? '*' : ''}</div>
    </div>
    <div class="print-kpi-item">
      <div class="label">Percentage</div>
      <div class="value num">${s.percentage}%</div>
    </div>
    <div class="print-kpi-item">
      <div class="label">Class Rank</div>
      <div class="value num">#${rank}</div>
    </div>
    <div class="print-kpi-item">
      <div class="label">Result</div>
      <div class="value" style="color: ${isPass ? '#10B981' : '#EF4444'}">${isPass ? 'PASS' : 'FAIL'}</div>
    </div>
  `;

  // Populate Print Table
  $('printStudentTable').innerHTML = `
    <thead>
      <tr>
        <th>Section</th>
        <th>Maximum</th>
        <th>Marks Obtained</th>
        <th>Percentage</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      ${SECTION_CONFIG.map(sec => {
        const c = s.sections[sec.key];
        const isAtt = c.isAttempted && c.score !== null;
        return `
          <tr>
            <td><strong>${escapeHtml(sec.name)}</strong></td>
            <td class="num">${sec.max}</td>
            <td class="num"><strong>${isAtt ? c.score : 'NA'}</strong></td>
            <td class="num">${isAtt ? ((c.score / sec.max) * 100).toFixed(1) + '%' : '—'}</td>
            <td>${isAtt ? (c.score === 0 ? 'Zero Marks' : 'Attempted') : 'Not Attempted'}</td>
          </tr>
        `;
      }).join('')}
    </tbody>
  `;

  document.body.classList.add('printing-student');
  closeStudentDetailModal();
  window.print();
}

/**
 * Handles browser print events for Chart.js resizing and student printing
 */
window.addEventListener('beforeprint', () => {
  charts.resizeAll();
});

window.addEventListener('afterprint', () => {
  if (document.body.classList.contains('printing-student')) {
    document.body.classList.remove('printing-student');
  }
  charts.resizeAll();
});

/**
 * File Import & Processing using SheetJS
 */
async function processFiles(files) {
  if (!files || files.length === 0) return;

  const newSheets = [];

  for (const file of files) {
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });

      workbook.SheetNames.forEach(sheetName => {
        const worksheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

        if (rows.length > 0) {
          const headers = Object.keys(rows[0]);
          const mapping = autoDetectMapping(headers);
          const normalized = normalizeStudentRows(rows, mapping, {
            sheetName: workbook.SheetNames.length > 1 ? `${file.name.replace(/\.[^/.]+$/, '')} - ${sheetName}` : sheetName,
            fileName: file.name
          });

          newSheets.push({
            id: `sheet-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            name: workbook.SheetNames.length > 1 ? `${file.name.replace(/\.[^/.]+$/, '')} (${sheetName})` : file.name.replace(/\.[^/.]+$/, ''),
            fileName: file.name,
            rawRows: rows,
            headers,
            mapping,
            students: normalized.students,
            duplicateCount: normalized.duplicateCount,
            parseIssues: normalized.parseIssues
          });
        }
      });
    } catch (err) {
      console.error('Failed to parse file:', file.name, err);
      showToast(`Error reading ${file.name}. Please check file format.`);
    }
  }

  if (newSheets.length > 0) {
    state.sheets = newSheets;
    state.activeSheetId = newSheets[0].id;
    state.currentPage = 1;
    state.selectedGroups.clear();
    showToast(`Imported ${newSheets.length} sheet(s) with ${getActiveDataset().length} total students!`);
    renderDashboard();
  }
}

/**
 * Excel Export with SheetJS
 */
function exportFilteredToExcel() {
  const students = getFilteredAndSortedStudents();
  if (students.length === 0) {
    showToast('No students to export.');
    return;
  }

  try {
    const header = [
      'Member Id',
      'Name',
      'Email',
      'Groups',
      'Verbal (10M)',
      'Java MCQ\'s (20M)',
      'Coding (20M)',
      'Total (50M)',
      'Is Partial Total',
      'Attempted Count',
      'Percentage',
      'Result',
      'Source Sheet'
    ];

    const rows = students.map(s => [
      s.id,
      s.name,
      s.email,
      s.group,
      s.verbal.isAttempted ? s.verbal.score : 'NA',
      s.java.isAttempted ? s.java.score : 'NA',
      s.coding.isAttempted ? s.coding.score : 'NA',
      s.totalScore,
      s.isPartial ? 'YES' : 'NO',
      `${s.attemptedCount}/3`,
      `${s.percentage}%`,
      s.percentage >= state.threshold ? 'Pass' : 'Fail',
      s.sourceSheet
    ]);

    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    ws['!cols'] = [
      { wch: 15 },
      { wch: 28 },
      { wch: 26 },
      { wch: 24 },
      { wch: 14 },
      { wch: 16 },
      { wch: 14 },
      { wch: 14 },
      { wch: 16 },
      { wch: 16 },
      { wch: 12 },
      { wch: 10 },
      { wch: 20 }
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Student_Assessment_Report');

    // Summary sheet
    const activeDataset = getActiveDataset();
    const agg = computeDashboardAggregates(activeDataset, state.threshold);
    const summaryHeader = ['Group Name', 'Students', 'Average Total (/50M)', 'Pass Rate %', 'NA Count'];
    const summaryRows = agg.groupStats.map(g => [g.name, g.count, g.averageTotal, `${g.passRate}%`, g.naCount]);
    const summaryWs = XLSX.utils.aoa_to_sheet([summaryHeader, ...summaryRows]);
    XLSX.utils.book_append_sheet(wb, summaryWs, 'Group_Analytics_Summary');

    const fileName = `CT_QISCET_Report_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
    showToast(`Excel file ${fileName} downloaded!`);
  } catch (err) {
    console.error('Export error:', err);
    showToast('Failed to generate Excel file.');
  }
}

/**
 * CSV Export
 */
function exportFilteredToCSV() {
  const students = getFilteredAndSortedStudents();
  if (students.length === 0) {
    showToast('No students to export.');
    return;
  }

  const header = ['Member Id,Name,Email,Groups,Verbal(10M),Java MCQs(20M),Coding(20M),Total(50M),Attempt Status,Percentage,Result,Source Sheet'];
  const rows = students.map(s => {
    return [
      `"${s.id}"`,
      `"${s.name.replace(/"/g, '""')}"`,
      `"${s.email}"`,
      `"${s.group}"`,
      s.verbal.isAttempted ? s.verbal.score : 'NA',
      s.java.isAttempted ? s.java.score : 'NA',
      s.coding.isAttempted ? s.coding.score : 'NA',
      s.totalScore,
      s.isPartial ? `"Partial (${s.unattemptedCount} NA)"` : '"Full (3/3)"',
      `"${s.percentage}%"`,
      s.percentage >= state.threshold ? '"Pass"' : '"Fail"',
      `"${s.sourceSheet}"`
    ].join(',');
  });

  const csvContent = 'data:text/csv;charset=utf-8,' + [header, ...rows].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `CT_QISCET_Results_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('CSV file downloaded successfully!');
}

/**
 * Setup Event Listeners
 */
function setupEventListeners() {
  // Mode switcher (Single Sheet vs Combined Sheets)
  $('btnModeSingle').addEventListener('click', (e) => {
    e.stopPropagation();
    state.viewMode = 'single';
    renderDashboard();
  });

  $('btnModeMultiple').addEventListener('click', (e) => {
    e.stopPropagation();
    state.viewMode = 'multiple';
    renderDashboard();
  });

  // Sheet selector dropdown in context ribbon
  $('sheetSelector').addEventListener('change', (e) => {
    state.activeSheetId = e.target.value;
    state.currentPage = 1;
    renderDashboard();
  });

  // Search input
  const searchInput = $('searchInput');
  const btnClearSearch = $('btnClearSearch');

  searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value.trim();
    btnClearSearch.style.display = state.searchQuery ? 'block' : 'none';
    state.currentPage = 1;
    renderDashboard();
  });

  btnClearSearch.addEventListener('click', () => {
    searchInput.value = '';
    state.searchQuery = '';
    btnClearSearch.style.display = 'none';
    state.currentPage = 1;
    renderDashboard();
  });

  // Status Filter Tabs
  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.statusFilter = tab.dataset.filter;
      state.currentPage = 1;
      renderDashboard();
    });
  });

  // Threshold Input
  $('inputThreshold').addEventListener('input', (e) => {
    let val = parseFloat(e.target.value);
    if (isNaN(val)) val = 40;
    val = Math.max(0, Math.min(100, val));
    state.threshold = val;
    renderDashboard();
  });

  // Page Size Selector
  $('selectPageSize').addEventListener('change', (e) => {
    state.pageSize = e.target.value;
    state.currentPage = 1;
    renderDashboard();
  });

  // Clear all filters button
  $('btnClearAllFilters').addEventListener('click', () => {
    state.searchQuery = '';
    searchInput.value = '';
    btnClearSearch.style.display = 'none';
    state.selectedGroups.clear();
    state.statusFilter = 'all';
    document.querySelectorAll('.filter-tab').forEach(t => t.classList.toggle('active', t.dataset.filter === 'all'));
    state.currentPage = 1;
    renderDashboard();
  });

  $('btnEmptyResetFilters').addEventListener('click', () => {
    $('btnClearAllFilters').click();
  });

  // Table Sort Headers Click
  document.querySelectorAll('th.th-sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (state.sortColumn === col) {
        state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortColumn = col;
        state.sortDirection = ['name', 'id', 'email', 'group'].includes(col) ? 'asc' : 'desc';
      }
      renderDashboard();
    });
  });

  // Export Dropdown Toggle
  const btnExportMenu = $('btnExportMenu');
  const exportDropdown = $('exportDropdownMenu');

  btnExportMenu.addEventListener('click', (e) => {
    e.stopPropagation();
    exportDropdown.classList.toggle('show');
  });

  document.addEventListener('click', (e) => {
    if (!exportDropdown.contains(e.target) && e.target !== btnExportMenu) {
      exportDropdown.classList.remove('show');
    }
  });

  $('btnExportExcel').addEventListener('click', () => {
    exportDropdown.classList.remove('show');
    exportFilteredToExcel();
  });

  $('btnExportCsv').addEventListener('click', () => {
    exportDropdown.classList.remove('show');
    exportFilteredToCSV();
  });

  $('btnPrintDashboard').addEventListener('click', () => {
    exportDropdown.classList.remove('show');
    window.print();
  });

  // Upload Modal Handlers
  const uploadModal = $('modalUpload');
  const fileInput = $('fileInput');
  const dropzone = $('fileDropzone');
  const fileItemsContainer = $('fileItemsContainer');
  const queuedCount = $('queuedFileCount');
  const btnProcessFiles = $('btnProcessUploadedFiles');

  $('btnOpenUploadModal').addEventListener('click', () => {
    state.queuedFiles = [];
    fileItemsContainer.innerHTML = '';
    $('uploadFileList').style.display = 'none';
    btnProcessFiles.disabled = true;
    uploadModal.style.display = 'flex';
  });

  $('btnCloseUploadModal').addEventListener('click', () => uploadModal.style.display = 'none');
  $('btnCancelUpload').addEventListener('click', () => uploadModal.style.display = 'none');

  dropzone.addEventListener('click', () => fileInput.click());

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleQueuedFiles(Array.from(e.dataTransfer.files));
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleQueuedFiles(Array.from(e.target.files));
    }
  });

  // Zero-state Dropzone & Browse button
  const zeroDropzone = $('zeroDropzone');
  const zeroFileInput = $('zeroFileInput');
  const btnZeroBrowse = $('btnZeroBrowse');

  if (zeroDropzone && zeroFileInput) {
    zeroDropzone.addEventListener('click', (e) => {
      if (e.target !== btnZeroBrowse) {
        zeroFileInput.click();
      }
    });

    btnZeroBrowse.addEventListener('click', (e) => {
      e.stopPropagation();
      zeroFileInput.click();
    });

    zeroDropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zeroDropzone.classList.add('dragover');
    });

    zeroDropzone.addEventListener('dragleave', () => zeroDropzone.classList.remove('dragover'));

    zeroDropzone.addEventListener('drop', async (e) => {
      e.preventDefault();
      zeroDropzone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        await processFiles(Array.from(e.dataTransfer.files));
      }
    });

    zeroFileInput.addEventListener('change', async (e) => {
      if (e.target.files && e.target.files.length > 0) {
        await processFiles(Array.from(e.target.files));
      }
    });
  }

  // Load Demonstration Data Button in Zero State (optional test utility)
  const btnLoadDemo = $('btnLoadDemoData');
  if (btnLoadDemo) {
    btnLoadDemo.addEventListener('click', () => {
      state.sheets = [
        initializeSheet(SAMPLE_SHEET_1),
        initializeSheet(SAMPLE_SHEET_2)
      ];
      state.activeSheetId = state.sheets[0].id;
      state.viewMode = 'multiple'; // open combined view to show all requested features
      state.searchQuery = '';
      state.selectedGroups.clear();
      state.statusFilter = 'all';
      state.currentPage = 1;
      showToast('Loaded demo datasets: Prime Batch 1 & Batch 2 combined!');
      renderDashboard();
    });
  }

  function handleQueuedFiles(files) {
    state.queuedFiles = files;
    queuedCount.textContent = files.length;
    fileItemsContainer.innerHTML = files.map(f => `
      <div class="file-item-row">
        <span class="file-item-name">${escapeHtml(f.name)}</span>
        <span class="file-item-size">${(f.size / 1024).toFixed(1)} KB</span>
      </div>
    `).join('');
    $('uploadFileList').style.display = 'block';
    btnProcessFiles.disabled = false;
  }

  btnProcessFiles.addEventListener('click', async () => {
    uploadModal.style.display = 'none';
    await processFiles(state.queuedFiles);
  });

  // Validation Banner close
  $('btnCloseValidationBanner').addEventListener('click', () => $('validationBanner').style.display = 'none');

  // Student Detail Modal
  $('btnCloseStudentModal').addEventListener('click', closeStudentDetailModal);
  $('btnCloseStudentModalBtn').addEventListener('click', closeStudentDetailModal);
  $('btnPrintStudentReport').addEventListener('click', printIndividualStudentReport);
}

/**
 * App Bootstrapper
 */
function initApp() {
  // Start with empty state: no sample data pre-loaded
  state.sheets = [];
  state.activeSheetId = null;

  setupEventListeners();
  renderDashboard();

  console.log('CT-QISCET Test Reports platform ready.');
}

// Start application once DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
