#!/usr/bin/env python3
"""CI-only own-tag publication. Existing releases are never changed."""
import json
import os
from pathlib import Path
import subprocess
import sys
from build import SPEC, git, sha, validate_tag


def main():
    tag = os.environ.get('GITHUB_REF_NAME', '')
    validate_tag(tag)
    if (os.environ.get('GITHUB_REPOSITORY') != 'Ricky-Hao/opencode'
            or os.environ.get('GITHUB_REF_TYPE') != 'tag'
            or os.environ.get('GITHUB_EVENT_NAME') != 'push'):
        raise ValueError('only own repository tag pushes may publish')
    if git('rev-parse', tag + '^{commit}') != os.environ['GITHUB_SHA']:
        raise ValueError('tag commit mismatch')
    assets = Path(sys.argv[1])
    meta = json.loads((assets / 'metadata.json').read_text())
    if (meta['source_commit'] != os.environ['GITHUB_SHA'] or meta['source_tag'] != tag
            or meta['source_dirty'] or any(meta[k] != v for k, v in SPEC.items())):
        raise ValueError('artifact provenance mismatch')
    names = [SPEC['target'] + '-' + tag + '.tar.gz', 'metadata.json']
    expected = ''.join(f'{sha(assets / name)}  {name}\n' for name in names)
    if (assets / 'SHA256SUMS').read_text() != expected:
        raise ValueError('artifact checksums mismatch')
    # Require an explicit 404; auth/network errors must not look like absence.
    result = subprocess.run(['gh', 'api', '--include', f'repos/Ricky-Hao/opencode/releases/tags/{tag}'],
                            capture_output=True, text=True)
    if result.returncode == 0 or not result.stdout.startswith('HTTP/2.0 404') and not result.stdout.startswith('HTTP/1.1 404'):
        raise ValueError('release exists or absence could not be verified')
    subprocess.run(['gh', 'release', 'create', tag, '--repo', 'Ricky-Hao/opencode',
                    '--verify-tag', '--title', 'OpenCode ' + tag, '--prerelease', '--latest=false',
                    '--notes', 'Unofficial Linux x64 glibc baseline fork. See fork/README.md and metadata.json.',
                    *[str(assets / n) for n in [*names, 'SHA256SUMS']]], check=True)


if __name__ == '__main__':
    main()
