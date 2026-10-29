// CT-QIS Test Reports - Main Application Controller
import * as XLSX from 'xlsx';
import {
  DEFAULT_SECTION_CONFIG,
  TOTAL_MAX,
  detectSectionsFromData,
  detectTotalMax,
  autoDetectMapping,
  normalizeStudentRows,
  computeDashboardAggregates,
  parseScoreCell
} from './data-processor.js';
import { DashboardCharts } from './charts-manager.js';
import { downloadIndividualStudentPdf, downloadClassWiseProgressReportPdf } from './pdf-generator.js';

// Application State
const state = {
  // Collection of uploaded sheets: [{ id, name, fileName, rawRows, headers, detectedSections, totalMax, mapping, students, duplicateCount, parseIssues }]
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

  const pct = maxScore > 0 ? (score / maxScore) * 100 : 0;
  let tierClass = 'tier-low';
  if (pct >= 75) tierClass = 'tier-high';
  else if (pct >= 40) tierClass = 'tier-mid';

  return `<span class="score-badge ${tierClass}" title="${score}/${maxScore} (${pct.toFixed(0)}%)">${score}</span>`;
}

/**
 * Formats the total score with partial indicator if NA exists
 */
function formatTotalCell(student, totalMax = 50) {
  const isPartial = student.isPartial;
  const scoreText = student.totalScore;

  if (isPartial) {
    const unattempted = student.unattemptedCount;
    return `
      <div class="total-cell-wrap" title="Partial total: ${unattempted} section(s) not attempted">
        <span class="num">${scoreText}</span>
        <span class="partial-star-tag">* Partial</span>
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
 * Returns detected test sections for the active sheet or multi-sheet union
 */
function getActiveSections() {
  if (state.sheets.length === 0) return DEFAULT_SECTION_CONFIG;
  if (state.viewMode === 'single') {
    const cur = state.sheets.find(s => s.id === state.activeSheetId) || state.sheets[0];
    return cur && cur.detectedSections && cur.detectedSections.length > 0
      ? cur.detectedSections
      : DEFAULT_SECTION_CONFIG;
  } else {
    // Collect union of sections across all sheets with canonical deduplication
    const map = new Map();
    state.sheets.forEach(sh => {
      (sh.detectedSections || []).forEach(sec => {
        if (!map.has(sec.key)) {
          map.set(sec.key, { ...sec });
        } else {
          const existing = map.get(sec.key);
          if (sec.max > existing.max) {
            existing.max = sec.max;
            existing.label = `${existing.name} (${sec.max}M)`;
          }
        }
      });
    });
    return map.size > 0 ? Array.from(map.values()) : DEFAULT_SECTION_CONFIG;
  }
}

/**
 * Returns total max score for the active dataset
 */
function getActiveTotalMax() {
  if (state.sheets.length === 0) return 50;
  if (state.viewMode === 'single') {
    const cur = state.sheets.find(s => s.id === state.activeSheetId) || state.sheets[0];
    return cur && cur.totalMax ? cur.totalMax : 50;
  } else {
    const sheetTotals = state.sheets.map(s => s.totalMax).filter(Boolean);
    if (sheetTotals.length > 0 && sheetTotals.every(t => t === sheetTotals[0])) {
      return sheetTotals[0];
    }
    const sections = getActiveSections();
    return sections.length > 0 ? sections.reduce((sum, s) => sum + s.max, 0) : 50;
  }
}

/**
 * Initializes sheets from raw data using background auto-detection
 */
function initializeSheet(sheetRaw) {
  const headers = sheetRaw.columns || Object.keys(sheetRaw.rows[0] || {});
  const detectedSections = detectSectionsFromData(headers, sheetRaw.rows);
  const totalMax = detectTotalMax(headers, detectedSections, sheetRaw.rows);
  const mapping = autoDetectMapping(headers, detectedSections);
  const normalized = normalizeStudentRows(sheetRaw.rows, mapping, {
    sheetName: sheetRaw.name,
    fileName: sheetRaw.fileName
  }, detectedSections, totalMax);

  return {
    id: sheetRaw.id || `sheet-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    name: sheetRaw.name || 'Sheet 1',
    fileName: sheetRaw.fileName || 'Spreadsheet.xlsx',
    rawRows: sheetRaw.rows,
    headers,
    detectedSections,
    totalMax,
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
  const sections = getActiveSections();

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
    list = list.filter(s => s.attemptedCount === sections.length);
  } else if (state.statusFilter === 'has_na') {
    list = list.filter(s => s.unattemptedCount > 0);
  } else if (state.statusFilter === 'has_zero') {
    list = list.filter(s =>
      sections.some(sec => {
        const c = (s.sections && s.sections[sec.key]) || s[sec.key];
        return c && c.isAttempted && c.score === 0;
      })
    );
  } else if (state.statusFilter === 'failed') {
    list = list.filter(s => s.percentage < state.threshold);
  }

  // 4. Sorting
  const key = state.sortColumn;
  const dir = state.sortDirection === 'asc' ? 1 : -1;

  list = [...list].sort((a, b) => {
    let va, vb;

    if (['id', 'name', 'email', 'group', 'totalScore', 'percentage', 'attemptedCount'].includes(key)) {
      va = a[key];
      vb = b[key];
    } else {
      // Dynamic section score sorting
      const ca = (a.sections && a.sections[key]) || a[key];
      const cb = (b.sections && b.sections[key]) || b[key];
      va = ca && ca.isAttempted && ca.score !== null ? ca.score : -1;
      vb = cb && cb.isAttempted && cb.score !== null ? cb.score : -1;
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

  // Update Export PDF Label based on selected section or all classes
  const exportPdfLabel = $('exportPdfLabel');
  if (exportPdfLabel) {
    const hasGroupFilter = state.selectedGroups.size > 0;
    const selectedGroupName = hasGroupFilter ? Array.from(state.selectedGroups)[0] : null;
    exportPdfLabel.textContent = selectedGroupName
      ? `Download Progress Report - ${selectedGroupName} (PDF)`
      : 'Download Progress Report (PDF)';
  }

  // Validation Banner check
  updateValidationBanner();
}

/**
 * Updates the Data Validation Banner if duplicate IDs or parsing errors exist
 */
function updateValidationBanner() {
  const banner = $('validationBanner');
  if (banner) {
    banner.style.display = 'none';
  }
}

/**
 * Updates KPI Summary Cards & Section Breakdown Cards dynamically
 */
function updateKPIsAndSections(aggregates, selectedGroupName = null) {
  const totalMax = aggregates.totalMax || 50;

  // Main KPIs
  $('kpiTotalStudents').textContent = aggregates.totalStudents;
  if (selectedGroupName) {
    const cleanGroup = selectedGroupName.replace(/2025-2029-Prime-/, '');
    $('kpiSheetsSub').textContent = `In section: ${cleanGroup}`;
    $('kpiTotalGroups').textContent = '1';
    $('kpiGroupsSub').textContent = `Active section: ${cleanGroup}`;
  } else {
    $('kpiSheetsSub').textContent = state.viewMode === 'single'
      ? 'In active spreadsheet'
      : `Across ${state.sheets.length} spreadsheets combined`;

    $('kpiTotalGroups').textContent = aggregates.totalGroups;
    $('kpiGroupsSub').textContent = aggregates.totalGroups > 0
      ? aggregates.groupStats.map(g => g.name.replace(/2025-2029-Prime-/, '')).slice(0, 3).join(', ')
      : 'No groups found';
  }

  $('kpiAverageTotal').textContent = aggregates.averageTotal.toFixed(1);
  $('kpiAvgPctSub').textContent = `${((aggregates.averageTotal / totalMax) * 100).toFixed(1)}% class average`;
  const kpiTotalUnit = document.querySelector('#kpiAverageTotal + .kpi-unit');
  if (kpiTotalUnit) kpiTotalUnit.textContent = `/ ${totalMax}M`;

  $('kpiHighestTotal').textContent = aggregates.highestTotal;
  const kpiHiUnit = document.querySelector('#kpiHighestTotal + .kpi-unit');
  if (kpiHiUnit) kpiHiUnit.textContent = `/ ${totalMax}M`;

  const hiCount = aggregates.highestStudents.length;
  $('kpiTopStudentsSub').textContent = hiCount > 0
    ? `${hiCount} top student${hiCount > 1 ? 's' : ''}`
    : 'Top score recorded';

  $('kpiStudentsWithNA').textContent = aggregates.studentsWithNA;
  $('kpiNaRateBadge').textContent = `${aggregates.studentsWithNA_Pct}%`;

  $('kpiPassRate').textContent = `${aggregates.passRate}%`;
  $('kpiPassCountSub').textContent = `${aggregates.passCount} of ${aggregates.totalStudents} passed`;
  $('kpiThresholdLabel').textContent = `Pass Mark: ≥ ${state.threshold}% (${(totalMax * state.threshold / 100).toFixed(0)}M)`;

  // Dynamically render section-wise breakdown cards based on detected sections
  renderSectionBreakdownCards(aggregates);
}

/**
 * Dynamically renders section cards for all detected sections in the data
 */
function renderSectionBreakdownCards(aggregates) {
  const container = $('sectionCardsGrid');
  if (!container) return;

  const sections = aggregates.detectedSections || [];
  if (sections.length === 0) {
    container.innerHTML = '<p class="empty-hint">No section mark columns detected in data.</p>';
    return;
  }

  const barClasses = ['success', 'primary', 'indigo', 'amber', 'rose'];

  container.innerHTML = sections.map((sec, idx) => {
    const stats = (aggregates.sectionStats && aggregates.sectionStats[sec.key]) || {
      average: 0, highest: 0, attemptedCount: 0, avgPct: 0, attemptRate: 0
    };
    const barClass = barClasses[idx % barClasses.length];

    return `
      <div class="sec-card" id="cardSec_${escapeHtml(sec.key)}">
        <div class="sec-card-header">
          <div class="sec-info">
            <span class="sec-badge">${sec.max} MARKS MAX</span>
            <h3 class="sec-title">${escapeHtml(sec.name)}</h3>
          </div>
          <div class="sec-avg-chip">${stats.avgPct}% Avg</div>
        </div>
        <div class="sec-card-body">
          <div class="sec-kpi-row">
            <div class="sec-kpi">
              <span class="sec-kpi-label">Average</span>
              <span class="sec-kpi-val num">${stats.average.toFixed(1)} <small>/ ${sec.max}</small></span>
            </div>
            <div class="sec-kpi">
              <span class="sec-kpi-label">Highest</span>
              <span class="sec-kpi-val num">${stats.highest} <small>/ ${sec.max}</small></span>
            </div>
            <div class="sec-kpi">
              <span class="sec-kpi-label">Attempted</span>
              <span class="sec-kpi-val num">${stats.attemptedCount} <small>/ ${aggregates.totalStudents}</small></span>
            </div>
          </div>

          <div class="sec-progress-wrap">
            <div class="sec-progress-header">
              <span>Attempt Rate</span>
              <span class="num">${stats.attemptRate}%</span>
            </div>
            <div class="sec-progress-bar">
              <div class="sec-progress-fill ${barClass}" style="width: ${stats.attemptRate}%"></div>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Updates Combined Sheets Special Panel:
 * 1. Average of every detected section (dynamically updates when a class/section is selected)
 * 2. Top 10 and Below 10 persons separately
 */
function updateCombinedAnalyticsPanel(allCombinedStudents, selectedGroupName = null, displayDataset = null, displayAggregates = null) {
  const panel = $('combinedAnalyticsPanel');
  if (state.viewMode !== 'multiple' || allCombinedStudents.length === 0) {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = 'flex';

  const activeSections = getActiveSections();
  const totalMax = getActiveTotalMax();
  const hasGroup = !!selectedGroupName;
  const targetStudents = (hasGroup && displayDataset) ? displayDataset : allCombinedStudents;
  const aggregates = (hasGroup && displayAggregates)
    ? displayAggregates
    : computeDashboardAggregates(targetStudents, state.threshold, activeSections, totalMax);

  const cleanSel = selectedGroupName ? selectedGroupName.replace(/2025-2029-Prime-/, '') : null;

  // Header Tag and Titles update based on the selected class
  const sheetsTag = $('combinedSheetsTag');
  if (sheetsTag) {
    sheetsTag.textContent = cleanSel
      ? `${state.sheets.length} Sheets Combined · Section: ${cleanSel} (${targetStudents.length} students)`
      : `${state.sheets.length} Sheets Combined (${allCombinedStudents.length} total students)`;
  }

  const combPanelTitle = $('combPanelTitle');
  if (combPanelTitle) {
    combPanelTitle.textContent = cleanSel
      ? `Combined Section-Wise Averages — ${cleanSel}`
      : 'Combined Section-Wise Averages';
  }

  const combPanelSub = $('combPanelSub');
  if (combPanelSub) {
    combPanelSub.textContent = cleanSel
      ? `Calculated across all uploaded sheets for ${cleanSel} (${targetStudents.length} students)`
      : 'Calculated across all uploaded sheets using attempted student scores';
  }

  // 1. Render Combined Section Averages Grid dynamically
  const combAvgGrid = $('combinedAvgGrid');
  if (combAvgGrid) {
    let html = activeSections.map(sec => {
      const stats = (aggregates.sectionStats && aggregates.sectionStats[sec.key]) || {
        average: 0, avgPct: 0, attemptRate: 0, attemptedCount: 0
      };
      const scopeLabel = cleanSel ? `${cleanSel} Average` : 'Average Score';
      return `
        <div class="comb-avg-box">
          <span class="comb-avg-label">${escapeHtml(sec.name)} (${sec.max}M)</span>
          <div class="comb-avg-num-wrap">
            <span class="comb-avg-val num">${stats.average.toFixed(1)}</span>
            <span class="comb-avg-max">/ ${sec.max}</span>
          </div>
          <div class="comb-avg-sub">${stats.avgPct}% ${escapeHtml(scopeLabel)}</div>
          <div class="comb-attempt-rate">Attempt Rate: ${stats.attemptRate}% (${stats.attemptedCount} of ${targetStudents.length} students)</div>
        </div>
      `;
    }).join('');

    const totalScopeLabel = cleanSel ? `${cleanSel} Average Total` : 'Class Average Total';
    html += `
      <div class="comb-avg-box highlight">
        <span class="comb-avg-label">${escapeHtml(totalScopeLabel)}</span>
        <div class="comb-avg-num-wrap">
          <span class="comb-avg-val num">${aggregates.averageTotal.toFixed(1)}</span>
          <span class="comb-avg-max">/ ${totalMax}</span>
        </div>
        <div class="comb-avg-sub">${((aggregates.averageTotal / totalMax) * 100).toFixed(1)}% Combined Average</div>
        <div class="comb-attempt-rate">Overall Pass Rate: ${aggregates.passRate}% (${aggregates.passCount} of ${targetStudents.length} passed)</div>
      </div>
    `;
    combAvgGrid.innerHTML = html;
  }

  // 2. Render Top 10 and Lowest 10 Tables dynamically for the target students
  renderRankingsTables(targetStudents, activeSections, totalMax, cleanSel);

  // 3. Render Combined Charts
  const sheetSummaries = state.sheets.map(sh => {
    const shStudents = hasGroup
      ? sh.students.filter(s => s.group === selectedGroupName)
      : sh.students;
    const agg = computeDashboardAggregates(shStudents.length > 0 ? shStudents : sh.students, state.threshold, sh.detectedSections, sh.totalMax);
    return {
      name: sh.name,
      averageTotal: parseFloat(agg.averageTotal.toFixed(1)),
      passRate: agg.passRate,
      highestTotal: agg.highestTotal,
      studentCount: shStudents.length > 0 ? shStudents.length : agg.totalStudents
    };
  });
  charts.renderTestAveragesChart('chartTestAverages', sheetSummaries);
  charts.renderCombinedSectionAvgChart('chartCombinedSectionAvg', aggregates);
  charts.renderAttemptedVsNotAttemptedChart('chartAttemptedVsNot', aggregates);

  const combGroupSub = $('combGroupPerfSub');
  if (combGroupSub) {
    combGroupSub.textContent = cleanSel
      ? `All sections across batches • Highlighted: ${cleanSel} (click bar to filter)`
      : 'All sections across batches • Click any bar to view section details';
  }
  // Benchmark chart displays all combined students across all batches so full comparison remains active
  const sheetAggregates = computeDashboardAggregates(allCombinedStudents, state.threshold, activeSections, totalMax);
  charts.renderCombinedGroupPerformance('chartCombinedGroupPerf', sheetAggregates, selectedGroupName, (grp) => {
    handleGroupSelect(grp);
  });
}

/**
 * Dynamically renders Top 10 and Lowest 10 ranking tables
 */
function renderRankingsTables(allCombinedStudents, activeSections, totalMax, cleanSel = null) {
  const top10Title = $('top10Title');
  const top10Sub = $('top10Sub');
  const below10Title = $('below10Title');
  const below10Sub = $('below10Sub');

  if (cleanSel) {
    if (top10Title) top10Title.textContent = `${cleanSel} — Top Students`;
    if (top10Sub) top10Sub.textContent = `Highest scores in ${cleanSel} across combined sheets`;
    if (below10Title) below10Title.textContent = `${cleanSel} — Lowest Students`;
    if (below10Sub) below10Sub.textContent = `Lowest scores in ${cleanSel} across combined sheets`;
  } else {
    if (top10Title) top10Title.textContent = 'Top 10 Students';
    if (top10Sub) top10Sub.textContent = 'Highest total scores across all combined sheets';
    if (below10Title) below10Title.textContent = 'Lowest 10 Students';
    if (below10Sub) below10Sub.textContent = 'Students who need extra support or missed test sections';
  }
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

  // Table header generator
  const theadHtml = `
    <tr>
      <th style="width: 52px;">Rank</th>
      <th>Student</th>
      <th>Group</th>
      ${activeSections.map(sec => `<th style="text-align: right;">${escapeHtml(sec.name)}</th>`).join('')}
      <th style="text-align: right;">Total</th>
      <th>Source Sheet</th>
    </tr>
  `;

  const topThead = $('top10Thead');
  if (topThead) topThead.innerHTML = theadHtml;
  const belowThead = $('below10Thead');
  if (belowThead) belowThead.innerHTML = theadHtml;

  // Render Top 10 Table Rows
  const topTbody = $('top10TableBody');
  topTbody.innerHTML = top10.map((s, idx) => {
    const rank = idx + 1;
    let rankBadgeClass = 'rank-general';
    if (rank === 1) rankBadgeClass = 'rank-1';
    else if (rank === 2) rankBadgeClass = 'rank-2';
    else if (rank === 3) rankBadgeClass = 'rank-3';

    const secCells = activeSections.map(sec => {
      const cell = (s.sections && s.sections[sec.key]) || s[sec.key];
      return `<td style="text-align:right;">${formatScoreCell(cell, sec.max)}</td>`;
    }).join('');

    return `
      <tr class="clickable-row" data-id="${escapeHtml(s.id)}">
        <td><span class="rank-badge ${rankBadgeClass}">#${rank}</span></td>
        <td>
          <div style="font-weight:700;color:var(--ink-primary);">${escapeHtml(s.name)}</div>
          <div style="font-size:0.7rem;color:var(--ink-muted);" class="num">${escapeHtml(s.id)}</div>
        </td>
        <td><span class="cell-group-badge">${escapeHtml(s.group.replace(/2025-2029-Prime-/, ''))}</span></td>
        ${secCells}
        <td style="text-align:right;">${formatTotalCell(s, totalMax)}</td>
        <td><span class="source-sheet-badge">${escapeHtml(s.sourceSheet)}</span></td>
      </tr>
    `;
  }).join('');

  // Render Below 10 Table Rows
  const belowTbody = $('below10TableBody');
  belowTbody.innerHTML = below10.map((s, idx) => {
    const bottomRank = sortedDesc.length - (belowCount - 1 - idx);
    const secCells = activeSections.map(sec => {
      const cell = (s.sections && s.sections[sec.key]) || s[sec.key];
      return `<td style="text-align:right;">${formatScoreCell(cell, sec.max)}</td>`;
    }).join('');

    return `
      <tr class="clickable-row" data-id="${escapeHtml(s.id)}">
        <td><span class="rank-badge rank-low">#${bottomRank}</span></td>
        <td>
          <div style="font-weight:700;color:var(--ink-primary);">${escapeHtml(s.name)}</div>
          <div style="font-size:0.7rem;color:var(--ink-muted);" class="num">${escapeHtml(s.id)}</div>
        </td>
        <td><span class="cell-group-badge">${escapeHtml(s.group.replace(/2025-2029-Prime-/, ''))}</span></td>
        ${secCells}
        <td style="text-align:right;">${formatTotalCell(s, totalMax)}</td>
        <td><span class="source-sheet-badge">${escapeHtml(s.sourceSheet)}</span></td>
      </tr>
    `;
  }).join('');

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
}

/**
 * Handles selection or toggling of a specific class / section
 */
function handleGroupSelect(groupName) {
  if (!groupName || groupName === '__ALL__') {
    state.selectedGroups.clear();
  } else {
    // If the clicked group is already the active one, toggle it off back to All
    if (state.selectedGroups.has(groupName) && state.selectedGroups.size === 1) {
      state.selectedGroups.clear();
    } else {
      state.selectedGroups.clear();
      state.selectedGroups.add(groupName);
    }
  }
  state.currentPage = 1;
  renderDashboard();
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

  const sections = getActiveSections();
  const groupCounts = new Map();

  allStudentsInDataset.forEach(s => {
    if (s.attemptedCount === sections.length) fullCount++;
    if (s.unattemptedCount > 0) naCount++;
    const hasZero = sections.some(sec => {
      const c = (s.sections && s.sections[sec.key]) || s[sec.key];
      return c && c.isAttempted && c.score === 0;
    });
    if (hasZero) {
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

  // Update Top Section Ribbon Status & Button
  const topStatusText = $('topSectionStatusText');
  const btnResetSection = $('btnResetSectionFilter');
  if (state.selectedGroups.size > 0) {
    const selName = Array.from(state.selectedGroups)[0];
    const cleanName = selName.replace(/2025-2029-Prime-/, '');
    const inSectionCount = allStudentsInDataset.filter(s => state.selectedGroups.has(s.group)).length;
    if (topStatusText) {
      topStatusText.innerHTML = `Viewing Section: <strong>${escapeHtml(cleanName)}</strong> (${inSectionCount} students)`;
    }
    if (btnResetSection) btnResetSection.style.display = 'inline-flex';
  } else {
    if (topStatusText) {
      topStatusText.innerHTML = `Viewing: <strong>All Sections</strong> (${total} students)`;
    }
    if (btnResetSection) btnResetSection.style.display = 'none';
  }

  // Populate Group Chips in both top ribbon and table toolbar
  const populateChips = (containerId) => {
    const container = $(containerId);
    if (!container) return;

    let chipsHtml = `
      <button class="group-chip ${state.selectedGroups.size === 0 ? 'active' : ''}" data-group="__ALL__" type="button">
        <span>All Sections</span>
        <span class="group-chip-count">${total}</span>
      </button>
    `;

    Array.from(groupCounts.entries()).sort((a, b) => b[1] - a[1]).forEach(([grp, count]) => {
      const isSelected = state.selectedGroups.has(grp);
      chipsHtml += `
        <button class="group-chip ${isSelected ? 'active' : ''}" data-group="${escapeHtml(grp)}" type="button" title="View ${escapeHtml(grp.replace(/2025-2029-Prime-/, ''))} details">
          <span>${escapeHtml(grp.replace(/2025-2029-Prime-/, ''))}</span>
          <span class="group-chip-count">${count}</span>
        </button>
      `;
    });

    container.innerHTML = chipsHtml;

    container.querySelectorAll('.group-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        handleGroupSelect(btn.dataset.group);
      });
    });
  };

  populateChips('topGroupChipsContainer');
  populateChips('groupChipsContainer');

  // Filter feedback row
  const feedbackRow = $('filterFeedbackRow');
  const feedbackText = $('filterFeedbackText');
  const activeFilters = [];

  if (state.searchQuery) activeFilters.push(`Search: "${state.searchQuery}"`);
  if (state.selectedGroups.size > 0) {
    const cleanGroups = Array.from(state.selectedGroups).map(g => g.replace(/2025-2029-Prime-/, ''));
    activeFilters.push(`Section: ${cleanGroups.join(', ')}`);
  }
  if (state.statusFilter !== 'all') activeFilters.push(`Status: ${state.statusFilter.replace('_', ' ').toUpperCase()}`);

  if (activeFilters.length > 0) {
    feedbackRow.style.display = 'flex';
    feedbackText.textContent = `Active Filters: ${activeFilters.join(' | ')}`;
  } else {
    feedbackRow.style.display = 'none';
  }
}

/**
 * Renders the Student Results Table Headers dynamically based on detected sections
 */
function renderStudentTableHeaders(sections, totalMax) {
  const thead = $('studentTableThead');
  if (!thead) return;

  const dynamicSectionHeaders = sections.map(sec => `
    <th class="th-sortable th-score" data-sort="${sec.key}">${escapeHtml(sec.name)} (${sec.max}M) <span class="sort-icon">⇅</span></th>
  `).join('');

  thead.innerHTML = `
    <tr>
      <th class="th-sortable" data-sort="id">Member Id <span class="sort-icon">⇅</span></th>
      <th class="th-sortable" data-sort="name">Student Name <span class="sort-icon">⇅</span></th>
      <th class="th-sortable" data-sort="email">Email <span class="sort-icon">⇅</span></th>
      <th class="th-sortable" data-sort="group">Group <span class="sort-icon">⇅</span></th>
      ${dynamicSectionHeaders}
      <th class="th-sortable th-score th-total" data-sort="totalScore">Total (${totalMax}M) <span class="sort-icon">⇅</span></th>
      <th class="th-sortable" data-sort="attemptedCount">Attempt Status <span class="sort-icon">⇅</span></th>
      <th class="th-sortable" data-sort="percentage">Result <span class="sort-icon">⇅</span></th>
      <th class="th-source" id="thSourceFile" style="${state.viewMode === 'multiple' ? '' : 'display: none;'}">Source Sheet</th>
      <th class="th-actions">Action</th>
    </tr>
  `;

  // Attach sorting click listeners to newly rendered headers
  thead.querySelectorAll('th.th-sortable').forEach(th => {
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

  updateSortHeadersUI();
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
  const sections = getActiveSections();
  const totalMax = getActiveTotalMax();

  // Render headers dynamically based on detected sections
  renderStudentTableHeaders(sections, totalMax);

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

  // Render Table Rows dynamically
  tbody.innerHTML = pageStudents.map(s => {
    const isPass = s.percentage >= state.threshold;
    const resultPill = isPass
      ? `<span class="status-pill pass">Pass</span>`
      : `<span class="status-pill fail">Fail</span>`;

    const attemptPill = s.attemptedCount === sections.length
      ? `<span class="attempt-pill full" title="All ${sections.length} sections attempted">Full (${sections.length}/${sections.length})</span>`
      : `<span class="attempt-pill partial" title="${s.unattemptedCount} section(s) not attempted">Partial (${s.attemptedCount}/${sections.length})</span>`;

    const sourceCell = state.viewMode === 'multiple'
      ? `<td><span class="source-sheet-badge">${escapeHtml(s.sourceSheet)}</span></td>`
      : '';

    const dynamicScoreCells = sections.map(sec => {
      const cell = (s.sections && s.sections[sec.key]) || s[sec.key];
      return `<td class="score-cell">${formatScoreCell(cell, sec.max)}</td>`;
    }).join('');

    return `
      <tr data-student-id="${escapeHtml(s.id)}" class="${s.isDuplicate ? 'row-duplicate' : ''}">
        <td class="cell-member-id num">${escapeHtml(s.id)}</td>
        <td class="cell-student-name">${escapeHtml(s.name)}</td>
        <td class="cell-email">${escapeHtml(s.email || '—')}</td>
        <td><span class="cell-group-badge">${escapeHtml(s.group.replace(/2025-2029-Prime-/, ''))}</span></td>
        ${dynamicScoreCells}
        <td class="score-cell">${formatTotalCell(s, totalMax)}</td>
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
    const vb = $('validationBanner');
    if (vb) vb.style.display = 'none';
    return;
  }

  zeroState.style.display = 'none';
  dashboard.style.display = 'block';

  updateHeaderAndContext();

  const activeDataset = getActiveDataset();
  const activeSections = getActiveSections();
  const activeTotalMax = getActiveTotalMax();

  const hasGroupFilter = state.selectedGroups.size > 0;
  const selectedGroupName = hasGroupFilter ? Array.from(state.selectedGroups)[0] : null;

  // 1. Full sheet aggregates (used to display ALL sections present in sheet)
  const sheetAggregates = computeDashboardAggregates(activeDataset, state.threshold, activeSections, activeTotalMax);

  // 2. Specific class/section dataset & aggregates (when a section is chosen)
  const displayDataset = hasGroupFilter
    ? activeDataset.filter(s => state.selectedGroups.has(s.group))
    : activeDataset;

  const displayAggregates = hasGroupFilter
    ? computeDashboardAggregates(displayDataset, state.threshold, activeSections, activeTotalMax)
    : sheetAggregates;

  // Combined Section Averages & Top 10 / Below 10 Persons - dynamically reflects selected class!
  updateCombinedAnalyticsPanel(activeDataset, selectedGroupName, displayDataset, displayAggregates);

  // If switching away from combined mode, destroy combined-only charts
  if (state.viewMode !== 'multiple') {
    charts.destroy('testAverages');
    charts.destroy('attemptedVsNot');
    charts.destroy('combinedGroupPerf');
    charts.destroy('combinedSectionAvg');
  }

  // Update KPIs and Section Breakdown cards with specific section details
  updateKPIsAndSections(displayAggregates, selectedGroupName);
  updateFilterControls(activeDataset);

  // Update chart subtitles for clarity
  const cleanSel = selectedGroupName ? selectedGroupName.replace(/2025-2029-Prime-/, '') : null;
  const scoreDistSub = $('scoreDistSub');
  const secPerfSub = $('secPerfSub');
  const attemptStatusSub = $('attemptStatusSub');
  const groupPerfSub = $('groupPerfSub');

  const secNamesStr = activeSections.map(s => s.name).join(', ');

  if (scoreDistSub) {
    scoreDistSub.textContent = cleanSel
      ? `Score distribution for ${cleanSel} (${displayDataset.length} students)`
      : `Student count by score range (/ ${activeTotalMax}M)`;
  }
  if (secPerfSub) {
    secPerfSub.textContent = cleanSel
      ? `Performance in ${secNamesStr} for ${cleanSel}`
      : `Average score % across detected sections (${secNamesStr})`;
  }
  if (attemptStatusSub) {
    attemptStatusSub.textContent = cleanSel
      ? `Full vs partial attempts for ${cleanSel}`
      : 'Full attempts vs partial test attempts';
  }
  if (groupPerfSub) {
    groupPerfSub.textContent = cleanSel
      ? `All ${sheetAggregates.totalGroups} sections in sheet • Highlighted: ${cleanSel} (click bar to filter)`
      : `All ${sheetAggregates.totalGroups} sections present in sheet • Click any bar to view section details`;
  }

  // Render Charts:
  // Detail charts reflect the selected section's specific details!
  charts.renderScoreDistribution('chartScoreDistribution', displayAggregates);
  charts.renderSectionPerformance('chartSectionPerformance', displayAggregates);
  charts.renderAttemptStatus('chartAttemptStatus', displayAggregates);

  // Benchmark chart shows ALL sections present in sheet, highlighting the selected section!
  charts.renderGroupPerformance('chartGroupPerformance', sheetAggregates, selectedGroupName, (grp) => {
    handleGroupSelect(grp);
  });

  // Render Student Results Table
  const filteredStudents = getFilteredAndSortedStudents();
  renderStudentTable(filteredStudents);
}

/**
 * Opens the Individual Student Assessment Modal
 */
function openStudentDetailModal(student) {
  state.currentModalStudent = student;
  const sections = getActiveSections();
  const totalMax = getActiveTotalMax();

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

  $('studentModalTotal').innerHTML = `${student.totalScore} <small>/ ${totalMax}M</small>`;
  $('studentModalPartialNote').textContent = student.isPartial
    ? `* Partial Total (${student.unattemptedCount} section(s) NA)`
    : 'Full test attempted';

  $('studentModalPct').textContent = `${student.percentage}%`;

  // Rank calculation within current student's specific class
  const dataset = getActiveDataset();
  const classStudents = dataset.filter(s => s.group === student.group);
  const sortedInClass = [...classStudents].sort((a, b) => b.totalScore - a.totalScore);
  const rankInClass = sortedInClass.findIndex(s => s.id === student.id) + 1;
  const totalInClass = classStudents.length > 0 ? classStudents.length : dataset.length;

  $('studentModalRank').textContent = `#${rankInClass > 0 ? rankInClass : 1}`;
  $('studentModalTotalStudents').textContent = `of ${totalInClass} in ${student.group}`;

  $('studentModalAttemptStatus').textContent = `${student.attemptedCount} / ${sections.length}`;
  $('studentModalNaStatus').textContent = `${student.unattemptedCount} Unattempted`;

  // Populate Section Table inside modal dynamically based on detected sections
  const tbody = $('studentModalSecTableBody');
  if (tbody) {
    tbody.innerHTML = sections.map(sec => {
      const c = (student.sections && student.sections[sec.key]) || student[sec.key] || { isAttempted: false, score: null };
      const isAtt = c.isAttempted && c.score !== null;
      const scoreVal = isAtt ? c.score : 'NA';
      const pct = isAtt && sec.max > 0 ? ((c.score / sec.max) * 100).toFixed(0) + '%' : '—';
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
  }

  // Render Mini Modal Chart with detected sections
  charts.renderStudentModalChart('studentModalChartCanvas', student, sections);

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

  const sections = getActiveSections();
  const totalMax = getActiveTotalMax();

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
      <div class="value num">${s.totalScore} / ${totalMax}M ${s.isPartial ? '*' : ''}</div>
    </div>
    <div class="print-kpi-item">
      <div class="label">Percentage</div>
      <div class="value num">${s.percentage}%</div>
    </div>
    <div class="print-kpi-item">
      <div class="label">Class Rank</div>
      <div class="value num">#${rank} of ${dataset.length}</div>
    </div>
    <div class="print-kpi-item">
      <div class="label">Result</div>
      <div class="value" style="color: ${isPass ? '#059669' : '#B91C1C'}; font-weight: 700;">${isPass ? 'PASS' : 'FAIL'}</div>
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
      ${sections.map(sec => {
        const c = (s.sections && s.sections[sec.key]) || s[sec.key] || { isAttempted: false, score: null };
        const isAtt = c.isAttempted && c.score !== null;
        return `
          <tr>
            <td><strong>${escapeHtml(sec.name)}</strong></td>
            <td class="num">${sec.max}</td>
            <td class="num"><strong>${isAtt ? c.score : 'NA'}</strong></td>
            <td class="num">${isAtt && sec.max > 0 ? ((c.score / sec.max) * 100).toFixed(1) + '%' : '—'}</td>
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
 * Downloads Individual Student Report Card as a PDF
 */
function handleDownloadStudentPdf() {
  const s = state.currentModalStudent;
  if (!s) return;

  const sections = getActiveSections();
  const totalMax = getActiveTotalMax();
  const dataset = getActiveDataset();
  const classStudents = dataset.filter(x => x.group === s.group);
  const sortedInClass = [...classStudents].sort((a, b) => b.totalScore - a.totalScore);
  const rankInClass = sortedInClass.findIndex(x => x.id === s.id) + 1;
  const totalInClass = classStudents.length > 0 ? classStudents.length : dataset.length;

  try {
    const fileName = downloadIndividualStudentPdf(
      s,
      sections,
      totalMax,
      rankInClass > 0 ? rankInClass : 1,
      totalInClass,
      state.threshold
    );
    showToast(`Downloaded ${fileName}`);
  } catch (err) {
    console.error('Error downloading student PDF:', err);
    showToast('Failed to download student PDF report.');
  }
}

/**
 * Exports class-wise progress report PDF based on active section filter or all classes
 * @param {boolean} forceAllClasses - whether to force all classes even if an individual section is selected
 */
function handleExportClassWisePdf(forceAllClasses = false) {
  if (state.sheets.length === 0) {
    showToast('Please upload a spreadsheet first.');
    return;
  }

  const activeDataset = getActiveDataset();
  if (activeDataset.length === 0) {
    showToast('No students to export.');
    return;
  }

  const sections = getActiveSections();
  const totalMax = getActiveTotalMax();
  const agg = computeDashboardAggregates(activeDataset, state.threshold, sections, totalMax);

  const hasGroupFilter = !forceAllClasses && state.selectedGroups.size > 0;
  const selectedGroupName = hasGroupFilter ? Array.from(state.selectedGroups)[0] : null;

  let targetGroupStats = agg.groupStats;
  if (selectedGroupName) {
    targetGroupStats = agg.groupStats.filter(g => g.name === selectedGroupName);
  }

  if (targetGroupStats.length === 0) {
    showToast('No class data available to export.');
    return;
  }

  const groupsData = targetGroupStats.map(g => {
    const studentsInGrp = activeDataset.filter(s => s.group === g.name);
    return {
      groupName: g.name,
      averageTotal: g.averageTotal,
      highestTotal: g.highestTotal,
      passRate: g.passRate,
      students: studentsInGrp
    };
  });

  const curSheet = state.sheets.find(s => s.id === state.activeSheetId);
  const sheetTitle = state.viewMode === 'single'
    ? (curSheet ? curSheet.name : 'Single Sheet')
    : `Combined Sheets (${state.sheets.length})`;

  try {
    const fileName = downloadClassWiseProgressReportPdf({
      groupsData,
      sections,
      totalMax,
      threshold: state.threshold,
      selectedGroupName: selectedGroupName,
      sheetTitle
    });
    showToast(`PDF downloaded: ${fileName}`);
  } catch (err) {
    console.error('Class-wise PDF export error:', err);
    showToast('Failed to generate PDF report.');
  }
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
          const detectedSections = detectSectionsFromData(headers, rows);
          const totalMax = detectTotalMax(headers, detectedSections, rows);
          const mapping = autoDetectMapping(headers, detectedSections);
          const normalized = normalizeStudentRows(rows, mapping, {
            sheetName: workbook.SheetNames.length > 1 ? `${file.name.replace(/\.[^/.]+$/, '')} - ${sheetName}` : sheetName,
            fileName: file.name
          }, detectedSections, totalMax);

          newSheets.push({
            id: `sheet-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            name: workbook.SheetNames.length > 1 ? `${file.name.replace(/\.[^/.]+$/, '')} (${sheetName})` : file.name.replace(/\.[^/.]+$/, ''),
            fileName: file.name,
            rawRows: rows,
            headers,
            detectedSections,
            totalMax,
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
    // Set to Single Sheet mode when 1 sheet is uploaded, Combined when multiple
    state.viewMode = newSheets.length === 1 ? 'single' : 'multiple';
    state.currentPage = 1;
    state.searchQuery = '';
    state.selectedGroups.clear();
    state.statusFilter = 'all';

    const count = getActiveDataset().length;
    showToast(newSheets.length === 1
      ? `Loaded ${newSheets[0].name} (${count} students)`
      : `Loaded ${newSheets.length} sheets (${count} total students)`);
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

  const sections = getActiveSections();
  const totalMax = getActiveTotalMax();

  try {
    const secHeaders = sections.map(s => `${s.name} (${s.max}M)`);
    const header = [
      'Member Id',
      'Name',
      'Email',
      'Groups',
      ...secHeaders,
      `Total (${totalMax}M)`,
      'Is Partial Total',
      'Attempted Count',
      'Percentage',
      'Result',
      'Source Sheet'
    ];

    const rows = students.map(s => {
      const secScores = sections.map(sec => {
        const c = (s.sections && s.sections[sec.key]) || s[sec.key];
        return c && c.isAttempted && c.score !== null ? c.score : 'NA';
      });

      return [
        s.id,
        s.name,
        s.email,
        s.group,
        ...secScores,
        s.totalScore,
        s.isPartial ? 'YES' : 'NO',
        `${s.attemptedCount}/${sections.length}`,
        `${s.percentage}%`,
        s.percentage >= state.threshold ? 'Pass' : 'Fail',
        s.sourceSheet
      ];
    });

    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    ws['!cols'] = [
      { wch: 15 },
      { wch: 28 },
      { wch: 26 },
      { wch: 24 },
      ...sections.map(() => ({ wch: 16 })),
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
    const agg = computeDashboardAggregates(activeDataset, state.threshold, sections, totalMax);
    const summaryHeader = ['Group Name', 'Students', `Average Total (/${totalMax}M)`, 'Pass Rate %', 'NA Count'];
    const summaryRows = agg.groupStats.map(g => [g.name, g.count, g.averageTotal, `${g.passRate}%`, g.naCount]);
    const summaryWs = XLSX.utils.aoa_to_sheet([summaryHeader, ...summaryRows]);
    XLSX.utils.book_append_sheet(wb, summaryWs, 'Group_Analytics_Summary');

    const fileName = `Assessment_Report_${new Date().toISOString().slice(0, 10)}.xlsx`;
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

  const sections = getActiveSections();
  const totalMax = getActiveTotalMax();

  const secHeaders = sections.map(s => `"${s.name} (${s.max}M)"`);
  const header = [
    'Member Id',
    'Name',
    'Email',
    'Groups',
    ...secHeaders,
    `"Total (${totalMax}M)"`,
    'Attempt Status',
    'Percentage',
    'Result',
    'Source Sheet'
  ].join(',');

  const rows = students.map(s => {
    const secScores = sections.map(sec => {
      const c = (s.sections && s.sections[sec.key]) || s[sec.key];
      return c && c.isAttempted && c.score !== null ? c.score : 'NA';
    });

    return [
      `"${s.id}"`,
      `"${s.name.replace(/"/g, '""')}"`,
      `"${s.email}"`,
      `"${s.group}"`,
      ...secScores,
      s.totalScore,
      s.isPartial ? `"Partial (${s.unattemptedCount} NA)"` : `"Full (${s.attemptedCount}/${sections.length})"`,
      `"${s.percentage}%"`,
      s.percentage >= state.threshold ? '"Pass"' : '"Fail"',
      `"${s.sourceSheet}"`
    ].join(',');
  });

  const csvContent = 'data:text/csv;charset=utf-8,' + [header, ...rows].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `Assessment_Results_${new Date().toISOString().slice(0, 10)}.csv`);
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

  // Top Section Filter Reset
  const btnResetSection = $('btnResetSectionFilter');
  if (btnResetSection) {
    btnResetSection.addEventListener('click', () => {
      handleGroupSelect('__ALL__');
    });
  }

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
  const exportDropdownWrap = $('exportDropdownWrap');
  const btnExportMenu = $('btnExportMenu');
  const exportDropdown = $('exportDropdownMenu');

  function closeExportMenu() {
    if (exportDropdownWrap) exportDropdownWrap.classList.remove('open');
    if (exportDropdown) exportDropdown.classList.remove('show');
  }

  if (btnExportMenu) {
    btnExportMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      const isCurrentlyOpen = exportDropdown && exportDropdown.classList.contains('show');
      if (isCurrentlyOpen) {
        closeExportMenu();
      } else {
        if (exportDropdownWrap) exportDropdownWrap.classList.add('open');
        if (exportDropdown) exportDropdown.classList.add('show');
      }
    });
  }

  document.addEventListener('click', (e) => {
    if (exportDropdownWrap && !exportDropdownWrap.contains(e.target)) {
      closeExportMenu();
    }
  });

  const btnExportPdf = $('btnExportPdf');
  if (btnExportPdf) {
    btnExportPdf.addEventListener('click', (e) => {
      e.stopPropagation();
      closeExportMenu();
      handleExportClassWisePdf(false);
    });
  }

  const btnExportAllClassesPdf = $('btnExportAllClassesPdf');
  if (btnExportAllClassesPdf) {
    btnExportAllClassesPdf.addEventListener('click', (e) => {
      e.stopPropagation();
      closeExportMenu();
      handleExportClassWisePdf(true);
    });
  }

  const btnExportExcel = $('btnExportExcel');
  if (btnExportExcel) {
    btnExportExcel.addEventListener('click', (e) => {
      e.stopPropagation();
      closeExportMenu();
      exportFilteredToExcel();
    });
  }

  const btnExportCsv = $('btnExportCsv');
  if (btnExportCsv) {
    btnExportCsv.addEventListener('click', (e) => {
      e.stopPropagation();
      closeExportMenu();
      exportFilteredToCSV();
    });
  }

  const btnPrintDashboard = $('btnPrintDashboard');
  if (btnPrintDashboard) {
    btnPrintDashboard.addEventListener('click', (e) => {
      e.stopPropagation();
      closeExportMenu();
      window.print();
    });
  }

  // Direct 1-Click Upload from Topbar
  const topbarFileInput = $('topbarFileInput');
  const btnOpenUpload = $('btnOpenUploadModal');
  if (btnOpenUpload && topbarFileInput) {
    btnOpenUpload.addEventListener('click', () => {
      topbarFileInput.click();
    });

    topbarFileInput.addEventListener('change', async (e) => {
      if (e.target.files && e.target.files.length > 0) {
        await processFiles(Array.from(e.target.files));
        topbarFileInput.value = ''; // reset so same file can be reloaded if edited
      }
    });
  }

  // Upload Modal Handlers
  const uploadModal = $('modalUpload');
  const fileInput = $('fileInput');
  const dropzone = $('fileDropzone');
  const fileItemsContainer = $('fileItemsContainer');
  const queuedCount = $('queuedFileCount');
  const btnProcessFiles = $('btnProcessUploadedFiles');

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

  // Global Full-Screen Drag & Drop: Drag any Excel/CSV file onto the browser window to load instantly
  const dropOverlay = $('globalDropOverlay');
  let dragCounter = 0;

  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    // Only show for file drags
    if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
      dragCounter++;
      if (dropOverlay) dropOverlay.style.display = 'flex';
    }
  });

  window.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      if (dropOverlay) dropOverlay.style.display = 'none';
    }
  });

  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragCounter = 0;
    if (dropOverlay) dropOverlay.style.display = 'none';
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await processFiles(Array.from(e.dataTransfer.files));
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

  // Validation Banner close (if present)
  const btnCloseVal = $('btnCloseValidationBanner');
  if (btnCloseVal) btnCloseVal.addEventListener('click', () => {
    const vb = $('validationBanner');
    if (vb) vb.style.display = 'none';
  });

  // Student Detail Modal
  $('btnCloseStudentModal').addEventListener('click', closeStudentDetailModal);
  $('btnCloseStudentModalBtn').addEventListener('click', closeStudentDetailModal);
  const btnDownloadPdf = $('btnDownloadStudentPdf');
  if (btnDownloadPdf) btnDownloadPdf.addEventListener('click', handleDownloadStudentPdf);
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
