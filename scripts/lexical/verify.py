"""Verify every shipped pack's contract, compressed integrity and attribution."""

import argparse
import gzip
import hashlib
import json
from pathlib import Path

from build import validate_entries, verify_file


SOURCE_FIELDS = {'id', 'name', 'language', 'glossLanguages', 'version', 'sourceUrl',
                 'license', 'licenseUrl', 'attribution', 'noticeUrl', 'updatePolicy',
                 'changes', 'url', 'bytes', 'sha256', 'entryCount'}


def verify_directory(directory):
    manifest = json.loads((directory / 'manifest.json').read_text(encoding='utf-8'))
    if set(manifest) != {'version', 'sources'} or manifest['version'] != 1:
        raise ValueError('Invalid manifest')
    summaries, identifiers = [], set()
    for source in manifest['sources']:
        if set(source) != SOURCE_FIELDS:
            raise ValueError('Unexpected source fields')
        for key in SOURCE_FIELDS - {'bytes', 'entryCount', 'glossLanguages'}:
            if not isinstance(source[key], str) or not source[key].strip():
                raise ValueError(f'Invalid source {key}')
        if source['language'] not in ('ja', 'zh') or source['glossLanguages'] not in (['en'], ['vi']):
            raise ValueError('Invalid source language')
        for key in ('bytes', 'entryCount'):
            if type(source[key]) is not int or source[key] <= 0:
                raise ValueError(f'Invalid {key}')
        if source['id'] in identifiers:
            raise ValueError('Duplicate source id')
        identifiers.add(source['id'])
        paths = []
        for key in ('url', 'noticeUrl'):
            url = source[key]
            if not url.startswith('/lexical/') or '/' in url[len('/lexical/'):] or '\\' in url or '..' in url:
                raise ValueError('Invalid local asset URL')
            path = directory / url.split('/')[-1]
            if not path.is_file():
                raise ValueError(f'Missing asset {path.name}')
            paths.append(path)
        pack_path, _ = paths
        verify_file(pack_path, source['bytes'], source['sha256'])
        expanded = gzip.decompress(pack_path.read_bytes())
        pack = json.loads(expanded)
        if (set(pack) != {'version', 'sourceId', 'entries'} or pack['version'] != 1 or
                pack['sourceId'] != source['id']):
            raise ValueError('Invalid pack identity')
        validate_entries(pack['entries'])
        if len(pack['entries']) != source['entryCount']:
            raise ValueError('Incorrect entry count')
        for entry in pack['entries']:
            if any(sense['language'] not in source['glossLanguages'] for sense in entry['senses']):
                raise ValueError('Unexpected gloss language')
        summaries.append({**source, 'expandedBytes': len(expanded),
                          'expandedSha256': hashlib.sha256(expanded).hexdigest(),
                          'entriesWithoutSenses': sum(not e['senses'] for e in pack['entries']),
                          'entriesWithoutReadings': sum(not e['readings'] for e in pack['entries'])})
    return summaries


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path,
                        default=Path(__file__).resolve().parents[2] / 'public' / 'lexical')
    args = parser.parse_args()
    for summary in verify_directory(args.directory):
        print(f'{summary["id"]}: verified {summary["entryCount"]} entries; '
              f'{summary["bytes"]} compressed / {summary["expandedBytes"]} expanded bytes; '
              f'{summary["entriesWithoutSenses"]} entries without definitions')
