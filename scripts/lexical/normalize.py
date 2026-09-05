"""Offline normalizers for published dictionary dumps; Python 3.12+ stdlib only."""

import hashlib
import json
import re
import xml.etree.ElementTree as ET
from urllib.parse import quote


def unique(values):
    return list(dict.fromkeys(values))


def strings(value):
    if not isinstance(value, list) or any(not isinstance(x, str) for x in value):
        raise ValueError('Expected a list of strings')
    return [x for x in value if x.strip()]


def qualified(text, labels):
    return ('(' + '; '.join(unique(labels)) + ') ' if labels else '') + text


def entry(identifier, headwords, readings, pos, senses):
    return {'id': identifier, 'headwords': unique(headwords), 'readings': unique(readings),
            'partsOfSpeech': unique(pos), 'senses': senses}


def texts(element, path):
    return [node.text for node in element.findall(path) if node.text]


def jmdict(stream):
    # ElementTree resolves this published file's internal DTD entities but does
    # not fetch external entities. iterparse avoids keeping the XML tree alive.
    for _, node in ET.iterparse(stream, events=('end',)):
        if node.tag != 'entry':
            continue
        sequence = node.findtext('ent_seq')
        if not sequence or not sequence.isdigit():
            raise ValueError('JMdict entry has no numeric ent_seq')
        forms = {k.findtext('keb'): texts(k, 'ke_inf') for k in node.findall('k_ele')}
        senses = []
        inherited_pos = []
        for sense in node.findall('sense'):
            inherited_pos = texts(sense, 'pos') or inherited_pos
            senses.append((sense, inherited_pos))
        ordinal = 0
        for reading_node in node.findall('r_ele'):
            reading = reading_node.findtext('reb')
            if not reading:
                raise ValueError('JMdict reading is missing')
            compatible = texts(reading_node, 're_restr') or list(forms)
            if reading_node.find('re_nokanji') is not None or not forms:
                compatible = [None]
            for form in compatible:
                if form is not None and form not in forms:
                    raise ValueError('JMdict reading references a missing spelling')
                glosses, parts = [], []
                for sense, pos in senses:
                    only_forms, only_readings = texts(sense, 'stagk'), texts(sense, 'stagr')
                    if only_forms and form not in only_forms:
                        continue
                    if only_readings and reading not in only_readings:
                        continue
                    labels = (forms.get(form, []) + texts(reading_node, 're_inf') +
                              texts(sense, 'field') + texts(sense, 'misc') +
                              texts(sense, 'dial') + texts(sense, 's_inf'))
                    english = [g for g in sense.findall('gloss')
                               if g.get('{http://www.w3.org/XML/1998/namespace}lang', 'eng') == 'eng']
                    for gloss in english:
                        if gloss.text:
                            qualifier = labels + ([gloss.get('g_type')] if gloss.get('g_type') else [])
                            glosses.append({'language': 'en', 'text': qualified(gloss.text, qualifier)})
                    if english:
                        parts.extend(pos)
                ordinal += 1
                yield entry(f'jmdict:{sequence}:{ordinal}', [form, reading] if form else [reading],
                            [reading], parts, glosses)
        node.clear()


def cedict(stream):
    for number, raw in enumerate(stream, 1):
        line = raw.rstrip('\r\n')
        if not line.strip() or line.startswith('#'):
            continue
        match = re.fullmatch(r'(\S+) (\S+) \[([^\]]+)\] /(.+)/', line)
        if not match:
            raise ValueError(f'Malformed CC-CEDICT line {number}')
        traditional, simplified, reading, glosses = match.groups()
        identifier = 'cedict:' + hashlib.sha256(line.encode('utf-8')).hexdigest()
        yield entry(identifier, [traditional, simplified], [reading], [],
                    [{'language': 'en', 'text': gloss} for gloss in glosses.split('/') if gloss])


def wiktionary(record, language):
    if not isinstance(record, dict):
        raise ValueError('Wiktionary record must be an object')
    code = record.get('lang_code')
    if code not in ({'ja'} if language == 'ja' else {'zh', 'cmn'}):
        return []
    word = record.get('word')
    if not isinstance(word, str) or not word.strip():
        raise ValueError('Wiktionary word must be a nonempty string')
    pos = record.get('pos')
    if not isinstance(pos, str):
        raise ValueError('Wiktionary part of speech must be a string')
    glosses, readings = [], []
    for sense in record.get('senses', []):
        labels = strings(sense.get('tags', [])) + strings(sense.get('raw_tags', []))
        for gloss in strings(sense.get('glosses', [])):
            glosses.append({'language': 'vi', 'text': qualified(gloss, labels)})
    # Inflections, synonyms and form_of targets are not alternate headwords:
    # their definitions/readings need not apply to the page's canonical word.
    for form in record.get('forms', []):
        if form.get('form') == word and 'canonical' in form.get('tags', []) and form.get('ruby'):
            pairs = form['ruby']
            if all(isinstance(p, list) and len(p) == 2 and all(isinstance(x, str) for x in p) for p in pairs):
                cursor, pieces = 0, []
                for spelling, reading in pairs:
                    offset = word.find(spelling, cursor)
                    if offset < 0 or not spelling:
                        raise ValueError('Wiktionary ruby does not match its canonical form')
                    pieces.extend([word[cursor:offset], reading])
                    cursor = offset + len(spelling)
                readings.append(''.join(pieces) + word[cursor:])
            else:
                raise ValueError('Malformed Wiktionary ruby reading')
    for sound in record.get('sounds', []):
        labels = strings(sound.get('tags', [])) + strings(sound.get('raw_tags', []))
        # Keep variety labels, avoiding false identification of Cantonese as Mandarin.
        for field in ('other', 'zh_pron', 'ipa'):
            value = sound.get(field)
            if value is not None:
                if not isinstance(value, str):
                    raise ValueError('Wiktionary pronunciation must be a string')
                label = (['IPA'] if field == 'ipa' else []) + labels
                readings.append((', '.join(label) + ': ' if label else '') + value)
    digest = hashlib.sha256(json.dumps(record, ensure_ascii=False, sort_keys=True,
                                      separators=(',', ':')).encode('utf-8')).hexdigest()
    identifier = f'https://vi.wiktionary.org/wiki/{quote(word, safe="")}#{code}:{digest}'
    return [entry(identifier, [word], readings, [] if pos == 'unknown' else [pos], glosses)]
