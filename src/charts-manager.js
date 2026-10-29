// Chart.js visualizations manager
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

// Chart design tokens
const COLORS = {
  primary: '#2563EB',
  primaryLight: '#60A5FA',
  primaryDark: '#1D4ED8',
  indigo: '#4F46E5',
  indigoLight: '#818CF8',
  emerald: '#10B981',
  emeraldLight: '#34D399',
  amber: '#F59E0B',
  amberLight: '#FBBF24',
  rose: '#EF4444',
  roseLight: '#F87171',
  slate: '#64748B',
  slateLight: '#94A3B8',
  border: '#E2E8F0',
  grid: '#F1F5F9'
};

const CHART_FONTS = {
  family: "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif"
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
        labels: ['0 – 19 Marks', '20 – 29 Marks', '30 – 39 Marks', '40 – 50 Marks'],
        datasets: [{
          label: 'Students',
          data,
          backgroundColor: [
            'rgba(239, 68, 68, 0.85)',   // 0-19: Needs Attention (Rose)
            'rgba(245, 158, 11, 0.85)',  // 20-29: Average (Amber)
            'rgba(59, 130, 246, 0.85)',  // 30-39: Good (Blue)
            'rgba(16, 185, 129, 0.85)'   // 40-50: Excellent (Emerald)
          ],
          borderColor: [
            '#EF4444',
            '#F59E0B',
            '#3B82F6',
            '#10B981'
          ],
          borderWidth: 1.5,
          borderRadius: 8,
          borderSkipped: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0F172A',
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
              color: '#64748B'
            },
            grid: { color: COLORS.grid }
          },
          x: {
            ticks: {
              font: { family: CHART_FONTS.family, size: 11, weight: '500' },
              color: '#334155'
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
    const secStats = aggregates.sectionStats;

    const labels = ['Verbal (10M)', 'Java MCQ\'s (20M)', 'Coding (20M)'];
    const avgScores = [
      secStats.verbal ? secStats.verbal.average : 0,
      secStats.java ? secStats.java.average : 0,
      secStats.coding ? secStats.coding.average : 0
    ];
    const avgPcts = [
      secStats.verbal ? secStats.verbal.avgPct : 0,
      secStats.java ? secStats.java.avgPct : 0,
      secStats.coding ? secStats.coding.avgPct : 0
    ];

    this.instances.sections = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Average Score Obtained',
            data: avgScores,
            backgroundColor: 'rgba(37, 99, 235, 0.85)',
            borderColor: '#2563EB',
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
            padding: 12,
            titleFont: { family: CHART_FONTS.family, size: 13, weight: '600' },
            bodyFont: { family: CHART_FONTS.family, size: 12 },
            callbacks: {
              label: (context) => {
                const idx = context.dataIndex;
                const score = context.parsed.y;
                const max = idx === 0 ? 10 : 20;
                const pct = avgPcts[idx];
                return ` Avg: ${score} / ${max} (${pct}%)`;
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            max: 20,
            ticks: {
              stepSize: 5,
              font: { family: CHART_FONTS.family, size: 11 },
              color: '#64748B'
            },
            grid: { color: COLORS.grid }
          },
          x: {
            ticks: {
              font: { family: CHART_FONTS.family, size: 11, weight: '600' },
              color: '#334155'
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
    const secStats = aggregates.sectionStats;

    const labels = ['Verbal (10M)', 'Java MCQ\'s (20M)', 'Coding (20M)'];
    const attempted = [
      secStats.verbal ? secStats.verbal.attemptedCount : 0,
      secStats.java ? secStats.java.attemptedCount : 0,
      secStats.coding ? secStats.coding.attemptedCount : 0
    ];
    const notAttempted = [
      secStats.verbal ? secStats.verbal.unattemptedCount : 0,
      secStats.java ? secStats.java.unattemptedCount : 0,
      secStats.coding ? secStats.coding.unattemptedCount : 0
    ];

    this.instances.attemptedVsNot = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Attempted Students',
            data: attempted,
            backgroundColor: 'rgba(16, 185, 129, 0.85)',
            borderColor: '#10B981',
            borderWidth: 1.5,
            borderRadius: 6
          },
          {
            label: 'Not Attempted (NA)',
            data: notAttempted,
            backgroundColor: 'rgba(245, 158, 11, 0.85)',
            borderColor: '#F59E0B',
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
              color: '#475569'
            }
          },
          tooltip: {
            backgroundColor: '#0F172A',
            padding: 12,
            callbacks: {
              label: (context) => ` ${context.dataset.label}: ${context.parsed.y} students`
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              stepSize: 2,
              font: { family: CHART_FONTS.family, size: 11 },
              color: '#64748B'
            },
            grid: { color: COLORS.grid }
          },
          x: {
            ticks: {
              font: { family: CHART_FONTS.family, size: 11, weight: '600' },
              color: '#334155'
            },
            grid: { display: false }
          }
        }
      }
    });
  }

  /**
   * Render Attempt Status Breakdown (Doughnut: Full vs Partial)
   */
  renderAttemptStatus(canvasId, aggregates) {
    this.destroy('attempts');
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const total = aggregates.totalStudents || 1;
    // Count full attempts vs partial (has at least 1 NA)
    const fullAttemptCount = total - aggregates.studentsWithNA;
    const partialCount = aggregates.studentsWithNA;

    this.instances.attempts = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Full Attempt (3/3)', 'Has Unattempted (NA)'],
        datasets: [{
          data: [fullAttemptCount, partialCount],
          backgroundColor: [
            'rgba(16, 185, 129, 0.85)',
            'rgba(245, 158, 11, 0.85)'
          ],
          borderColor: ['#10B981', '#F59E0B'],
          borderWidth: 2,
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              boxWidth: 12,
              boxHeight: 12,
              font: { family: CHART_FONTS.family, size: 11, weight: '600' },
              color: '#475569',
              padding: 12
            }
          },
          tooltip: {
            backgroundColor: '#0F172A',
            padding: 12,
            callbacks: {
              label: (context) => {
                const count = context.parsed;
                const pct = ((count / total) * 100).toFixed(1);
                return ` ${context.label}: ${count} students (${pct}%)`;
              }
            }
          }
        }
      }
    });
  }

  /**
   * Render Group Performance Benchmark (Horizontal Bar)
   * Average total score across departments and section
   */
  renderGroupPerformance(canvasId, aggregates) {
    this.destroy('groups');
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const groupStats = aggregates.groupStats.slice(0, 10);
    const labels = groupStats.map(g => g.name.replace(/2025-2029-Prime-/, ''));
    const averages = groupStats.map(g => g.averageTotal);

    this.instances.groups = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Avg Total Score (/50)',
            data: averages,
            backgroundColor: 'rgba(79, 70, 229, 0.85)',
            borderColor: '#4F46E5',
            borderWidth: 1.5,
            borderRadius: 6
          }
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0F172A',
            padding: 12,
            titleFont: { family: CHART_FONTS.family, size: 12.5, weight: '600' },
            bodyFont: { family: CHART_FONTS.family, size: 12 },
            callbacks: {
              label: (context) => ` Average Total: ${context.parsed.x} / 50M`,
              afterLabel: (context) => {
                const g = groupStats[context.dataIndex];
                return `Students: ${g.count} | Pass Rate: ${g.passRate}% | NA Count: ${g.naCount}`;
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
              color: '#64748B'
            },
            grid: { color: COLORS.grid }
          },
          y: {
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
   * Render Test Average Comparison Chart (for Multi-Sheet / Multi-Test)
   */
  renderTestAveragesChart(canvasId, sheetSummaries) {
    this.destroy('testAverages');
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const labels = sheetSummaries.map((s, idx) => `Test ${idx + 1}: ${s.name.slice(0, 14)}`);
    const averages = sheetSummaries.map(s => s.averageTotal);
    const passRates = sheetSummaries.map(s => s.passRate);

    this.instances.testAverages = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Test Average (/50M)',
            data: averages,
            backgroundColor: 'rgba(37, 99, 235, 0.85)',
            borderColor: '#2563EB',
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
            padding: 12,
            callbacks: {
              label: (context) => {
                const s = sheetSummaries[context.dataIndex];
                return ` Test Avg: ${s.averageTotal} / 50M (${s.studentCount} students)`;
              },
              afterLabel: (context) => {
                const s = sheetSummaries[context.dataIndex];
                return `Pass Rate: ${s.passRate}% | Top Score: ${s.highestTotal}`;
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
              color: '#64748B'
            },
            grid: { color: COLORS.grid }
          },
          x: {
            ticks: {
              font: { family: CHART_FONTS.family, size: 11, weight: '600' },
              color: '#334155'
            },
            grid: { display: false }
          }
        }
      }
    });
  }

  /**
   * Render Combined Section Average Chart (Bar)
   * Shows verbal / java / coding averages across all sheets combined
   */
  renderCombinedSectionAvgChart(canvasId, aggregates) {
    this.destroy('combinedSectionAvg');
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const sec = aggregates.sectionStats;

    const labels = ["Verbal (10M)", "Java MCQ's (20M)", "Coding (20M)"];
    const avgScores = [
      sec.verbal ? sec.verbal.average : 0,
      sec.java ? sec.java.average : 0,
      sec.coding ? sec.coding.average : 0
    ];
    const maxes = [10, 20, 20];

    this.instances.combinedSectionAvg = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Avg Score',
            data: avgScores,
            backgroundColor: [
              'rgba(79, 70, 229, 0.85)',
              'rgba(37, 99, 235, 0.85)',
              'rgba(16, 185, 129, 0.85)'
            ],
            borderColor: ['#4F46E5', '#2563EB', '#10B981'],
            borderWidth: 1.5,
            borderRadius: 8
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
            padding: 12,
            callbacks: {
              label: (ctx) => {
                const idx = ctx.dataIndex;
                const score = ctx.parsed.y;
                const max = maxes[idx];
                const pct = ((score / max) * 100).toFixed(0);
                return ` Avg: ${score.toFixed(1)} / ${max} (${pct}%)`;
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            max: 20,
            ticks: {
              stepSize: 5,
              font: { family: CHART_FONTS.family, size: 11 },
              color: '#64748B'
            },
            grid: { color: COLORS.grid }
          },
          x: {
            ticks: {
              font: { family: CHART_FONTS.family, size: 11, weight: '600' },
              color: '#334155'
            },
            grid: { display: false }
          }
        }
      }
    });
  }

  /**
   * Render Combined Group Performance Benchmark
   * Used in combined sheets view with separate instance key
   */
  renderCombinedGroupPerformance(canvasId, aggregates) {
    this.destroy('combinedGroupPerf');
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const groupStats = aggregates.groupStats.slice(0, 12);
    const labels = groupStats.map(g => g.name.replace(/2025-2029-Prime-/, ''));
    const averages = groupStats.map(g => g.averageTotal);

    this.instances.combinedGroupPerf = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Avg Total Score (/50)',
            data: averages,
            backgroundColor: 'rgba(245, 158, 11, 0.85)',
            borderColor: '#F59E0B',
            borderWidth: 1.5,
            borderRadius: 6
          }
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0F172A',
            padding: 12,
            callbacks: {
              label: (context) => ` Average Total: ${context.parsed.x} / 50M`,
              afterLabel: (context) => {
                const g = groupStats[context.dataIndex];
                return `Students: ${g.count} | Pass Rate: ${g.passRate}% | NA: ${g.naCount}`;
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
              color: '#64748B'
            },
            grid: { color: COLORS.grid }
          },
          y: {
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
   * Render Individual Student's Score Breakdown Chart inside Modal
   */
  renderStudentModalChart(canvasId, student) {
    this.destroy('studentModal');
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const labels = ['Verbal (10M)', 'Java MCQ\'s (20M)', 'Coding (20M)'];
    const maxes = [10, 20, 20];
    const scores = [
      student.verbal.isAttempted ? student.verbal.score : 0,
      student.java.isAttempted ? student.java.score : 0,
      student.coding.isAttempted ? student.coding.score : 0
    ];

    const backgroundColors = [
      !student.verbal.isAttempted ? '#F1F5F9' : student.verbal.score >= 7.5 ? '#10B981' : student.verbal.score >= 4 ? '#3B82F6' : '#EF4444',
      !student.java.isAttempted ? '#F1F5F9' : student.java.score >= 15 ? '#10B981' : student.java.score >= 8 ? '#3B82F6' : '#EF4444',
      !student.coding.isAttempted ? '#F1F5F9' : student.coding.score >= 15 ? '#10B981' : student.coding.score >= 8 ? '#3B82F6' : '#EF4444'
    ];

    const borderColors = [
      !student.verbal.isAttempted ? '#CBD5E1' : student.verbal.score >= 7.5 ? '#059669' : student.verbal.score >= 4 ? '#2563EB' : '#DC2626',
      !student.java.isAttempted ? '#CBD5E1' : student.java.score >= 15 ? '#059669' : student.java.score >= 8 ? '#2563EB' : '#DC2626',
      !student.coding.isAttempted ? '#CBD5E1' : student.coding.score >= 15 ? '#059669' : student.coding.score >= 8 ? '#2563EB' : '#DC2626'
    ];

    this.instances.studentModal = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Score Obtained',
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
            padding: 10,
            callbacks: {
              label: (context) => {
                const idx = context.dataIndex;
                const sec = idx === 0 ? student.verbal : idx === 1 ? student.java : student.coding;
                if (!sec.isAttempted) return ' Status: NOT ATTEMPTED (NA)';
                const max = maxes[idx];
                const pct = ((sec.score / max) * 100).toFixed(0);
                return ` Score: ${sec.score} / ${max} (${pct}%)`;
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            max: 20,
            ticks: {
              stepSize: 5,
              font: { family: CHART_FONTS.family, size: 11 },
              color: '#64748B'
            },
            grid: { color: COLORS.grid }
          },
          x: {
            ticks: {
              font: { family: CHART_FONTS.family, size: 11, weight: '600' },
              color: '#334155'
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
