// Chart.js visualizations manager - Formal Academic Portal Theme
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

// Academic Chart Design Tokens
const COLORS = {
  navy: '#0B2144',
  navyLight: '#16386E',
  gold: '#C89326',
  goldLight: '#E6B83B',
  primary: '#1D4ED8',
  primaryLight: '#60A5FA',
  primaryDark: '#1E40AF',
  indigo: '#4338CA',
  indigoLight: '#6366F1',
  emerald: '#059669',
  emeraldLight: '#10B981',
  amber: '#D97706',
  amberLight: '#F59E0B',
  crimson: '#B91C1C',
  crimsonLight: '#DC2626',
  slate: '#64748B',
  slateLight: '#94A3B8',
  border: '#DCE3ED',
  grid: '#EAEFF5'
};

const CHART_FONTS = {
  family: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
};

export class DashboardCharts {
  constructor() {
    this.instances = {
      distribution: null,
      sections: null,
      groups: null,
      attempts: null,
      testAverages: null,
      attemptedVsNot: null,
      combinedGroupPerf: null,
      combinedSectionAvg: null,
      studentModal: null
    };
  }

  destroy(name) {
    if (this.instances[name]) {
      this.instances[name].destroy();
      this.instances[name] = null;
    }
  }

  destroyAll() {
    Object.keys(this.instances).forEach(name => this.destroy(name));
  }

