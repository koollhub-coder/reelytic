import React, { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { apiFetch } from '../api/client';
import { BrandLoader } from './BrandLoader';
import { InfoIcon } from './Icon';
import { formatDate, formatDateTime } from '../utils/date';

/*
  Credit audit: proof, not a summary.

  Two different unit systems meet on every row here: credits (what the client
  spent) and money (what we spent). Putting them side by side as plain
  columns is what made the first version unreadable, so they sit under
  spanning group headers with a rule between them, the convention financial
  statements have used forever and the one Stripe and AWS both follow.

  Colour is reserved for meaning, not decoration. A charge is expected, so it
  is neutral; red appears only where something is actually wrong (a balance
  that does not reconcile, or a run that lost money). An earlier version
  painted every normal debit red, which read as a page full of errors.

  Three things it deliberately shows rather than smooths over:

  - A run whose endpoints do not reconcile is flagged, not corrected.
  - A gap between one run's closing balance and the next run's opening one is
    an adjustment made outside any report, drawn as its own segment.
  - An account with an unlimited pool has no meaningful balance or revenue,
    so those columns are withheld rather than filled with a number that
    invites the wrong reading.
*/

const RANGES = [
  { id: '7', label: '7 days' },
  { id: '30', label: '30 days' },
  { id: '90', label: '90 days' },
  { id: 'all', label: 'All time' },
];

const CHART_W = 720;
const CHART_H = 200;
const PAD_L = 52;
const PAD_R = 14;
const PAD_T = 14;
const PAD_B = 30;

function BalanceChart({ runs }) {
  const series = runs.filter((r) => r.creditsBefore != null && r.creditsAfter != null).slice().reverse();

  if (series.length === 0) {
    return (
      <div style={{
        border: '1px dashed var(--border)', borderRadius: 'var(--r-md)',
        padding: 'var(--s5)', textAlign: 'center', marginBottom: 'var(--s5)',
      }}>
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-2)', marginBottom: 4 }}>
          The balance graph starts from the next report this client runs.
        </div>
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>
          Earlier reports did not record an opening and closing balance, so there is nothing to plot for them.
          Everything below is still accurate.
        </div>
      </div>
    );
  }
  if (series.length === 1) {
    const only = series[0];
    return (
      <div style={{
        border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
        padding: 'var(--s4)', marginBottom: 'var(--s5)', fontSize: 'var(--fs-sm)', color: 'var(--text-2)',
      }}>
        One report recorded so far: this client went from{' '}
        <strong className="mono" style={{ color: 'var(--text)' }}>{only.creditsBefore.toLocaleString()}</strong>{' '}
        to{' '}
        <strong className="mono" style={{ color: 'var(--text)' }}>{only.creditsAfter.toLocaleString()}</strong>{' '}
        credits. The graph appears once there are two.
      </div>
    );
  }

  const points = [];
  series.forEach((r, i) => {
    points.push({ x: i, half: 0, value: r.creditsBefore, run: r });
    points.push({ x: i, half: 1, value: r.creditsAfter, run: r });
  });

  const values = points.map((p) => p.value);
  const maxV = Math.max(...values, 1);
  const minV = Math.min(...values, 0);
  const span = maxV - minV || 1;

  const innerW = CHART_W - PAD_L - PAD_R;
  const innerH = CHART_H - PAD_T - PAD_B;
  const stepX = series.length > 1 ? innerW / (series.length - 1 + 0.6) : innerW;

  const px = (p) => PAD_L + (p.x + p.half * 0.6) * stepX;
  const py = (v) => PAD_T + innerH - ((v - minV) / span) * innerH;

  const segments = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const external = a.half === 1 && b.half === 0;
    if (external && a.value === b.value) continue;
    segments.push({ a, b, external });
  }

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    y: PAD_T + innerH * t,
    value: Math.round(maxV - span * t),
  }));

  return (
    <div style={{ overflowX: 'auto', marginBottom: 'var(--s5)' }}>
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        style={{ width: '100%', minWidth: '460px', height: 'auto', display: 'block' }}
        role="img"
        aria-label={`Credit balance across ${series.length} reports`}
      >
        {gridLines.map((g, i) => (
          <g key={i}>
            <line x1={PAD_L} y1={g.y} x2={CHART_W - PAD_R} y2={g.y} stroke="var(--border)" strokeWidth="1" />
            <text x={PAD_L - 8} y={g.y + 3.5} textAnchor="end" fill="var(--text-3)" fontSize="10" fontFamily="var(--font-data)">
              {g.value.toLocaleString()}
            </text>
          </g>
        ))}
        {segments.map((s, i) => (
          <line
            key={i}
            x1={px(s.a)} y1={py(s.a.value)} x2={px(s.b)} y2={py(s.b.value)}
            stroke={s.external ? 'var(--ok)' : 'var(--accent)'}
            strokeWidth={s.external ? 1.6 : 2.4}
            strokeDasharray={s.external ? '4 3' : undefined}
            strokeLinecap="round"
          />
        ))}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={px(p)} cy={py(p.value)} r={p.half === 1 ? 3.2 : 2.4}
            fill={p.half === 1 ? 'var(--accent)' : 'var(--surface)'}
            stroke="var(--accent)" strokeWidth="1.4"
          >
            <title>{`${formatDate(p.run.at)} · ${p.half === 0 ? 'before' : 'after'}: ${p.value.toLocaleString()} credits`}</title>
          </circle>
        ))}
        {series.map((r, i) => (
          i % Math.ceil(series.length / 6) === 0 ? (
            <text key={i} x={px({ x: i, half: 0.3 })} y={CHART_H - 10} textAnchor="middle" fill="var(--text-3)" fontSize="9.5" fontFamily="var(--font-data)">
              {formatDate(r.at)}
            </text>
          ) : null
        ))}
      </svg>
      <div style={{ display: 'flex', gap: 'var(--s4)', fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginTop: 'var(--s2)', flexWrap: 'wrap' }}>
        <span><span style={{ display: 'inline-block', width: 14, height: 2, background: 'var(--accent)', verticalAlign: 'middle', marginRight: 6 }} />Spent on a report</span>
        <span><span style={{ display: 'inline-block', width: 14, height: 2, background: 'var(--ok)', verticalAlign: 'middle', marginRight: 6 }} />Changed outside a report (top-up or reset)</span>
      </div>
    </div>
  );
}

