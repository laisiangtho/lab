/**
 * The reading log: which chapters were read on which day, and what that adds
 * up to — a streak of days, the chapters of the last seven, and how much of the
 * whole Bible has been read at least once.
 *
 * What counts as reading is decided by the caller (the Plan feature counts a
 * chapter that stayed in front of the reader for half a minute, and one ticked
 * in a plan); this only keeps the log and counts it. Days are the reader's
 * local dates, `YYYY-MM-DD`.
 *
 * The log keeps the last 400 days of detail — enough for a year's streak and
 * its week-by-week — and, separately, every chapter ever read with the day it
 * was first read, which is what "how much of the Bible" is counted from.
 */

import { dayNumber } from './plans.js';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const KEY = /^\d+\.\d+$/;
export const KEEP_DAYS = 400;

export const emptyLog = () => ({ v: 1, days: {}, seen: {} });

/** A stored log, checked: anything that does not read as a log is left out. */
export function readLog(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== 1) return emptyLog();
  const days = {};
  for (const [day, keys] of Object.entries(raw.days ?? {})) {
    if (!ISO.test(day) || !Array.isArray(keys)) continue;
    const valid = [...new Set(keys.filter((k) => typeof k === 'string' && KEY.test(k)))];
    if (valid.length) days[day] = valid;
  }
  const seen = {};
  for (const [key, day] of Object.entries(raw.seen ?? {})) if (KEY.test(key) && ISO.test(day)) seen[key] = day;
  return { v: 1, days, seen };
}

/**
 * The log with `key` ("19.23") read on `day`. A new log; the old one is left
 * alone. Returns the same log when nothing changed, so a caller can skip the
 * write.
 */
export function logRead(log, key, day) {
  if (!KEY.test(key)) throw new Error(`reading: expected a chapter key like "19.23", got ${JSON.stringify(key)}`);
  if (!ISO.test(day)) throw new Error(`reading: expected a date like 2026-09-30, got ${JSON.stringify(day)}`);
  const already = log.days[day]?.includes(key) && log.seen[key];
  if (already) return log;
  const days = { ...log.days, [day]: [...new Set([...(log.days[day] ?? []), key])] };
  const kept = Object.keys(days).sort().slice(-KEEP_DAYS);
  return {
    v: 1,
    days: Object.fromEntries(kept.map((d) => [d, days[d]])),
    seen: log.seen[key] ? log.seen : { ...log.seen, [key]: day },
  };
}

/**
 * @param {{ days: object, seen: object }} log
 * @param {string} today
 * @param {number} totalChapters the canon's count, for the share read
 * @returns {{ streak: number, longest: number, week: number, today: number,
 *             read: number, share: number, readToday: boolean }}
 *          `streak` counts back from today, or from yesterday when nothing is
 *          read yet today — a streak is not broken until a whole day is missed.
 */
export function readingStats(log, today, totalChapters) {
  const numbers = Object.keys(log.days).map(dayNumber).sort((a, b) => a - b);
  const set = new Set(numbers);
  const now = dayNumber(today);
  const readToday = set.has(now);
  let streak = 0;
  for (let d = readToday ? now : now - 1; set.has(d); d -= 1) streak += 1;
  let longest = 0;
  let run = 0;
  let previous = null;
  for (const d of numbers) {
    run = previous !== null && d === previous + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = d;
  }
  const week = new Set();
  for (const [day, keys] of Object.entries(log.days)) {
    if (now - dayNumber(day) < 7 && now - dayNumber(day) >= 0) for (const key of keys) week.add(key);
  }
  const read = Object.keys(log.seen).length;
  return {
    streak, longest, week: week.size, today: log.days[today]?.length ?? 0, read,
    share: totalChapters ? read / totalChapters : 0, readToday,
  };
}