  /**
   * Render or update the Score Distribution Chart (Bar)
   */
  renderScoreDistribution(canvasId, aggregates) {
    this.destroy('distribution');
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const data = aggregates.scoreDistribution;
    const total = aggregates.totalStudents || 1;

    this.instances.distribution = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['<20 Marks', '20–29 Marks', '30–39 Marks', '40–50 Marks'],
        datasets: [{
          label: 'Students',
          data,
          backgroundColor: [
            'rgba(185, 28, 28, 0.85)',   // <20: Red
            'rgba(217, 119, 6, 0.85)',   // 20-29: Amber
            'rgba(29, 78, 216, 0.85)',   // 30-39: Blue
            'rgba(5, 150, 105, 0.85)'    // 40-50: Green
          ],
          borderColor: [
            '#B91C1C',
            '#D97706',
            '#1D4ED8',
            '#059669'
          ],
          borderWidth: 1.5,
          borderRadius: 6,
          borderSkipped: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0B2144',
            borderColor: '#C89326',
            borderWidth: 1,
            padding: 12,
            titleFont: { family: CHART_FONTS.family, size: 13, weight: '600' },
            bodyFont: { family: CHART_FONTS.family, size: 12 },
            callbacks: {
              label: (context) => {
                const count = context.parsed.y;
                const pct = ((count / total) * 100).toFixed(1);
                return ` ${count} students (${pct}%)`;
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              stepSize: 1,
              font: { family: CHART_FONTS.family, size: 11 },
              color: '#475569'
            },
            grid: { color: COLORS.grid }
          },
          x: {
            ticks: {
              font: { family: CHART_FONTS.family, size: 11, weight: '600' },
              color: '#1E293B'
            },
            grid: { display: false }
          }
        }
      }
    });
  }

  /**
   * Render Section Average Graph (Bar)
   */
  renderSectionPerformance(canvasId, aggregates) {
    this.destroy('sections');
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const secStats = aggregates.sectionStats || {};
    const sections = aggregates.detectedSections && aggregates.detectedSections.length > 0
      ? aggregates.detectedSections
      : Object.keys(secStats).map(k => secStats[k]);

    if (sections.length === 0) return;

    const labels = sections.map(s => s.label || `${s.name} (${s.max}M)`);
    const avgScores = sections.map(s => {
      const st = secStats[s.key];
      return st ? st.average : 0;
    });
    const avgPcts = sections.map(s => {
      const st = secStats[s.key];
      return st ? st.avgPct : 0;
    });
    const maxMarks = sections.map(s => s.max || 20);
    const yMax = Math.max(...maxMarks, 20);

    this.instances.sections = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Average Score',
            data: avgScores,
            backgroundColor: 'rgba(16, 44, 87, 0.85)',
            borderColor: '#0B2144',
            borderWidth: 1.5,
            borderRadius: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0F172A',
            borderColor: '#334155',
            borderWidth: 1,
            padding: 12,
            titleFont: { family: CHART_FONTS.family, size: 13, weight: '600' },
            bodyFont: { family: CHART_FONTS.family, size: 12 },
            callbacks: {
              label: (context) => {
                const idx = context.dataIndex;
                const score = context.parsed.y;
                const max = maxMarks[idx];
                const pct = avgPcts[idx];
                return ` Average: ${score} / ${max} (${pct}%)`;
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            max: yMax,
            ticks: {
              stepSize: yMax > 50 ? 20 : yMax > 20 ? 10 : 5,
              font: { family: CHART_FONTS.family, size: 11 },
              color: '#475569'
            },
            grid: { color: COLORS.grid }
          },
          x: {
            ticks: {
              font: { family: CHART_FONTS.family, size: 11, weight: '600' },
              color: '#1E293B'
            },
            grid: { display: false }
          }
        }
      }
    });
  }

  /**
   * Render Attempted and Not Attempted Bar Chart for Each Section & Test
   */
  renderAttemptedVsNotAttemptedChart(canvasId, aggregates) {
    this.destroy('attemptedVsNot');
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const secStats = aggregates.sectionStats || {};
    const sections = aggregates.detectedSections && aggregates.detectedSections.length > 0
      ? aggregates.detectedSections
      : Object.keys(secStats).map(k => secStats[k]);

    if (sections.length === 0) return;

    const labels = sections.map(s => s.label || `${s.name} (${s.max}M)`);
    const attempted = sections.map(s => {
      const st = secStats[s.key];
      return st ? st.attemptedCount : 0;
    });
    const notAttempted = sections.map(s => {
      const st = secStats[s.key];
      return st ? st.unattemptedCount : 0;
    });

    this.instances.attemptedVsNot = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Candidates Evaluated',
            data: attempted,
            backgroundColor: 'rgba(5, 150, 105, 0.85)',
            borderColor: '#059669',
            borderWidth: 1.5,
            borderRadius: 6
          },
          {
            label: 'Module Absentee (NA)',
            data: notAttempted,
            backgroundColor: 'rgba(100, 116, 139, 0.8)',
            borderColor: '#64748B',
            borderWidth: 1.5,
            borderRadius: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: {
              boxWidth: 12,
              boxHeight: 12,
              font: { family: CHART_FONTS.family, size: 11, weight: '600' },
              color: '#334155'
            }
          },
          tooltip: {
            backgroundColor: '#0F172A',
            borderColor: '#334155',
            borderWidth: 1,
            padding: 12,
            callbacks: {
              label: (context) => ` ${context.dataset.label}: ${context.parsed.y} candidates`
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              font: { family: CHART_FONTS.family, size: 11 },
              color: '#475569'
            },
            grid: { color: COLORS.grid }
          },
          x: {
            ticks: {
              font: { family: CHART_FONTS.family, size: 11, weight: '600' },
              color: '#1E293B'
            },
            grid: { display: false }
          }
        }
      }
    });
  }

  /**
   * Render Attempt Status Breakdown (Doughnut: Full vs Partial) - Normal Instant Render
   */
  renderAttemptStatus(canvasId, aggregates) {
    this.destroy('attempts');
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const total = aggregates.totalStudents || 1;
    const fullAttemptCount = total - aggregates.studentsWithNA;
    const partialCount = aggregates.studentsWithNA;
    const secCount = (aggregates.detectedSections && aggregates.detectedSections.length) || 3;

    this.instances.attempts = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: [`Full Assessment (${secCount}/${secCount} Sections)`, 'Partial Assessment (≥1 NA)'],
        datasets: [{
          data: [fullAttemptCount, partialCount],
          backgroundColor: [
            '#059669',
            '#64748B'
          ],
          borderColor: ['#059669', '#64748B'],
          borderWidth: 1,
          hoverOffset: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false, // Animation disabled - normal instant rendering
        cutout: '62%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              boxWidth: 12,
              boxHeight: 12,
              font: { family: CHART_FONTS.family, size: 11, weight: '600' },
              color: '#334155',
              padding: 14
            }
          },
          tooltip: {
            backgroundColor: '#0F172A',
            borderColor: '#E2E8F0',
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: (context) => {
                const count = context.parsed;
                const pct = ((count / total) * 100).toFixed(1);
                return ` ${context.label}: ${count} candidates (${pct}%)`;
              }
            }
          }
        }
      }
    });
  }

  /**
   * Render Group Performance Benchmark (Horizontal Bar)
   * Shows ALL sections present in the sheet. Highlights selected section if one is chosen.
   */
  renderGroupPerformance(canvasId, aggregates, selectedGroup = null, onSelectGroup = null) {
    this.destroy('groups');
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    // Show ALL sections present in the sheet
    const groupStats = aggregates.groupStats || [];
    if (groupStats.length === 0) return;

    // Dynamically expand container height so all sections are comfortably readable
    if (canvas.parentElement) {
      const dynamicHeight = Math.max(220, Math.min(640, groupStats.length * 36));
      canvas.parentElement.style.height = `${dynamicHeight}px`;
    }

    const labels = groupStats.map(g => g.name.replace(/2025-2029-Prime-/, ''));
    const averages = groupStats.map(g => g.averageTotal);

    const normSelected = selectedGroup ? selectedGroup.replace(/2025-2029-Prime-/, '').trim() : null;

    const backgroundColors = groupStats.map(g => {
      const clean = g.name.replace(/2025-2029-Prime-/, '').trim();
      const isSel = normSelected && (clean === normSelected || g.name === selectedGroup);
      if (!normSelected) {
        return 'rgba(37, 99, 235, 0.85)'; // Default blue
      }
      return isSel ? 'rgba(15, 23, 42, 0.95)' : 'rgba(148, 163, 184, 0.35)';
    });

    const borderColors = groupStats.map(g => {
      const clean = g.name.replace(/2025-2029-Prime-/, '').trim();
      const isSel = normSelected && (clean === normSelected || g.name === selectedGroup);
      if (!normSelected) {
        return '#2563EB';
      }
      return isSel ? '#0F172A' : '#CBD5E1';
    });

    const borderWidths = groupStats.map(g => {
      const clean = g.name.replace(/2025-2029-Prime-/, '').trim();
      const isSel = normSelected && (clean === normSelected || g.name === selectedGroup);
      return isSel ? 2 : 1;
    });

    this.instances.groups = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Average Score (/50)',
            data: averages,
            backgroundColor: backgroundColors,
            borderColor: borderColors,
            borderWidth: borderWidths,
            borderRadius: 6
          }
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        onClick: (event, elements) => {
          if (elements.length > 0 && typeof onSelectGroup === 'function') {
            const idx = elements[0].index;
            const clickedGroup = groupStats[idx].name;
            onSelectGroup(clickedGroup);
          }
        },
        onHover: (event, elements) => {
          if (event.native && event.native.target) {
            event.native.target.style.cursor = elements.length ? 'pointer' : 'default';
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0F172A',
            borderColor: '#334155',
            borderWidth: 1,
            padding: 12,
            titleFont: { family: CHART_FONTS.family, size: 12.5, weight: '600' },
            bodyFont: { family: CHART_FONTS.family, size: 12 },
            callbacks: {
              title: (items) => {
                const g = groupStats[items[0].dataIndex];
                const clean = g.name.replace(/2025-2029-Prime-/, '').trim();
                const isSel = normSelected && (clean === normSelected || g.name === selectedGroup);
                return isSel ? `${clean}  (Selected Section)` : clean;
              },
              label: (context) => ` Average Total: ${context.parsed.x} / 50M`,
              afterLabel: (context) => {
                const g = groupStats[context.dataIndex];
                return `Students: ${g.count} | Pass Rate: ${g.passRate}% | NA: ${g.naCount}\n(Click bar to view section details)`;
              }
            }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            max: 50,
            ticks: {
              stepSize: 10,
              font: { family: CHART_FONTS.family, size: 11 },
              color: '#475569'
            },
            grid: { color: COLORS.grid }
          },
          y: {
            ticks: {
              font: { family: CHART_FONTS.family, size: 11, weight: '600' },
              color: '#0F172A'
            },
            grid: { display: false }
          }
        }
      }
    });
  }

  /**
   * Render Test Average Comparison Chart (for Multi-Sheet / Multi-Test)
   */
  renderTestAveragesChart(canvasId, sheetSummaries) {
    this.destroy('testAverages');
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const labels = sheetSummaries.map((s, idx) => `Batch ${idx + 1}: ${s.name.slice(0, 14)}`);
    const averages = sheetSummaries.map(s => s.averageTotal);

    this.instances.testAverages = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Batch Mean (/50M)',
            data: averages,
            backgroundColor: 'rgba(11, 33, 68, 0.85)',
            borderColor: '#0B2144',
            borderWidth: 1.5,
            borderRadius: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0B2144',
            borderColor: '#C89326',
            borderWidth: 1,
            padding: 12,
            callbacks: {
              label: (context) => {
                const s = sheetSummaries[context.dataIndex];
                return ` Batch Mean: ${s.averageTotal} / 50M (${s.studentCount} candidates)`;
              },
              afterLabel: (context) => {
                const s = sheetSummaries[context.dataIndex];
                return `Pass Rate: ${s.passRate}% | Top Mark: ${s.highestTotal}`;
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            max: 50,
            ticks: {
              stepSize: 10,
              font: { family: CHART_FONTS.family, size: 11 },
              color: '#475569'
            },
            grid: { color: COLORS.grid }
          },
          x: {
            ticks: {
              font: { family: CHART_FONTS.family, size: 11, weight: '600' },
              color: '#1E293B'
            },
            grid: { display: false }
          }
        }
      }
    });
  }

  /**
   * Render Combined Section Average Chart (Bar)
   */
  renderCombinedSectionAvgChart(canvasId, aggregates) {
    this.destroy('combinedSectionAvg');
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const secStats = aggregates.sectionStats || {};
    const sections = aggregates.detectedSections && aggregates.detectedSections.length > 0
      ? aggregates.detectedSections
      : Object.keys(secStats).map(k => secStats[k]);

    if (sections.length === 0) return;

    const labels = sections.map(s => s.label || `${s.name} (${s.max}M)`);
    const avgScores = sections.map(s => {
      const st = secStats[s.key];
      return st ? st.average : 0;
    });
    const maxMarks = sections.map(s => s.max || 20);
    const yMax = Math.max(...maxMarks, 20);

    const palette = [
      'rgba(67, 56, 202, 0.85)',
      'rgba(29, 78, 216, 0.85)',
      'rgba(5, 150, 105, 0.85)',
      'rgba(202, 138, 4, 0.85)',
      'rgba(225, 29, 72, 0.85)'
    ];
    const borderPalette = ['#4338CA', '#1D4ED8', '#059669', '#CA8A04', '#E11D48'];

    const bgColors = sections.map((_, i) => palette[i % palette.length]);
    const borderColors = sections.map((_, i) => borderPalette[i % borderPalette.length]);

    this.instances.combinedSectionAvg = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Consolidated Mean Score',
            data: avgScores,
            backgroundColor: bgColors,
            borderColor: borderColors,
            borderWidth: 1.5,
            borderRadius: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0F172A',
            borderColor: '#334155',
            borderWidth: 1,
            padding: 12,
            callbacks: {
              label: (ctx) => {
                const idx = ctx.dataIndex;
                const score = ctx.parsed.y;
                const max = maxMarks[idx];
                const pct = max > 0 ? ((score / max) * 100).toFixed(0) : 0;
                return ` Mean: ${score.toFixed(1)} / ${max} (${pct}%)`;
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            max: yMax,
            ticks: {
              stepSize: yMax > 50 ? 20 : yMax > 20 ? 10 : 5,
              font: { family: CHART_FONTS.family, size: 11 },
              color: '#475569'
            },
            grid: { color: COLORS.grid }
          },
          x: {
            ticks: {
              font: { family: CHART_FONTS.family, size: 11, weight: '600' },
              color: '#1E293B'
            },
            grid: { display: false }
          }
        }
      }
    });
  }

  /**
   * Render Combined Group Performance Benchmark
   */
  renderCombinedGroupPerformance(canvasId, aggregates, selectedGroup = null, onSelectGroup = null) {
    this.destroy('combinedGroupPerf');
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const groupStats = aggregates.groupStats || [];
    if (groupStats.length === 0) return;

    if (canvas.parentElement) {
      const dynamicHeight = Math.max(220, Math.min(640, groupStats.length * 36));
      canvas.parentElement.style.height = `${dynamicHeight}px`;
    }

    const labels = groupStats.map(g => g.name.replace(/2025-2029-Prime-/, ''));
    const averages = groupStats.map(g => g.averageTotal);

    const normSelected = selectedGroup ? selectedGroup.replace(/2025-2029-Prime-/, '').trim() : null;

    const backgroundColors = groupStats.map(g => {
      const clean = g.name.replace(/2025-2029-Prime-/, '').trim();
      const isSel = normSelected && (clean === normSelected || g.name === selectedGroup);
      if (!normSelected) {
        return 'rgba(200, 147, 38, 0.85)';
      }
      return isSel ? 'rgba(15, 23, 42, 0.95)' : 'rgba(148, 163, 184, 0.35)';
    });

    const borderColors = groupStats.map(g => {
      const clean = g.name.replace(/2025-2029-Prime-/, '').trim();
      const isSel = normSelected && (clean === normSelected || g.name === selectedGroup);
      if (!normSelected) {
        return '#C89326';
      }
      return isSel ? '#0F172A' : '#CBD5E1';
    });

    const borderWidths = groupStats.map(g => {
      const clean = g.name.replace(/2025-2029-Prime-/, '').trim();
      const isSel = normSelected && (clean === normSelected || g.name === selectedGroup);
      return isSel ? 2 : 1;
    });

    this.instances.combinedGroupPerf = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Average Score (/50)',
            data: averages,
            backgroundColor: backgroundColors,
            borderColor: borderColors,
            borderWidth: borderWidths,
            borderRadius: 6
          }
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        onClick: (event, elements) => {
          if (elements.length > 0 && typeof onSelectGroup === 'function') {
            const idx = elements[0].index;
            const clickedGroup = groupStats[idx].name;
            onSelectGroup(clickedGroup);
          }
        },
        onHover: (event, elements) => {
          if (event.native && event.native.target) {
            event.native.target.style.cursor = elements.length ? 'pointer' : 'default';
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0F172A',
            borderColor: '#334155',
            borderWidth: 1,
            padding: 12,
            titleFont: { family: CHART_FONTS.family, size: 12.5, weight: '600' },
            bodyFont: { family: CHART_FONTS.family, size: 12 },
            callbacks: {
              title: (items) => {
                const g = groupStats[items[0].dataIndex];
                const clean = g.name.replace(/2025-2029-Prime-/, '').trim();
                const isSel = normSelected && (clean === normSelected || g.name === selectedGroup);
                return isSel ? `${clean}  (Selected Section)` : clean;
              },
              label: (context) => ` Average Total: ${context.parsed.x} / 50M`,
              afterLabel: (context) => {
                const g = groupStats[context.dataIndex];
                return `Students: ${g.count} | Pass Rate: ${g.passRate}% | NA: ${g.naCount}\n(Click bar to view section details)`;
              }
            }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            max: 50,
            ticks: {
              stepSize: 10,
              font: { family: CHART_FONTS.family, size: 11 },
              color: '#475569'
            },
            grid: { color: COLORS.grid }
          },
          y: {
            ticks: {
              font: { family: CHART_FONTS.family, size: 11, weight: '600' },
              color: '#0F172A'
            },
            grid: { display: false }
          }
        }
      }
    });
  }

  /**
   * Render Individual Student's Score Breakdown Chart inside Modal
   */
  renderStudentModalChart(canvasId, student, detectedSections = null) {
    this.destroy('studentModal');
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const sections = detectedSections && detectedSections.length > 0
      ? detectedSections
      : Object.keys(student.sections || {}).map(k => ({
          key: k,
          name: k.charAt(0).toUpperCase() + k.slice(1),
          max: 20
        }));

    const labels = sections.map(s => s.label || `${s.name} (${s.max}M)`);
    const maxMarks = sections.map(s => s.max || 20);
    const yMax = Math.max(...maxMarks, 20);

    const scores = [];
    const backgroundColors = [];
    const borderColors = [];

    sections.forEach(sec => {
      const cell = (student.sections && student.sections[sec.key]) || student[sec.key] || { isAttempted: false, score: 0 };
      const score = cell.isAttempted && cell.score !== null ? cell.score : 0;
      scores.push(score);

      const pct = sec.max > 0 ? (score / sec.max) * 100 : 0;
      if (!cell.isAttempted) {
        backgroundColors.push('#E2E8F0');
        borderColors.push('#94A3B8');
      } else if (pct >= 75) {
        backgroundColors.push('#059669');
        borderColors.push('#047857');
      } else if (pct >= 40) {
        backgroundColors.push('#1D4ED8');
        borderColors.push('#1E40AF');
      } else {
        backgroundColors.push('#B91C1C');
        borderColors.push('#991B1B');
      }
    });

    this.instances.studentModal = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Marks Secured',
            data: scores,
            backgroundColor: backgroundColors,
            borderColor: borderColors,
            borderWidth: 1.5,
            borderRadius: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0F172A',
            borderColor: '#334155',
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: (context) => {
                const idx = context.dataIndex;
                const sec = sections[idx];
                const cell = (student.sections && student.sections[sec.key]) || student[sec.key];
                if (!cell || !cell.isAttempted) return ' Evaluation: MODULE UNATTEMPTED (NA)';
                const max = maxMarks[idx];
                const pct = max > 0 ? ((cell.score / max) * 100).toFixed(0) : 0;
                return ` Marks: ${cell.score} / ${max} (${pct}%)`;
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            max: yMax,
            ticks: {
              stepSize: yMax > 50 ? 20 : yMax > 20 ? 10 : 5,
              font: { family: CHART_FONTS.family, size: 10 },
              color: '#64748B'
            },
            grid: { color: COLORS.grid }
          },
          x: {
            ticks: {
              font: { family: CHART_FONTS.family, size: 10, weight: '600' },
              color: '#1E293B'
            },
            grid: { display: false }
          }
        }
      }
    });
  }

  resizeAll() {
    Object.values(this.instances).forEach(inst => {
      if (inst && typeof inst.resize === 'function') {
        inst.resize();
      }
    });
  }
}
