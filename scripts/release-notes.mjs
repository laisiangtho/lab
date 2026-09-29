#!/usr/bin/env node
/**
 * Release notes: the commits since the previous release, one short line each.
 *
 * The previous release is the newest tag in the stamped form (v26.09.29.11)
 * that the released commit contains. Merge commits and the release commits
 * themselves (`release:…`) are left out; they say nothing a reader needs. Each
 * entry is the commit's subject line, cut to a readable length, with its short
 * hash, which GitHub turns into a link.
 *
 *   node scripts/release-notes.mjs                 # HEAD, since the last release
 *   node scripts/release-notes.mjs --to <commit>   # what the workflow runs
 *
 * Reads git; writes the notes to standard output and nothing else. Git has to
 * have the history and tags back to the previous release (a checkout with
 * fetch-depth 0); a shallow clone is refused rather than read as "no changes".
 *
 * Node standard library only.
 */

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const TAG = /^v(\d{2})\.(\d{2})\.(\d{2})\.(\d+)$/;
const MAX_SUBJECT = 72;
const MAX_ENTRIES = 25;

/** Newest first, by the numbers in the tag rather than as text (…10 after …9). */
export function newestTag(tags) {
  const key = (t) => TAG.exec(t)?.slice(1).map(Number) ?? null;
  const stamped = tags.filter((t) => key(t));
  stamped.sort((a, b) => {
    const [x, y] = [key(a), key(b)];
    for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return y[i] - x[i];
    return 0;
  });
  return stamped[0] ?? null;
}

/** Whether a commit belongs in the notes. */
export function worthListing(subject) {
  return !/^release:/i.test(subject) && !/^Merge (branch|pull request|remote-tracking)/.test(subject);
}

export function shorten(subject) {
  const one = subject.replace(/\s+/g, ' ').trim();
  return one.length <= MAX_SUBJECT ? one : `${one.slice(0, MAX_SUBJECT - 1).trimEnd()}…`;
}

/**
 * @param {{ commits: { hash: string, subject: string }[], previous: string | null }} input
 *   commits newest first, as `git log` gives them
 */
export function formatNotes({ commits, previous }) {
  const seen = new Set();
  const entries = [];
  for (const { hash, subject } of commits) {
    if (!worthListing(subject)) continue;
    const line = shorten(subject);
    if (seen.has(line)) continue;
    seen.add(line);
    entries.push(`- ${line} (${hash.slice(0, 7)})`);
  }

  const lines = [];
  if (entries.length === 0) {
    lines.push(previous ? `No changes since ${previous} other than the version.` : 'First release.');
  } else {
    lines.push(...entries.slice(0, MAX_ENTRIES));
    if (entries.length > MAX_ENTRIES) lines.push(`- …and ${entries.length - MAX_ENTRIES} more`);
  }
  if (previous) lines.push('', `Since ${previous}.`);
  lines.push(
    '',
    '<details><summary>First run on Windows and macOS</summary>',
    '',
    'The downloads are not signed yet.',
    '',
    '- **Windows:** SmartScreen warns; choose *More info → Run anyway*.',
    '- **macOS:** after moving the app to Applications, open *System Settings → Privacy & Security* and choose *Open Anyway*, or run once in Terminal: `xattr -cr "/Applications/Lai Siangtho.app"`',
    '',
    'Or use it in a browser with nothing to download: https://laisiangtho.github.io/',
    '</details>',
  );
  return `${lines.join('\n')}\n`;
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function main() {
  const { values } = parseArgs({ options: { to: { type: 'string', default: 'HEAD' } } });
  if (git('rev-parse', '--is-shallow-repository') === 'true') {
    throw new Error('the repository is a shallow clone, so the previous release cannot be found; fetch the full history (actions/checkout with fetch-depth: 0)');
  }
  const to = git('rev-parse', '--verify', `${values.to}^{commit}`);
  const tags = git('tag', '--merged', to, '--list', 'v*').split('\n').filter(Boolean);
  // The commit being released may already carry its own tag when the notes
  // are made again; it is not its own previous release.
  const own = new Set(git('tag', '--points-at', to).split('\n').filter(Boolean));
  const previous = newestTag(tags.filter((t) => !own.has(t)));

  const range = previous ? `${previous}..${to}` : to;
  const log = git('log', '--no-merges', '--format=%H%x1f%s', range);
  const commits = log ? log.split('\n').map((l) => {
    const [hash, subject] = l.split('\x1f');
    return { hash, subject };
  }) : [];
  process.stdout.write(formatNotes({ commits, previous }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`release notes: ${error.message}`);
    process.exit(1);
  }
}
