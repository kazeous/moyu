import gzip
import json
from pathlib import Path
import tempfile
import unittest

import build


class BuildTests(unittest.TestCase):
    def test_pack_bytes_are_deterministic_and_digest_is_checked(self):
        entries = [{'id': 'test:1', 'headwords': ['猫'], 'readings': [],
                    'partsOfSpeech': [], 'senses': [{'language': 'en', 'text': 'cat'}]}]
        with tempfile.TemporaryDirectory() as directory:
            first = build.write_pack(Path(directory), 'test', 'release', entries)
            self.assertIsInstance(first, dict)
            path = Path(directory) / first['url'].split('/')[-1]
            original = path.read_bytes()
            self.assertEqual(first, build.write_pack(Path(directory), 'test', 'release', entries))
            self.assertEqual(original, path.read_bytes())
            self.assertEqual(json.loads(gzip.decompress(original))['entries'], entries)
            self.assertEqual(first['entryCount'], 1)
            self.assertEqual(first['bytes'], len(original))
            build.verify_file(path, first['bytes'], first['sha256'])
            path.write_bytes(original + b'corrupt')
            with self.assertRaisesRegex(ValueError, 'integrity'):
                build.verify_file(path, first['bytes'], first['sha256'])

    def test_pack_rejects_duplicate_ids_and_malformed_entries(self):
        good = {'id': 'x', 'headwords': ['猫'], 'readings': [], 'partsOfSpeech': [], 'senses': []}
        with tempfile.TemporaryDirectory() as directory:
            for entries in ([good, good], [{**good, 'headwords': []}], [{**good, 'readings': [5]}]):
                with self.assertRaises(ValueError):
                    build.write_pack(Path(directory), 'test', 'v', entries)


if __name__ == '__main__':
    unittest.main()
