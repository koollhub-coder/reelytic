import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { formatDayKey } from '../utils/date';

/*
  Shared day-by-day activity chart -- Dashboard.jsx's personal view and
  AdminDashboard.jsx's platform-wide view both render one of these over the
  same {date, reels, profiles} shape (see /me/stats and /admin/overview's
  activityByDay).

  WHY RECHARTS, NOT HAND-ROLLED FLEX/PERCENTAGE MATH.
  The previous version of this chart was hand-built: bars sized as a
  percentage of a flex container, rotated date labels under every single
  one. That held up fine at a fixed 14 bars, which is what it was built and
  ever tested against. The moment the date-range picker let someone
  actually select 90 days, it broke in exactly the ways hand-rolled chart
  layout tends to: labels overlapping into an unreadable smear, bars
  bunching into a fraction of the available width instead of spreading
  across it, overflow past the card edge on a phone. ResponsiveContainer
  measures its actual parent and redraws the whole chart to fit it -- at
  any width, any bar count -- and the tick collision avoidance below is a
  maintained library's job, not bespoke math re-derived per screen size.
*/

function ActivityTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  const reels = payload.find((p) => p.dataKey === 'reels')?.value || 0;
  const profiles = payload.find((p) => p.dataKey === 'profiles')?.value || 0;
  return (
    <div className="card" style={{ padding: 'var(--s3)', fontSize: 'var(--fs-xs)', minWidth: '150px' }}>
      <div style={{ fontWeight: 700, marginBottom: '6px' }}>{formatDayKey(label)}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--accent)', display: 'inline-block', flexShrink: 0 }} />
        <span style={{ color: 'var(--text-2)', flex: 1 }}>Reel reports</span>
        <strong style={{ color: 'var(--text)', fontFamily: 'var(--font-data)' }}>{reels}</strong>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--ok)', display: 'inline-block', flexShrink: 0 }} />
        <span style={{ color: 'var(--text-2)', flex: 1 }}>Profile reports</span>
        <strong style={{ color: 'var(--text)', fontFamily: 'var(--font-data)' }}>{profiles}</strong>
      </div>
    </div>
  );
}

// `data` is [{date: 'YYYY-MM-DD', reels: n, profiles: n}, ...] in ascending
// date order -- exactly activityByDay's own shape, no transform needed at
// either call site.
export function ActivityChart({ data, height = 220 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap={data.length > 45 ? '10%' : '20%'}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey="date"
          tickFormatter={formatDayKey}
          interval="preserveStartEnd"
          angle={-40}
          textAnchor="end"
          height={44}
          tick={{ fontSize: 10, fill: 'var(--text-3)' }}
          axisLine={{ stroke: 'var(--border)' }}
          tickLine={false}
          minTickGap={data.length > 45 ? 12 : 24}
        />
        <YAxis
          tick={{ fontSize: 10, fill: 'var(--text-3)' }}
          axisLine={false}
          tickLine={false}
          width={36}
        />
        <Tooltip content={<ActivityTooltip />} cursor={{ fill: 'var(--surface-2)' }} />
        {/* Flat-topped on purpose, not rounded -- rounding only the visually
            topmost segment of a stack means conditionally rounding reels OR
            profiles per bar depending on which one is actually on top that
            day, which Recharts has no built-in way to express per-datapoint.
            Flat is the clean, unambiguous choice instead of a rounded corner
            appearing in the middle of the stack on days both are present. */}
        <Bar dataKey="reels" stackId="day" fill="var(--accent)" maxBarSize={28} />
        <Bar dataKey="profiles" stackId="day" fill="var(--ok)" maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}
