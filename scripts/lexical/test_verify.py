import json
from pathlib import Path
import tempfile
import unittest

import build
import verify


class VerifyTests(unittest.TestCase):
    def test_released_packs_match_their_manifest_and_notices(self):
        directory = Path(__file__).resolve().parents[2] / 'public' / 'lexical'
        result = verify.verify_directory(directory)
        self.assertIsInstance(result, list)
        self.assertEqual(len(result), 4)
        self.assertEqual({(r['language'], tuple(r['glossLanguages'])) for r in result},
                         {('ja', ('en',)), ('zh', ('en',)), ('ja', ('vi',)), ('zh', ('vi',))})
        release = json.loads((directory / 'release.json').read_text(encoding='utf-8'))
        self.assertEqual(release['sources'], result)

    def test_rejects_manifest_language_mismatch_even_with_correct_hash(self):
        with tempfile.TemporaryDirectory() as name:
            directory = Path(name)
            info = build.write_pack(directory, 'test', 'v1', [{'id': 'x', 'headwords': ['猫'],
                'readings': [], 'partsOfSpeech': [], 'senses': [{'language': 'en', 'text': 'cat'}]}])
            notice = directory / 'notice.txt'
            notice.write_text('credits', encoding='utf-8')
            source = {key: 'test' for key in verify.SOURCE_FIELDS}
            source.update(info, id='test', language='ja', glossLanguages=['vi'], noticeUrl='/lexical/notice.txt')
            (directory / 'manifest.json').write_text(json.dumps({'version': 1, 'sources': [source]}), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'language'):
                verify.verify_directory(directory)


if __name__ == '__main__':
    unittest.main()
