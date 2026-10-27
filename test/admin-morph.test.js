// Admin paneli canlı yenilənməsi: innerHTML-ə qayıdışın qarşısını alan statik yoxlama.
// Brauzerdə real yoxlama: tools/ui-admin-morph.cjs (Playwright).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const src = await readFile(new URL('../public/admin.js', import.meta.url), 'utf8');

test('admin.js: siyahı/ayar yenilənməsində innerHTML istifadə olunmur, morph olunur', () => {
  const code = src.replace(/\/\/.*$/gm, '');
  assert.equal(/\.innerHTML\s*=/.test(code), false, 'admin.js-də innerHTML təyinatı qalıb');
  const fn = code.slice(code.indexOf('export function refreshAdminList'), code.indexOf('export function adminForms'));
  assert.match(fn, /morph\(el, adminListHTML\(\)\)/);
  assert.match(fn, /morph\(st, tgiftSettingsHTML\(\)\)/);
});

test('admin.js: doldurulan formalar açarlı və data-keep-dirty ilə qorunur', () => {
  for (const f of ['creditDecide', 'adminCreateUser', 'adminSettings', 'tgiftSettings']) {
    const tag = src.match(new RegExp(`<form data-form="${f}"[^>]*>`))?.[0] || '';
    assert.match(tag, /data-keep-dirty/, `${f} formasında data-keep-dirty yoxdur`);
  }
  assert.match(src, /data-key="crf\$\{r\.id\}"/, 'kredit forması müraciət id-si ilə açarlanmayıb');
  assert.match(src, /data-key="cr\$\{r\.id\}"/, 'kredit kartı müraciət id-si ilə açarlanmayıb');
});
