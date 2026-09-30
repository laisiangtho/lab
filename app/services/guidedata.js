/**
 * Downloading guide answers from the catalog repository.
 *
 * GitHub is asked once for the repository's file list (one request, the git
 * tree), which gives each file's path and content hash. Files under
 * `guide/<language>/` for the languages asked for are then fetched — only the
 * ones that are new or whose hash changed — checked by `parseGuideFile`, and
 * kept; files that have gone from the repository are let go. An update is
 * therefore the same operation as the first download, and costs one request
 * plus one per changed file.
 *
 * GitHub allows about sixty file-list requests an hour from one address to
 * anybody not signed in. A reader pressing Update does not come near it; an
 * app that checked at every start could, so this runs only when asked.
 *
 * A file that cannot be read is reported with its path and reason and the
 * others are kept; the caller shows the list.
 */

import { guidePaths, languageOfPath, parseGuideFile, strayPaths } from '../core/guidedata.js';
import { fetchJson } from './library.js';

export function createGuideData({ store, config }) {
  /** The repository's guide files: [{ path, sha, size }], and anything under guide/ that is not data. */
  async function list() {
    let tree;
    try {
      tree = await fetchJson(config.repoTreeUrl, 'the catalog repository\'s file list', { cache: 'no-cache' });
    } catch (err) {
      // 403 and 429 are GitHub's limit on requests from one address.
      if (/HTTP (403|429)/.test(err.message)) throw new Error('GitHub has had too many requests from this address; try again within the hour');
      throw err;
    }
    if (!Array.isArray(tree?.tree)) throw new Error('the catalog repository\'s file list: GitHub answered with something that is not a file list');
    if (tree.truncated) throw new Error('the catalog repository\'s file list came back cut short by GitHub; the guide cannot tell which files are there');
    const blobs = tree.tree.filter((item) => item.type === 'blob');
    const paths = blobs.map((item) => item.path);
    const wanted = new Set(guidePaths(paths));
    return {
      files: blobs.filter((item) => wanted.has(item.path)).map(({ path, sha, size }) => ({ path, sha, size })),
      stray: strayPaths(paths),
    };
  }

  /**
   * Bring the held files for `languages` up to date with the repository.
   * @returns {Promise<{ added: number, updated: number, removed: number, kept: number,
   *                     failed: { path: string, message: string }[], stray: string[] }>}
   */
  async function update(languages, onProgress = () => {}) {
    const want = new Set(languages);
    const { files, stray } = await list();
    const remote = files.filter((file) => want.has(languageOfPath(file.path)));
    const held = new Map((await store.guideFiles()).map((row) => [row.path, row]));
    const todo = remote.filter((file) => held.get(file.path)?.sha !== file.sha);
    const put = [];
    const failed = [];
    let done = 0;
    for (const file of todo) {
      onProgress({ done, total: todo.length });
      try {
        const json = await fetchJson(config.repoFileUrl.replace('{path}', file.path.split('/').map(encodeURIComponent).join('/')), file.path);
        const parsed = parseGuideFile(json, file.path);
        put.push({ path: file.path, sha: file.sha, lang: parsed.lang, topic: parsed.topic, modified: parsed.modified, entries: parsed.entries, fetchedAt: new Date().toISOString() });
      } catch (err) {
        failed.push({ path: file.path, message: err.message });
      }
      done += 1;
    }
    onProgress({ done, total: todo.length });
    const present = new Set(remote.map((file) => file.path));
    const remove = [...held.keys()].filter((path) => want.has(languageOfPath(path)) && !present.has(path));
    await store.changeGuideFiles({ put, remove });
    const added = put.filter((row) => !held.has(row.path)).length;
    return {
      added, updated: put.length - added, removed: remove.length,
      kept: remote.length - todo.length, failed, stray,
    };
  }

  return {
    list,
    update,
    held: () => store.guideFiles(),
    clear: () => store.clearGuideFiles(),
  };
}
