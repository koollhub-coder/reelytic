import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api/client';
import { formatDate } from '../utils/date';

/*
  The admin's credits, with the working shown.

  Nobody on this platform has an unlimited pool. The only real limit is the
  money Apify lets us spend each billing cycle, so an admin's credits are that
  allowance converted into credits. Every step below is a plain division or
  subtraction, so the number can be checked with a calculator.

  Reels and profiles cost us different amounts per credit, so there are two
  honest answers. The balance is the smaller one: the credits that are covered
  whatever mix of work gets run.
*/

const usdFull = (n) => `$${Number(n).toFixed(Number(n) < 0.1 ? 6 : 2)}`;

function Row({ label, detail, value, strong, tone }) {
  return (
    <tr>
      <td style={{ padding: '10px 12px' }}>
        <div style={{ fontWeight: strong ? 700 : 500 }}>{label}</div>
        {detail && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginTop: 2 }}>{detail}</div>}
      </td>
      <td className="mono" style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: strong ? 700 : 500, color: tone === 'accent' ? 'var(--accent)' : undefined }}>
        {value}
      </td>
    </tr>
  );
}

export function PlatformCreditsPanel({ currency = 'USD', rate = null }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback((refresh) => {
    setBusy(true);
    apiFetch(`/admin/platform-credits${refresh ? '?refresh=1' : ''}`)
      .then((res) => { setData(res); setError(''); })
      .catch((err) => setError(err.message || "Couldn't load this."))
      .finally(() => setBusy(false));
  }, []);

  useEffect(() => { load(false); }, [load]);

  const money = (usd, full) => {
    if (currency === 'INR' && rate) {
      const inr = usd * rate;
      return `₹${inr.toFixed(inr < 0.1 ? 5 : 2)}`;
    }
    return full ? usdFull(usd) : `$${Number(usd).toFixed(2)}`;
  };

  if (error) return <div className="card" style={{ marginBottom: 'var(--s6)', color: 'var(--err)' }}>{error}</div>;
  if (!data) return <div className="card" style={{ marginBottom: 'var(--s6)', color: 'var(--text-3)' }}>Working out Apify credits...</div>;
  if (data.unavailable) {
    return (
      <div className="card" style={{ marginBottom: 'var(--s6)' }}>
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700 }}>Apify credits</h3>
        <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginTop: 6 }}>
          Apify's numbers are not reachable right now ({data.reason}), so admin credits show as 0 until they are. Nothing else is affected.
        </p>
      </div>
    );
  }

  const { apify, costs, capacity, heldByClients } = data;
  const oversold = heldByClients > capacity.guaranteedCredits;

  return (
    <div className="card" style={{ marginBottom: 'var(--s6)', padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: 'var(--s5)', display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 'var(--s4)', borderBottom: '1px solid var(--border)' }}>
        <div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Credits Apify gives you</div>
          <div style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--fs-2xl)', fontWeight: 700, lineHeight: 1.1, marginTop: 4 }}>
            {capacity.guaranteedCredits.toLocaleString()}
          </div>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-2)', marginTop: 6, maxWidth: '60ch' }}>
            This is the admin balance. Nobody has unlimited credits, so this is all that can be run until the next Apify cycle.
          </div>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => load(true)} disabled={busy}>{busy ? 'Refreshing...' : 'Refresh now'}</button>
      </div>

      {data.stale && (
        <div style={{ padding: 'var(--s3) var(--s5)', background: 'var(--warn-soft)', color: 'var(--warn)', fontSize: 'var(--fs-sm)' }}>
          Showing the last good figure. Apify could not be reached just now ({data.staleReason}).
        </div>
      )}

      <div className="data-table-container" style={{ border: 0, borderRadius: 0 }}>
        <table className="data-table">
          <tbody>
            <Row
              label="1. Apify allowance this cycle"
              detail={`${apify.planName ? `${apify.planName} plan` : 'Your Apify plan'}${apify.cycleStart ? `, ${formatDate(apify.cycleStart)} to ${formatDate(apify.cycleEnd)}` : ''}`}
              value={money(apify.monthlyUsd)}
            />
            <Row label="2. Already used this cycle" detail="Every run on the account, including admin testing" value={`− ${money(apify.spentUsd, true)}`} />
            <Row label="3. Left to spend" detail={`${money(apify.monthlyUsd)} − ${money(apify.spentUsd, true)}`} value={money(capacity.leftUsd, true)} strong />
            <Row
              label="4. What one Reel credit costs us"
              detail={`1 Reel = ${costs.creditsPerReel} credit, and one Reel costs us ${money(costs.reelUsd, true)}`}
              value={money(costs.reelUsdPerCredit, true)}
            />
            <Row
              label="5. What one profile credit costs us"
              detail={`1 profile = ${costs.creditsPerProfile} credits, and one profile costs us ${money(costs.profileUsd, true)} (${money(costs.profileUsd, true)} ÷ ${costs.creditsPerProfile})`}
              value={money(costs.profileUsdPerCredit, true)}
            />
            <Row label="6. Credits if only Reels are run" detail={`${money(capacity.leftUsd, true)} ÷ ${money(costs.reelUsdPerCredit, true)}`} value={capacity.ifOnlyReels.toLocaleString()} />
            <Row label="7. Credits if only profiles are run" detail={`${money(capacity.leftUsd, true)} ÷ ${money(costs.profileUsdPerCredit, true)}`} value={capacity.ifOnlyProfiles.toLocaleString()} />
            <Row
              label="8. Credits you can count on"
              detail="The smaller of 6 and 7, so it is covered whatever mix of work runs. This is the admin balance."
              value={capacity.guaranteedCredits.toLocaleString()}
              strong
              tone="accent"
            />
            <Row
              label="Credits held by clients"
              detail={oversold
                ? 'More than Apify can fund right now. If they all ran at once, some would be short.'
                : 'Within what Apify can fund right now.'}
              value={<span style={{ color: oversold ? 'var(--err)' : 'var(--ok)' }}>{heldByClients.toLocaleString()}</span>}
            />
          </tbody>
        </table>
      </div>

      <div style={{ padding: 'var(--s3) var(--s5)', fontSize: 'var(--fs-xs)', color: 'var(--text-3)', borderTop: '1px solid var(--border)' }}>
        Worked out from Apify's own numbers and refreshed every minute, so a run by any client lowers it straight away. Costs per item are the measured
        rates for the scan methods currently switched on.{currency === 'INR' && rate ? ` Shown at 1 USD = ₹${rate.toFixed(2)}.` : ''}
      </div>
    </div>
  );
}
