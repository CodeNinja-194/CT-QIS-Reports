import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { DonutChart, DonutChartSegment } from '../components/ui/donut-chart';
import { motion, AnimatePresence } from 'framer-motion';

let donutRoot: Root | null = null;

export function renderReactDonut(containerId: string, aggregates: any) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const total = aggregates.totalStudents || 0;
  const fullCount = Math.max(0, total - (aggregates.studentsWithNA || 0));
  const partialCount = aggregates.studentsWithNA || 0;

  const data: DonutChartSegment[] = [
    { label: "Full Attempt", value: fullCount, color: "hsl(158, 84%, 39%)" },
    { label: "Partial Attempt", value: partialCount, color: "hsl(215, 16%, 47%)" },
  ];

  if (!donutRoot) {
    donutRoot = createRoot(container);
  }

  donutRoot.render(<ReactDonutView data={data} total={total} />);
}

function ReactDonutView({ data, total }: { data: DonutChartSegment[]; total: number }) {
  const [hovered, setHovered] = React.useState<DonutChartSegment | null>(null);
  const displayVal = hovered ? hovered.value : total;
  const displayLabel = hovered ? hovered.label : "Total Students";
  const displayPct = total > 0 ? ((displayVal / total) * 100).toFixed(0) : "0";

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
      <DonutChart
        data={data}
        size={210}
        strokeWidth={24}
        animationDuration={1}
        onSegmentHover={setHovered}
        centerContent={
          <AnimatePresence mode="wait">
            <motion.div
              key={displayLabel}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.2 }}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}
            >
              <span style={{ fontSize: '0.75rem', color: '#64748B', fontWeight: 500, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {displayLabel}
              </span>
              <span style={{ fontSize: '1.6rem', fontWeight: 700, color: '#0F172A', lineHeight: 1.2 }}>
                {displayVal}
              </span>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748B' }}>
                [{displayPct}%]
              </span>
            </motion.div>
          </AnimatePresence>
        }
      />
      <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', marginTop: '10px', fontSize: '0.75rem' }}>
        {data.map(seg => (
          <div key={seg.label} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: seg.color }} />
            <span style={{ fontWeight: 600, color: '#334155' }}>{seg.label}: {seg.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
