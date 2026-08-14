const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

/*
  Guard rails for anything that touches a database from a test.

  The single worst outcome of a regression suite is a seed or teardown running
  against production and deleting real accounts. Every destructive helper in
  this folder goes through assertTestDatabase first, and it fails loudly
  rather than doing anything clever, because the "clever" version of this
  mistake is unrecoverable.
*/

const TEST_DB_NAME = process.env.TEST_DB_NAME || 'reelytic_test';

// Everything created by the suite carries this prefix. Teardown refuses to
// delete anything without it, which means even a bug in the filters cannot
// reach data a human created.
const TEST_PREFIX = 'rgr_';

function assertTestDatabase() {
  const active = process.env.MONGODB_DB_NAME;

  if (!active) {
    throw new Error(
      'MONGODB_DB_NAME is not set. Tests must run against the test database. '
      + 'Use the npm scripts (npm run regress) rather than calling this directly.'
    );
  }

  if (active !== TEST_DB_NAME) {
    throw new Error(
      `Refusing to run: MONGODB_DB_NAME is "${active}" but tests may only touch "${TEST_DB_NAME}". `
      + 'This guard exists so a regression run can never seed or delete production data.'
    );
  }

  // Belt and braces: a database literally named like the production one is
  // rejected even if TEST_DB_NAME were misconfigured to match it.
  if (/^reelytic$/i.test(active)) {
    throw new Error('Refusing to run against the production database name "reelytic".');
  }

  return active;
}

// Applied to every seeded username so test data is identifiable at a glance
// in Atlas, and so teardown has something unambiguous to match on.
function testName(name) {
  return `${TEST_PREFIX}${name}`;
}

module.exports = { TEST_DB_NAME, TEST_PREFIX, assertTestDatabase, testName };
