import React from 'react';
import { EyeIcon, UsersIcon, TrendingUpIcon, ChevronDownIcon } from './Icon';

/*
  Purely illustrative marketing decoration for the auth-page left panels
  (Forgot Password today; Login/Signup already do the same thing with
  LedgerHero) -- not a real report, never fed real account data. Same
  precedent as LedgerHero: invented numbers are fine here specifically
  because this is a static hero graphic on a signed-out page, not a screen
  inside the product that could be mistaken for the user's own data. Avatars
  are colored initials rather than photos, on purpose, for the same reason
  CampaignAvatar's fallback is -- no invented "real" people.
*/

const SPARK_PATHS = {
  views: 'M2 20 L14 16 L26 18 L38 10 L50 12 L62 4',
  engagements: 'M2 18 L14 14 L26 16 L38 8 L50 10 L62 6',
  rate: 'M2 16 L14 18 L26 12 L38 14 L50 6 L62 8',
};

function Sparkline({ variant }) {
  return (
    <svg viewBox="0 0 64 24" width="64" height="24" style={{ display: 'block' }}>
      <path d={SPARK_PATHS[variant]} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
    </svg>
  );
}

function StatTile({ icon, label, value }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-3)', fontSize: 'var(--fs-xs)', marginBottom: '6px' }}>
        {icon}
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      </div>
      <div style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--fs-xl)', fontWeight: 700, color: 'var(--text)', marginBottom: '4px' }}>{value}</div>
      <Sparkline variant={label === 'Total views' ? 'views' : label === 'Engagements' ? 'engagements' : 'rate'} />
    </div>
  );
}

const CREATORS = [
  { handle: '@arjunnehra', initial: 'A', color: 'var(--accent)', views: '342K', engagements: '16.4K', er: '4.80%' },
  { handle: '@the.simran', initial: 'S', color: '#5B8DEF', views: '287K', engagements: '10.3K', er: '3.90%' },
  { handle: '@kabirshoots', initial: 'K', color: '#3FB68B', views: '196K', engagements: '5.8K', er: '3.20%' },
  { handle: '@nehaonreels', initial: 'N', color: '#E0A93A', views: '154K', engagements: '3.7K', er: '2.40%' },
];

export function WorkspaceOverviewCard() {
  return (
    <div className="card" style={{ padding: 'var(--s5)', boxShadow: 'var(--shadow-lg)', backgroundColor: 'var(--surface)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--s4)' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'var(--fs-base)' }}>Workspace overview</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: 'var(--fs-xs)', color: 'var(--text-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '4px 8px' }}>
          Last 14 days
          <ChevronDownIcon size={12} />
        </span>
      </div>

      <div style={{ display: 'flex', gap: 'var(--s5)', marginBottom: 'var(--s5)', paddingBottom: 'var(--s4)', borderBottom: '1px solid var(--border)' }}>
        <StatTile icon={<EyeIcon size={13} />} label="Total views" value="1.24M" />
        <StatTile icon={<UsersIcon size={13} />} label="Engagements" value="48.9K" />
        <StatTile icon={<TrendingUpIcon size={13} />} label="Engagement rate" value="3.94%" />
      </div>

      <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 'var(--s3)' }}>
        Top creators
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sm)' }}>
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--text-3)', fontSize: 'var(--fs-xs)' }}>
            <th style={{ padding: '4px 8px 4px 0', fontWeight: 600 }}>CREATOR</th>
            <th style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600 }}>VIEWS</th>
            <th style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600 }}>ENGAGEMENTS</th>
            <th style={{ padding: '4px 0 4px 8px', textAlign: 'right', fontWeight: 600 }}>ER</th>
          </tr>
        </thead>
        <tbody>
          {CREATORS.map((c) => (
            <tr key={c.handle}>
              <td style={{ padding: '6px 8px 6px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{
                    width: '22px', height: '22px', borderRadius: '50%', flexShrink: 0,
                    backgroundColor: c.color, color: '#fff', fontSize: '10px', fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {c.initial}
                  </div>
                  <span style={{ fontFamily: 'var(--font-data)' }}>{c.handle}</span>
                </div>
              </td>
              <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--font-data)' }}>{c.views}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--font-data)' }}>{c.engagements}</td>
              <td style={{ padding: '6px 0 6px 8px', textAlign: 'right', fontFamily: 'var(--font-data)', color: 'var(--ok)', fontWeight: 600 }}>{c.er}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
