import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client';

// Matches Pricing.jsx's free-tier default -- same public /pricing/plans
// endpoint, so this never drifts from what a client sees when they upgrade.
const FREE_TIER_CREDITS = 10;

export function usePlanCreditsTotal(user) {
  const [total, setTotal] = useState(null);

  useEffect(() => {
    if (!user || user.plan === 'unlimited') { setTotal(null); return; }
    if (user.plan === 'free' || !user.plan) { setTotal(FREE_TIER_CREDITS); return; }
    apiFetch('/pricing/plans')
      .then((res) => {
        const plan = (res.plans || []).find((p) => p.id === user.plan);
        setTotal(plan ? plan.credits : FREE_TIER_CREDITS);
      })
      .catch(() => setTotal(null));
  }, [user?.plan]);

  return total;
}
