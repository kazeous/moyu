"""Build pinned lexical releases without network access unless --download is set."""

import argparse
import gzip
import hashlib
import html
import io
import json
import platform
import shutil
from pathlib import Path
import urllib.request
import zlib

import normalize

HERE = Path(__file__).resolve().parent
LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/4.0/'
UPDATE_POLICY = ('Review upstream license and extraction changes before each manual rebuild. '
                 'Pin source bytes and SHA256 in sources.lock.json, run normalization and integrity tests, '
                 'publish a new immutable filename and manifest version; retain attribution and share-alike. '
                 'No automatic upstream fetch in the application.')
JMDICT_UPDATE_POLICY = ('EDRDG licence section 4 requires regular updates from the latest available data. '
                       'The deployment maintainer must review and rebuild JMdict at least monthly, '
                       'starting no later than 2026-10-05 for this release; run source/license review, '
                       'pin new hashes, run tests, publish an immutable pack and updated manifest. ')


def validate_entries(entries):
    if not entries:
        raise ValueError('Pack must contain entries')
    identifiers = set()
    for item in entries:
        if not isinstance(item, dict) or set(item) != {'id', 'headwords', 'readings', 'partsOfSpeech', 'senses'}:
            raise ValueError('Malformed entry fields')
        identifier = item['id']
        if not isinstance(identifier, str) or not identifier or identifier in identifiers:
            raise ValueError('Empty or duplicate entry id')
        identifiers.add(identifier)
        for key in ('headwords', 'readings', 'partsOfSpeech'):
            values = item[key]
            if not isinstance(values, list) or any(not isinstance(v, str) or not v.strip() for v in values):
                raise ValueError(f'Malformed {key}')
        if not item['headwords'] or not isinstance(item['senses'], list):
            raise ValueError('Missing headword or malformed senses')
        for sense in item['senses']:
            if (not isinstance(sense, dict) or set(sense) != {'language', 'text'} or
                    sense['language'] not in ('en', 'vi') or
                    not isinstance(sense['text'], str) or not sense['text'].strip()):
                raise ValueError('Malformed sense')


def write_pack(directory, source_id, version, entries):
    validate_entries(entries)
    data = json.dumps({'version': 1, 'sourceId': source_id, 'entries': entries},
                      ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    output = io.BytesIO()
    # Explicit filename and mtime also avoid platform-dependent gzip headers.
    with gzip.GzipFile(fileobj=output, mode='wb', filename='', mtime=0, compresslevel=9) as compressed:
        compressed.write(data)
    content = output.getvalue()
    filename = f'{source_id}-{version}.json.gz'
    directory.mkdir(parents=True, exist_ok=True)
    (directory / filename).write_bytes(content)
    return {'url': f'/lexical/{filename}', 'bytes': len(content),
            'sha256': hashlib.sha256(content).hexdigest(), 'entryCount': len(entries)}


def verify_file(path, size, sha256):
    data = path.read_bytes()
    if len(data) != size or hashlib.sha256(data).hexdigest() != sha256:
        raise ValueError(f'Source/pack integrity failure: {path.name}')


def write_credits(directory, entries):
    pages = sorted({item['id'].split('#')[0] for item in entries})
    links = '\n'.join(f'<li><a href="{html.escape(url)}">{html.escape(urllib.parse.unquote(url.rsplit("/", 1)[1]))}</a></li>' for url in pages)
    content = ('<!doctype html><html lang="en"><meta charset="utf-8">'
               '<title>Vietnamese Wiktionary contributors</title>'
               '<h1>Vietnamese Wiktionary contributors</h1><p>These dictionary pages and their '
               'revision histories credit the authors of the extracted text. Derived packs are '
               '<a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>. '
               'Extraction by Kaikki/Wiktextract; normalization by moyu. '
               'See <a href="viwiktionary-notice.txt">the source notice</a>.</p><ul>') + links + '</ul></html>\n'
    (directory / 'viwiktionary-credits.html').write_text(content, encoding='utf-8', newline='\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-dir', type=Path, required=True, help='Local, untracked bulk-source archive directory')
    parser.add_argument('--output-dir', type=Path, default=HERE.parents[1] / 'public' / 'lexical')
    parser.add_argument('--download', action='store_true', help='Download the three public files; require pinned digests')
    args = parser.parse_args()
    lock = json.loads((HERE / 'sources.lock.json').read_text(encoding='utf-8'))
    for source in lock['inputs']:
        path = args.input_dir / source['file']
        if args.download and not path.exists():
            args.input_dir.mkdir(parents=True, exist_ok=True)
            with urllib.request.urlopen(source['url'], timeout=120) as response:
                path.write_bytes(response.read())
        verify_file(path, source['bytes'], source['sha256'])

    args.output_dir.mkdir(parents=True, exist_ok=True)
    reviewed_notices = HERE.parents[1] / 'public' / 'lexical'
    for notice in {source['noticeUrl'].split('/')[-1] for source in lock['outputs']}:
        source_path, destination = reviewed_notices / notice, args.output_dir / notice
        if source_path.resolve() != destination.resolve():
            shutil.copyfile(source_path, destination)

    sources = []
    for source in lock['outputs']:
        source_id = source['id']
        if source_id == 'jmdict-en':
            with gzip.open(args.input_dir / 'jmdict.xml.gz', 'rb') as stream:
                entries = list(normalize.jmdict(stream))
        elif source_id == 'cedict-en':
            with gzip.open(args.input_dir / 'cedict.txt.gz', 'rt', encoding='utf-8') as stream:
                entries = list(normalize.cedict(stream))
        else:
            entries = []
            with gzip.open(args.input_dir / 'vi.jsonl.gz', 'rt', encoding='utf-8') as stream:
                for line in stream:
                    entries.extend(normalize.wiktionary(json.loads(line), source['language']))
        # Identical source rows represent the same evidence, with identical source-linked IDs.
        entries = list({item['id']: item for item in entries}.values())
        for item in entries:
            if any(sense['language'] not in source['glossLanguages'] for sense in item['senses']):
                raise ValueError('Unexpected gloss language')
        info = write_pack(args.output_dir, source_id, source['version'], entries)
        if source_id.startswith('viwiktionary'):
            # Accumulate both source languages for author/page attribution.
            if source['language'] == 'ja':
                wiki_entries = entries
            else:
                write_credits(args.output_dir, wiki_entries + entries)
        policy = (JMDICT_UPDATE_POLICY if source_id == 'jmdict-en' else
                  'No licence-imposed update cadence identified. ') + UPDATE_POLICY
        sources.append({**source, 'license': 'CC BY-SA 4.0', 'licenseUrl': LICENSE_URL,
                        'updatePolicy': policy, **info})
        print(f'{source_id}: {info["entryCount"]} entries, {info["bytes"]} bytes, SHA256 {info["sha256"]}')
    (args.output_dir / 'manifest.json').write_text(json.dumps({'version': 1, 'sources': sources},
                                                           ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    from verify import verify_directory
    release = {'version': 1, 'builtAt': lock['retrievedAt'],
               'python': platform.python_version(), 'zlib': zlib.ZLIB_RUNTIME_VERSION,
               'normalizationRevision': lock['normalizationRevision'],
               'jmdictNextUpdateDue': '2026-10-05', 'inputs': lock['inputs'],
               'sources': verify_directory(args.output_dir)}
    # Attribution notices are required when verifying a complete release.
    (args.output_dir / 'release.json').write_text(json.dumps(release, ensure_ascii=False, indent=2) + '\n',
                                                 encoding='utf-8', newline='\n')


if __name__ == '__main__':
    main()
