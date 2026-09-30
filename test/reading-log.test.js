/** The reading log: streaks, the week, and the share of the Bible read. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyLog, KEEP_DAYS, logRead, readingStats, readLog } from '../app/core/reading.js';

const day = (n) => { const d = new Date(Date.UTC(2026, 8, 1 + n)); return d.toISOString().slice(0, 10); };

test('a streak counts back from today, or from yesterday until today is read', () => {
  let log = emptyLog();
  for (const n of [0, 1, 2, 5, 6, 7, 8]) log = logRead(log, `1.${n + 1}`, day(n));
  let s = readingStats(log, day(8), 1189);
  assert.equal(s.streak, 4, 'days 5 to 8');
  assert.equal(s.longest, 4);
  assert.equal(s.readToday, true);
  s = readingStats(log, day(9), 1189);
  assert.equal(s.streak, 4, 'nothing yet today does not break it');
  assert.equal(s.readToday, false);
  s = readingStats(log, day(10), 1189);
  assert.equal(s.streak, 0, 'a whole day missed does');
  assert.equal(s.longest, 4);
});

test('the week counts chapters, and the whole counts each chapter once', () => {
  let log = emptyLog();
  log = logRead(log, '19.23', day(0));
  log = logRead(log, '19.23', day(3));
  log = logRead(log, '43.3', day(3));
  log = logRead(log, '1.1', day(12));
  const s = readingStats(log, day(12), 1189);
  assert.equal(s.week, 1, 'only 1.1 falls in the last seven days');
  assert.equal(s.read, 3);
  assert.equal(s.today, 1);
  assert.ok(Math.abs(s.share - 3 / 1189) < 1e-9);
  assert.equal(log.seen['19.23'], day(0), 'first read is kept');
});

test('logging the same chapter twice changes nothing', () => {
  const once = logRead(emptyLog(), '1.1', day(0));
  assert.equal(logRead(once, '1.1', day(0)), once);
  assert.throws(() => logRead(once, 'Genesis 1', day(0)), /chapter key/);
  assert.throws(() => logRead(once, '1.1', '30/9/2026'), /a date like/);
});

test('detail is kept for a limited number of days, the whole list for ever', () => {
  let log = emptyLog();
  for (let n = 0; n < KEEP_DAYS + 5; n += 1) log = logRead(log, `1.${(n % 50) + 1}`, day(n));
  assert.equal(Object.keys(log.days).length, KEEP_DAYS);
  assert.equal(Object.keys(log.seen).length, 50);
  assert.deepEqual(readLog(JSON.parse(JSON.stringify(log))), log);
  assert.deepEqual(readLog({ v: 1, days: { nope: ['1.1'], [day(0)]: ['x', '1.1'] }, seen: { '1.1': 'x' } }),
    { v: 1, days: { [day(0)]: ['1.1'] }, seen: {} });
});