function Metric({ label, value, hint, tone }) {
  return (
    <div>
      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginBottom: 3 }}>{label}</div>
      <div
        className="mono"
        style={{
          fontSize: 'var(--fs-lg)', fontWeight: 700, lineHeight: 1.15,
          color: tone === 'good' ? 'var(--ok)' : tone === 'bad' ? 'var(--err)' : 'var(--text)',
        }}
      >
        {value}
      </div>
      {hint && <div style={{ fontSize: '11px', color: 'var(--text-3)', marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

export function CreditAuditModal({ username, isOpen, onClose, currency, rate, fmtMoney }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [range, setRange] = useState('30');

  useEffect(() => {
    if (!isOpen || !username) return undefined;
    let cancelled = false;
    setError('');
    setLoading(true);
    apiFetch(`/admin/usage/credits/${encodeURIComponent(username)}?days=${range}`)
      .then((res) => { if (!cancelled) setData(res); })
      .catch((err) => { if (!cancelled) setError(err.message || "Couldn't load the credit history"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, username, range]);

  // Reset to the default window whenever a different client is opened, so one
  // client's chosen range never silently frames another's numbers.
  useEffect(() => { if (isOpen) setRange('30'); }, [isOpen, username]);

  const runs = (data && data.runs) || [];
  const unlimited = !!(data && data.unlimited);
  const showMoney = !unlimited && data && data.totalRevenueUsd != null;
  // A client on a plan with no price attached (the free tier) genuinely
  // produces no revenue. That is a real state worth naming, not an empty
  // column: "no margin shown" and "margin is zero" look identical otherwise.
  const freePlan = !!(data && !unlimited && data.totalRevenueUsd == null);
  const rangeLabel = (RANGES.find((r) => r.id === range) || RANGES[1]).label.toLowerCase();

  // Group boundaries get a rule; every numeric column right-aligns.
  const groupEdge = { borderLeft: '1px solid var(--border)' };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={username ? `${username}: credit audit` : ''}
      width="1040px"
    >
      <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center', flexWrap: 'wrap', marginBottom: 'var(--s4)' }}>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>Showing</span>
        <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', overflow: 'hidden' }}>
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRange(r.id)}
              style={{
                padding: '5px 14px', border: 'none', cursor: 'pointer',
                fontSize: 'var(--fs-xs)', fontWeight: range === r.id ? 700 : 500,
                background: range === r.id ? 'var(--accent)' : 'transparent',
                color: range === r.id ? '#fff' : 'var(--text-2)',
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
        {unlimited && (
          <span className="chip" style={{ padding: '2px 10px', fontSize: '10px' }}>Internal account</span>
        )}
        {freePlan && (
          <span className="chip" style={{ padding: '2px 10px', fontSize: '10px' }}>Free plan, no revenue</span>
        )}
      </div>

      {loading ? (
        <BrandLoader variant="inline" message="Loading credit history..." />
      ) : error ? (
        <div style={{ color: 'var(--err)' }}>{error}</div>
      ) : !data ? null : runs.length === 0 ? (
        <div style={{ color: 'var(--text-3)', textAlign: 'center', padding: 'var(--s6)' }}>
          No reports run in the last {rangeLabel}. Try a wider range.
        </div>
      ) : (
        <>
          {data.verifiable === 0 ? (
            <div style={{ padding: 'var(--s3) var(--s4)', background: 'var(--surface-2)', borderRadius: 'var(--r-md)', fontSize: 'var(--fs-sm)', color: 'var(--text-2)', marginBottom: 'var(--s4)' }}>
              These runs finished before opening and closing balances were recorded, so they cannot be
              checked. Any report run from now on will be.
            </div>
          ) : data.unreconciled === 0 ? (
            <div style={{ padding: 'var(--s3) var(--s4)', background: 'var(--accent-soft)', borderRadius: 'var(--r-md)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s4)' }}>
              {/* Explained runs do not balance, they are only accounted for.
                  Folding them into "all balance exactly" would be the page
                  telling a small lie to look tidier. */}
              {data.explained > 0 ? (
                <>
                  <strong style={{ color: 'var(--ok)' }}>Nothing outstanding across {data.verifiable} checkable run{data.verifiable === 1 ? '' : 's'}.</strong>
                  <span style={{ color: 'var(--text-2)' }}>
                    {' '}{data.verifiable - data.explained} balance exactly. The other {data.explained} carry a gap
                    that was traced to the credit-charging bug fixed on 14-aug-26 and signed off, shown below.
                  </span>
                </>
              ) : (
                <>
                  <strong style={{ color: 'var(--ok)' }}>All {data.verifiable} checkable run{data.verifiable === 1 ? '' : 's'} balance exactly.</strong>
                  <span style={{ color: 'var(--text-2)' }}>Opening balance minus credits used equals the closing balance on every one.</span>
                </>
              )}
            </div>
          ) : (
            <div style={{ padding: 'var(--s3) var(--s4)', background: 'var(--surface-2)', border: '1px solid var(--err)', borderRadius: 'var(--r-md)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s4)' }}>
              <strong style={{ color: 'var(--err)' }}>{data.unreconciled} of {data.verifiable} runs do not balance.</strong>
              <span style={{ color: 'var(--text-2)' }}>Either the balance was changed while the report was running, or a charge did not land. The rows are marked below.</span>
            </div>
          )}

          {/* Totals first, the way Stripe's dashboard opens. The detail below
              is the working; this is the answer. */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 'var(--s4)',
            padding: 'var(--s4)', background: 'var(--surface-2)', borderRadius: 'var(--r-md)', marginBottom: 'var(--s5)',
          }}>
            <Metric
              label="Balance now"
              value={unlimited ? 'Unlimited' : (data.currentBalance != null ? data.currentBalance.toLocaleString() : '-')}
              hint={unlimited ? 'Internal pool, not billed' : `${data.plan} plan`}
            />
            <Metric
              label="Credits used"
              value={data.totalSpent.toLocaleString()}
              hint={`${data.totalItems.toLocaleString()} items, ${data.totalCached.toLocaleString()} free`}
            />
            {showMoney && (
              <Metric label="They paid us" value={fmtMoney(data.totalRevenueUsd, currency, rate)} hint="at their plan rate" />
            )}
            <Metric
              label="It cost us"
              value={fmtMoney(data.totalCostUsd, currency, rate)}
              hint={data.totalSpent > 0 ? `${fmtMoney(data.totalCostUsd / data.totalSpent, currency, rate)} per credit` : null}
            />
            {showMoney && (
              <Metric
                label="Margin"
                value={data.totalMarginPct != null ? `${data.totalMarginPct.toFixed(1)}%` : '-'}
                tone={data.totalMarginPct != null ? (data.totalMarginPct >= 0 ? 'good' : 'bad') : undefined}
                hint={data.totalMarginPct != null ? fmtMoney(data.totalRevenueUsd - data.totalCostUsd, currency, rate) + ' kept' : null}
              />
            )}
          </div>

          <BalanceChart runs={runs} />

          <div className="rl-table-scroll"><table className="data-table">
            <thead>
              {/* Spanning group row: the two unit systems are named once,
                  above their own columns, instead of every cell having to
                  carry its own explanation. */}
              <tr>
                <th colSpan={2} style={{ borderBottom: 'none' }}></th>
                <th
                  colSpan={4}
                  style={{ ...groupEdge, borderBottom: 'none', textAlign: 'center', color: 'var(--text-2)', letterSpacing: '0.06em' }}
                >
                  THE CLIENT&apos;S CREDITS
                </th>
                <th
                  colSpan={showMoney ? 3 : 1}
                  style={{ ...groupEdge, borderBottom: 'none', textAlign: 'center', color: 'var(--text-2)', letterSpacing: '0.06em' }}
                >
                  MONEY
                </th>
              </tr>
              <tr>
                <th>When</th>
                <th>Report</th>
                <th className="numeric" style={groupEdge}>Before</th>
                <th className="numeric">Used</th>
                <th className="numeric">After</th>
                <th>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                    Balances?
                    <span
                      title={'Does the arithmetic add up? We check Before minus Used against After.\n\nYes: the balance fell by exactly the credits counted, so the charge landed correctly.\n\n"Off by N": it did not. The account moved by a different amount than we counted, so either a charge failed to land or the balance was changed by something else while the report was running (a top-up, a plan reset, or another report running at the same time).\n\nNot recorded: this run finished before we started saving opening and closing balances, so there is nothing to check it against.'}
                      style={{ display: 'inline-flex', color: 'var(--text-3)', cursor: 'help' }}
                    >
                      <InfoIcon size={13} />
                    </span>
                  </span>
                </th>
                <th className="numeric" style={groupEdge}>Cost to us</th>
                {showMoney && <th className="numeric">They paid</th>}
                {showMoney && <th className="numeric">Margin</th>}
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.jobId}>
                  <td className="mono" style={{ color: 'var(--text-3)', fontSize: 'var(--fs-xs)', whiteSpace: 'nowrap' }}>{formatDateTime(r.at)}</td>
                  <td style={{ textTransform: 'capitalize', whiteSpace: 'nowrap' }}>
                    {r.type}
                    <span style={{ color: 'var(--text-3)', fontSize: 'var(--fs-xs)', marginLeft: 6 }}>
                      {r.itemsCharged.toLocaleString()} item{r.itemsCharged === 1 ? '' : 's'}
                    </span>
                    {r.cachedItems > 0 && (
                      <span className="chip" style={{ marginLeft: 6, padding: '1px 6px', fontSize: '10px', color: 'var(--ok)', borderColor: 'var(--ok)' }}>
                        {r.cachedItems} free
                      </span>
                    )}
                  </td>
                  <td className="numeric mono" style={{ ...groupEdge, color: 'var(--text-3)' }}>
                    {r.creditsBefore != null ? r.creditsBefore.toLocaleString() : '-'}
                  </td>
                  {/* Neutral, not red: spending credits is what the product
                      is for, and colouring it as a loss made a healthy page
                      look like a list of failures. */}
                  <td className="numeric mono" style={{ fontWeight: 600 }}>
                    {r.creditsSpent ? r.creditsSpent.toLocaleString() : '0'}
                  </td>
                  <td className="numeric mono" style={{ color: 'var(--text-3)' }}>
                    {r.creditsAfter != null ? r.creditsAfter.toLocaleString() : '-'}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {r.reconciled === null ? (
                      <span style={{ color: 'var(--text-3)', fontSize: 'var(--fs-xs)' }}>Not recorded</span>
                    ) : r.reconciled ? (
                      <span style={{ color: 'var(--ok)' }}>Yes</span>
                    ) : (
                      (() => {
                        // Signed, not absolute: the direction is the whole
                        // point. Undercharged means we counted more credits
                        // than actually left the account, which is money we
                        // failed to collect; overcharged is the reverse.
                        const expected = r.creditsBefore - r.creditsSpent;
                        const diff = r.creditsAfter - expected;
                        const under = diff > 0;
                        /*
                          An explained gap is shown in full but without the
                          red: the cause is known and already fixed, so
                          dressing it as an open fault every time this page
                          opens trains you to scroll past exactly the column
                          that would show the next real one.
                        */
                        const explained = r.driftExplained;
                        return (
                          <span
                            style={{ color: explained ? 'var(--text-2)' : 'var(--err)', fontWeight: 600 }}
                            title={`Expected ${expected.toLocaleString()} after the run (${r.creditsBefore.toLocaleString()} before minus ${r.creditsSpent.toLocaleString()} used), but the account actually held ${r.creditsAfter.toLocaleString()}. ${under ? 'They kept credits we counted as spent, so this run was undercharged.' : 'More credits left the account than this run counted.'}${explained ? ' Traced to the credit-charging bug fixed on 14-aug-26, and signed off. Nothing further is outstanding on this run.' : ''}`}
                          >
                            Off by {Math.abs(diff).toLocaleString()}
                            <span style={{ display: 'block', fontWeight: 400, fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>
                              {explained ? 'known issue, resolved' : (under ? 'undercharged' : 'overcharged')}
                            </span>
                          </span>
                        );
                      })()
                    )}
                  </td>
                  <td className="numeric mono" style={groupEdge}>{fmtMoney(r.costUsd, currency, rate)}</td>
                  {showMoney && (
                    <td className="numeric mono" style={{ color: 'var(--text-2)' }}>
                      {r.revenueUsd != null ? fmtMoney(r.revenueUsd, currency, rate) : '-'}
                    </td>
                  )}
                  {showMoney && (
                    <td
                      className="numeric mono"
                      style={{ fontWeight: 600, color: r.marginPct == null ? 'var(--text-3)' : r.marginPct >= 0 ? 'var(--ok)' : 'var(--err)' }}
                    >
                      {r.marginPct != null ? `${r.marginPct.toFixed(0)}%` : '-'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table></div>

          <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginTop: 'var(--s3)', lineHeight: 1.6 }}>
            <strong style={{ color: 'var(--text-2)' }}>Before, Used and After</strong> are recorded separately: the balance is read
            from the account when the report starts and again when it finishes, while credits are counted per successful item as it
            runs. That is why the Balances column is a real check rather than the same figure repeated.
            {showMoney && ` They paid is what those credits are worth on the ${data.plan} plan (₹${data.planPriceInr?.toLocaleString('en-IN')} for ${data.planCredits?.toLocaleString()} credits). Cost to us counts cached items as zero, because no lookup was made.`}
            {unlimited && 'This is an internal account with an unlimited pool, so there is no balance to run down and no revenue to compare against. Cost to us is still real money.'}
            {freePlan && ` This client is on the free plan, so they pay nothing and there is no margin to show. Cost to us is real money we spent on them. Move them to a paid plan and the revenue and margin columns fill in automatically.`}
          </p>
        </>
      )}
    </Modal>
  );
}
