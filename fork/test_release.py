"""Offline release guard tests; no publication or network calls."""
import os
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build
import publish


class ReleaseTests(unittest.TestCase):
    def test_tag_must_match_exact_reviewed_version(self):
        reviewed = 'v' + build.SPEC['version']
        upstream = build.SPEC['upstream_tag']
        build.validate_tag(reviewed)
        for tag in (upstream, 'latest', upstream + '-ricky.0', upstream + '-ricky.01',
                    'v0.0.0-ricky.1', reviewed + '/extra', reviewed + '\n'):
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                build.validate_tag(tag)

    def test_repository_event_and_ref_guards_precede_publication(self):
        base = {'GITHUB_REF_NAME': 'v' + build.SPEC['version'], 'GITHUB_REPOSITORY': 'Ricky-Hao/opencode',
                'GITHUB_REF_TYPE': 'tag', 'GITHUB_EVENT_NAME': 'push'}
        for override in ({'GITHUB_REPOSITORY': 'anomalyco/opencode'},
                         {'GITHUB_REF_TYPE': 'branch'}, {'GITHUB_EVENT_NAME': 'pull_request'}):
            with patch.dict(os.environ, {**base, **override}, clear=True), \
                    patch.object(publish.subprocess, 'run') as run, \
                    patch.object(publish, 'git') as git, self.assertRaises(ValueError):
                publish.main()
            run.assert_not_called()
            git.assert_not_called()

    def test_release_creation_requires_explicit_absence_and_valid_hashes(self):
        with tempfile.TemporaryDirectory(dir=os.environ['TEST_TMP_ROOT']) as temp:
            assets = Path(temp)
            tag = 'v' + build.SPEC['version']
            name = build.SPEC['target'] + '-' + tag + '.tar.gz'
            (assets / name).write_bytes(b'offline artifact fixture')
            meta = dict(build.SPEC, source_commit='1' * 40, source_tag=tag, source_dirty=False)
            (assets / 'metadata.json').write_text(json.dumps(meta))
            (assets / 'SHA256SUMS').write_text(''.join(
                f'{build.sha(assets / p)}  {p}\n' for p in (name, 'metadata.json')))
            env = {'GITHUB_REF_NAME': tag, 'GITHUB_REPOSITORY': 'Ricky-Hao/opencode',
                   'GITHUB_REF_TYPE': 'tag', 'GITHUB_EVENT_NAME': 'push', 'GITHUB_SHA': '1' * 40}
            with patch.dict(os.environ, env, clear=True), patch.object(publish, 'git', return_value='1' * 40), \
                    patch.object(sys, 'argv', ['publish.py', temp]):
                for override in ({'source_dirty': True}, {'source_tag': None}, {'upstream_commit': '0' * 40}):
                    (assets / 'metadata.json').write_text(json.dumps({**meta, **override}))
                    with patch.object(publish.subprocess, 'run') as run, self.assertRaises(ValueError):
                        publish.main()
                    run.assert_not_called()
                (assets / 'metadata.json').write_text(json.dumps(meta))
                for code, status in ((0, 'HTTP/2.0 200 OK'), (1, 'HTTP/2.0 500 Error'), (1, '')):
                    with patch.object(publish.subprocess, 'run', return_value=subprocess.CompletedProcess([], code, status)) as run:
                        with self.assertRaises(ValueError):
                            publish.main()
                        self.assertEqual(run.call_count, 1)  # Never creates/overwrites a release.
                with patch.object(publish.subprocess, 'run', side_effect=[
                        subprocess.CompletedProcess([], 1, 'HTTP/2.0 404 Not Found'),
                        subprocess.CompletedProcess([], 0)]) as run:
                    publish.main()
                    command = run.call_args_list[1].args[0]
                    self.assertEqual(command[:4], ['gh', 'release', 'create', tag])
                    self.assertIn('--verify-tag', command)
                    self.assertIn('--prerelease', command)
                    self.assertIn('--latest=false', command)
                    self.assertNotIn('--clobber', command)
                (assets / name).write_bytes(b'corrupt fixture')
                with patch.object(publish.subprocess, 'run') as run, self.assertRaises(ValueError):
                    publish.main()
                run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
