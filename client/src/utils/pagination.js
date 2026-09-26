import { useCallback, useState } from 'react';

/*
  One pagination standard for every table in the app.

  WHAT THE INDUSTRY DOES (checked Sep 2026, not from memory):
    - Stripe's list API defaults to 10 per page, allowing 1 to 100.
    - DataTables, the most used table library, defaults to 10.
    - Material UI's table pagination offers 10, 25, 50 and 100.
    - GitHub caps a page at 100.
    - Nielsen Norman Group advise well-spaced choices (10 and 50 rather than
      10, 15 and 20), and the usual advice is to remember what the person chose.
    - Baymard's testing found a page that is too short slows scanning, which is
      why data-heavy views go bigger than a shopping list.

  SO: ONE rule for the whole app. Choices are 10, 25, 50 and 100, the default
  is 10 on every table (History, Creators, report results, admin lists, logs),
  and whatever a person picks is remembered per table. Do not pass a different
  default from a screen; if 10 ever needs to change, change it here, once.
*/

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
export const DEFAULT_PAGE_SIZE = 10;

const key = (id) => `rl-pagesize:${id}`;

function read(id, fallback) {
  try {
    const n = Number(localStorage.getItem(key(id)));
    return PAGE_SIZE_OPTIONS.includes(n) ? n : fallback;
  } catch (e) {
    return fallback;
  }
}

// [size, setSize]. Remembered in this browser, per table id.
export function usePageSize(id) {
  const fallback = DEFAULT_PAGE_SIZE;
  const [size, setSizeState] = useState(() => read(id, fallback));
  const setSize = useCallback((n) => {
    setSizeState(n);
    try { localStorage.setItem(key(id), String(n)); } catch (e) { /* private mode */ }
  }, [id]);
  return [size, setSize];
}
