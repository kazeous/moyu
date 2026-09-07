# Lexical asset releases

These build-time tools normalize published bulk dictionaries. They never process
private dialogue. The application downloads only the resulting static gzip packs;
all indexing and analysis run in the browser worker.

The four complete language subsets are JMdict Japanese–English, CC-CEDICT
Chinese–English, and Vietnamese Wiktionary Japanese–Vietnamese/Chinese–Vietnamese.
The Vietnamese packs retain raw `ja`, and `zh`/`cmn`, records respectively. They
include missing-gloss records with empty senses to preserve explicit unavailable
evidence; they do not imply that Vietnamese coverage matches English coverage.

## Rebuild

Requires Python 3.12+ with its standard library. No third-party Python packages
or application package changes are required. Run from the repository root:

```sh
python -m unittest discover -s scripts/lexical -p 'test_*.py'
python scripts/lexical/build.py --input-dir /path/to/untracked/source-cache --download
node node_modules/prettier/bin/prettier.cjs --write public/lexical/*.json public/lexical/*.html
python scripts/lexical/verify.py
```

`--download` only downloads missing files from the three public bulk URLs recorded
in `sources.lock.json`. Input byte sizes and SHA256 hashes must match the lock.
The upstream download URLs rotate: if they have changed, the build intentionally
fails rather than silently claiming to reproduce this release. Keep the original
archives outside Git for exact reproduction, and omit `--download` for an entirely
offline rebuild. To test a rebuild without overwriting shipped packs, pass
`--output-dir /path/to/rebuilt/lexical` and compare its manifest and hashes. The
notices in `public/lexical/` are reviewed source documents, not generated files.
The builder copies these notices when using an alternate output directory. The
Prettier step uses the application's existing development dependency and formats
the generated manifest/register/credits; it does not modify dictionary gzip bytes.

JSON is UTF-8 with compact separators and deterministic source order. Gzip uses
compression level 9, empty filename and zero modification time. Byte reproduction
also requires the same Python/zlib compression implementation; this release was
built with the versions recorded in `release.json`. Both compressed and expanded
hashes are recorded there so a future zlib difference can be distinguished from
data changes. The runtime uses compressed hashes from `manifest.json`.

## Normalization and attribution

- JMdict: one entry for each compatible spelling/reading pair, respecting
  `re_restr`, `re_nokanji`, `stagk` and `stagr`; inherited POS and English senses
  with usage qualifiers. IDs retain upstream `ent_seq`. Each pair's kana reading
  is also a lookup headword. Multiple pairs are intentionally separate evidence.
- CC-CEDICT: every dictionary row, both script spellings, numbered pinyin, and
  complete slash-separated glosses. IDs hash the original row without its newline.
- Vietnamese Wiktionary: each page/POS source record retains its own senses.
  Supplied canonical ruby and pronunciation labels are retained; inflections,
  `form_of` targets and synonyms are not treated as equivalent lookup spellings.
  IDs are original page URLs plus language and raw-record hash; the generated
  `viwiktionary-credits.html` links all original pages for author attribution.

All four derived datasets are released under CC BY-SA 4.0. Source URLs, primary
licence evidence, notices, changes and manual update policy are distributed in
the manifest and three source notices. These data licences do not relicense
unrelated application code. Preserve the notices and Wiktionary page credits when
redistributing packs. Display source attribution alongside dictionary evidence.

## Updates

Review upstream licence terms, format changes and extraction limitations. Obtain
new bulk files, update their observed versions/hashes/bytes in `sources.lock.json`,
increment the normalization revision when semantics change, and choose new output
versions. Run the focused tests before rebuilding; run the integrity verifier and
application/browser checks after. Record output metadata in `release.json`.
Publish new immutable filenames and the updated manifest together. Never overwrite
an already published version with different bytes. EDRDG licence section 4 requires
regular updates from the latest JMdict data and gives at least monthly updates
for WWW dictionary servers. The deployment maintainer must perform this procedure
at least monthly for JMdict, next by **2026-10-05** for this release. Update the
deadline in the source policy and release register each time. No fixed cadence
was identified for CC-CEDICT or Wiktionary. Do not commit raw archives or `__pycache__`.
