import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { formatDayKey, formatDayKeyShort } from '../utils/date';

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

/*
  Axis labels, chosen by us instead of by the chart.

  The chart used to tilt every date label 35 degrees inside a 40px strip, and
  the tilted text hung below the card's edge. Now: about six evenly spaced dates,
  written flat ("8 Sep"), with room reserved under the axis for them. The vertical
  axis counts in whole numbers with round steps (0, 5, 10, 15, 20) instead of
  whatever the data happened to produce (0, 65, 130, 195, 260).
*/
function pickTicks(data, target = 6) {
  if (data.length <= target) return data.map((d) => d.date);
  const step = Math.ceil((data.length - 1) / (target - 1));
  const out = [];
  for (let i = 0; i < data.length; i += step) out.push(data[i].date);
  const last = data[data.length - 1].date;
  const lastIdx = data.length - 1;
  const prevIdx = data.findIndex((d) => d.date === out[out.length - 1]);
  if (out[out.length - 1] !== last) {
    // Keep the final date only if it will not sit on top of the previous label.
    if (lastIdx - prevIdx >= step / 2) out.push(last); else out[out.length - 1] = last;
  }
  return out;
}

function niceScale(max) {
  if (max <= 4) return { top: 4, ticks: [0, 1, 2, 3, 4] };
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const ticks = [0, 1, 2, 3, 4].map((i) => i * step);
  return { top: ticks[4], ticks };
}

// `data` is [{date: 'YYYY-MM-DD', reels: n, profiles: n}, ...] in ascending
// date order -- exactly activityByDay's own shape, no transform needed at
// either call site.
export function ActivityChart({ data, height = 220 }) {
  const ticks = pickTicks(data);
  const { top, ticks: yTicks } = niceScale(Math.max(0, ...data.map((d) => (d.reels || 0) + (d.profiles || 0))));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 22, left: 0, bottom: 4 }} barCategoryGap={data.length > 45 ? '10%' : '20%'}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey="date"
          tickFormatter={formatDayKeyShort}
          ticks={ticks}
          interval={0}
          height={30}
          tickMargin={8}
          tick={{ fontSize: 11, fill: 'var(--text-3)' }}
          axisLine={{ stroke: 'var(--border)' }}
          tickLine={false}
        />
        <YAxis
          domain={[0, top]}
          ticks={yTicks}
          allowDecimals={false}
          tick={{ fontSize: 11, fill: 'var(--text-3)' }}
          axisLine={false}
          tickLine={false}
          width={34}
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
