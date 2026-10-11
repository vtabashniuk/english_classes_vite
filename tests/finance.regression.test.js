import assert from 'node:assert/strict';
import test from 'node:test';

import { sortFinanceOperationsNewestFirst } from '../src/features/finance/lib/financeSort.js';
import { buildFinanceReceiptSummary } from '../src/features/finance/lib/financeSummary.js';

test('finance: sort priority is business date DESC, then created_at DESC, then id DESC', () => {
  const rows = [
    { payment_id: 'b', payment_date: '2026-10-12', created_at: '2026-10-12T07:00:00Z' },
    { payment_id: 'a', payment_date: '2026-10-13', created_at: '2026-10-11T07:00:00Z' },
    { payment_id: 'a', payment_date: '2026-10-12', created_at: '2026-10-12T07:00:00Z' },
    { payment_id: 'c', payment_date: '2026-10-12', created_at: '2026-10-12T08:00:00Z' },
  ];
  const snapshot = structuredClone(rows);
  const sorted = sortFinanceOperationsNewestFirst(rows);
  assert.deepEqual(sorted.map((r) => `${r.payment_date}/${r.payment_id}`), [
    '2026-10-13/a',
    '2026-10-12/c',
    '2026-10-12/b',
    '2026-10-12/a',
  ]);
  assert.deepEqual(rows, snapshot, 'Sorting must not mutate the input array');
});

test('finance: custom operation field names preserve the same ordering contract', () => {
  const rows = [
    { id: '1', effective_on: '2026-10-11', created_on: '2026-10-12T10:00:00Z' },
    { id: '2', effective_on: '2026-10-12', created_on: '2026-10-11T10:00:00Z' },
  ];
  assert.deepEqual(sortFinanceOperationsNewestFirst(rows, {
    dateField: 'effective_on', createdAtField: 'created_on', idField: 'id',
  }).map((r) => r.id), ['2', '1']);
});

test('finance: receipt totals remain separated by currency, reporting uses UAH minor units', () => {
  const result = buildFinanceReceiptSummary([
    { currency: 'UAH', amount_minor: 80000, reporting_uah_minor: 80000, net_income_uah_minor: 67000, profitability_status: 'ready' },
    { currency: 'USD', amount_minor: 2500, reporting_uah_minor: 105000, net_income_uah_minor: 97000, profitability_status: 'ready' },
    { currency: 'UAH', amount_minor: 12000, reporting_uah_minor: 12000, net_income_uah_minor: 10000, profitability_status: 'ready' },
  ]);
  assert.deepEqual(result.totalsByCurrency, { UAH: 92000, USD: 2500 });
  assert.equal(result.totalIncomeUahMinor, 197000);
  assert.equal(result.netIncomeUahMinor, 174000);
  assert.equal(result.reportingPending, false);
  assert.equal(result.profitabilityPending, false);
});

test('finance: missing reporting snapshot and unfinished profitability keep pending flags visible', () => {
  const result = buildFinanceReceiptSummary([
    { currency: 'EUR', amount_minor: 5000, reporting_uah_minor: null, profitability_status: 'pending', net_income_uah_minor: null },
    { currency: 'UAH', amount_minor: 1000, reporting_uah_minor: 1000, profitability_status: 'ready', net_income_uah_minor: 850 },
  ]);
  assert.deepEqual(result.totalsByCurrency, { EUR: 5000, UAH: 1000 });
  assert.equal(result.totalIncomeUahMinor, 1000);
  assert.equal(result.netIncomeUahMinor, 850);
  assert.equal(result.reportingPending, true);
  assert.equal(result.profitabilityPending, true);
});

test('finance: an empty set of receipts returns zero totals without pending flags', () => {
  assert.deepEqual(buildFinanceReceiptSummary([]), {
    totalsByCurrency: {}, totalIncomeUahMinor: 0, netIncomeUahMinor: 0,
    reportingPending: false, profitabilityPending: false,
  });
});
