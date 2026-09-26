// npm run audit:ui  -- opens every page at desktop and phone width, light and dark,
// saves screenshots to ./audit-shots and fails on any overflow or sideways scroll.
const { spawnSync } = require('child_process');
const res = spawnSync('npx', ['playwright', 'test', 'tests/ui/audit.spec.js', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, AUDIT_UI: '1' },
});
process.exit(res.status === null ? 1 : res.status);
