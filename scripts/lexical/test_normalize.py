import io
import unittest

import normalize


class NormalizeTests(unittest.TestCase):
    def test_jmdict_keeps_reading_and_sense_restrictions(self):
        xml = '''<JMdict><entry><ent_seq>42</ent_seq>
        <k_ele><keb>甲</keb></k_ele><k_ele><keb>乙</keb></k_ele>
        <r_ele><reb>こう</reb><re_restr>甲</re_restr></r_ele>
        <r_ele><reb>おつ</reb><re_restr>乙</re_restr></r_ele>
        <r_ele><reb>かな</reb><re_nokanji/></r_ele>
        <sense><pos>noun</pos><gloss>shared</gloss></sense>
        <sense><stagk>乙</stagk><stagr>おつ</stagr><gloss>restricted</gloss></sense>
        </entry></JMdict>'''
        entries = list(normalize.jmdict(io.BytesIO(xml.encode())))
        self.assertEqual(len(entries), 3)
        first, second, kana = entries
        self.assertEqual(first['headwords'], ['甲', 'こう'])
        self.assertEqual(first['readings'], ['こう'])
        self.assertEqual([s['text'] for s in first['senses']], ['shared'])
        self.assertEqual([s['text'] for s in second['senses']], ['shared', 'restricted'])
        self.assertEqual(second['partsOfSpeech'], ['noun'])
        self.assertEqual(kana['headwords'], ['かな'])
        self.assertEqual(first['id'], 'jmdict:42:1')

    def test_jmdict_preserves_qualifiers_and_english_only(self):
        xml = '''<!DOCTYPE JMdict [<!ENTITY n "noun">]><JMdict><entry>
        <ent_seq>9</ent_seq><r_ele><reb>あ</reb></r_ele>
        <sense><pos>&n;</pos><misc>archaic</misc><s_inf>in poetry</s_inf>
        <gloss>ah</gloss><gloss xml:lang="ger">ach</gloss></sense>
        </entry></JMdict>'''
        entries = list(normalize.jmdict(io.BytesIO(xml.encode())))
        self.assertEqual(len(entries), 1)
        entry = entries[0]
        self.assertEqual(entry['senses'], [{'language': 'en', 'text': '(archaic; in poetry) ah'}])
        self.assertEqual(entry['partsOfSpeech'], ['noun'])

    def test_cedict_keeps_spellings_reading_and_literal_qualifiers(self):
        entries = list(normalize.cedict(io.StringIO('# comment\n學 学 [xue2] /to study/(bound form) learning/\n')))
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]['headwords'], ['學', '学'])
        self.assertEqual(entries[0]['readings'], ['xue2'])
        self.assertEqual(entries[0]['partsOfSpeech'], [])
        self.assertEqual(entries[0]['senses'][1]['text'], '(bound form) learning')
        self.assertEqual(entries, list(normalize.cedict(io.StringIO('學 学 [xue2] /to study/(bound form) learning/\n'))))

    def test_cedict_rejects_malformed_noncomment_line(self):
        with self.assertRaisesRegex(ValueError, 'CC-CEDICT'):
            list(normalize.cedict(io.StringIO('broken entry\n')))

    def test_wiktionary_preserves_page_language_qualifiers_and_sourced_readings(self):
        record = {'word': '字典', 'lang_code': 'ja', 'pos': 'noun',
                  'forms': [{'form': '字典', 'tags': ['canonical'], 'ruby': [['字', 'じ'], ['典', 'てん']]},
                            {'form': 'unrelated', 'tags': ['plural']}],
                  'senses': [{'glosses': ['từ điển'], 'tags': ['rare'], 'raw_tags': ['cổ']}],
                  'sounds': [{'ipa': '[dʑiteɴ]'}]}
        entries = normalize.wiktionary(record, 'ja')
        self.assertEqual(len(entries), 1)
        entry = entries[0]
        self.assertEqual(entry['headwords'], ['字典'])
        self.assertEqual(entry['readings'], ['じてん', 'IPA: [dʑiteɴ]'])
        self.assertEqual(entry['senses'], [{'language': 'vi', 'text': '(rare; cổ) từ điển'}])
        self.assertTrue(entry['id'].startswith('https://vi.wiktionary.org/wiki/%E5%AD%97%E5%85%B8#ja:'))
        self.assertEqual(normalize.wiktionary(record, 'zh'), [])

    def test_wiktionary_does_not_invent_missing_gloss_or_pos(self):
        record = {'word': '词典', 'lang_code': 'zh', 'pos': 'unknown', 'senses': [{'tags': ['no-gloss']}]}
        entries = normalize.wiktionary(record, 'zh')
        self.assertEqual(len(entries), 1)
        entry = entries[0]
        self.assertEqual(entry['senses'], [])
        self.assertEqual(entry['readings'], [])
        self.assertEqual(entry['partsOfSpeech'], [])

    def test_wiktionary_retains_pronunciation_variety_labels(self):
        record = {'word': '學', 'lang_code': 'zh', 'pos': 'noun', 'senses': [],
                  'sounds': [{'zh_pron': 'xué', 'tags': ['Mandarin', 'Pinyin']},
                             {'zh_pron': 'hok6', 'tags': ['Cantonese', 'Jyutping']}]}
        entries = normalize.wiktionary(record, 'zh')
        self.assertEqual(len(entries), 1)
        entry = entries[0]
        self.assertEqual(entry['readings'], ['Mandarin, Pinyin: xué', 'Cantonese, Jyutping: hok6'])

    def test_wiktionary_rejects_bad_relevant_record(self):
        with self.assertRaises(ValueError):
            normalize.wiktionary({'word': 12, 'lang_code': 'ja'}, 'ja')

    def test_wiktionary_ruby_keeps_unannotated_kana(self):
        record = {'word': '食べる', 'lang_code': 'ja', 'pos': 'verb', 'senses': [],
                  'forms': [{'form': '食べる', 'tags': ['canonical'], 'ruby': [['食', 'た']]}]}
        self.assertEqual(normalize.wiktionary(record, 'ja')[0]['readings'], ['たべる'])


if __name__ == '__main__':
    unittest.main()
