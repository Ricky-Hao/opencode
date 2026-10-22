#!/usr/bin/env python3
"""Pinned build recipe; no install into the invoking user's toolchain."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[1]
SPEC = json.loads((ROOT / 'fork/release.json').read_text())


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args], text=True).strip()


def validate_tag(tag):
    if not re.fullmatch(r'v\d+\.\d+\.\d+-ricky\.[1-9]\d*', tag) or tag != 'v' + SPEC['version']:
        raise ValueError('tag must exactly match the reviewed fork version')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--node', default='node')
    parser.add_argument('--bun', default='bun')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--tag')
    args = parser.parse_args()
    os.umask(0o077)
    if args.tag:
        validate_tag(args.tag)
        if git('status', '--porcelain') or git('rev-parse', args.tag + '^{commit}') != git('rev-parse', 'HEAD'):
            raise ValueError('release requires a clean checkout of the exact tag')
    assert sha(ROOT / 'bun.lock') == SPEC['lock_sha256'], 'upstream lock changed'
    assert sha(ROOT / 'fork/catalog-readiness.patch') == SPEC['patch_sha256'], 'patch changed'
    node = Path(shutil.which(args.node) or args.node).absolute()
    bun = Path(shutil.which(args.bun) or args.bun).absolute()
    out = args.output.absolute()
    out.mkdir(parents=True, exist_ok=False)
    for name in ('home', 'tmp', 'cache', 'assets'):
        (out / name).mkdir()
    env = {'HOME': str(out / 'home'), 'TMPDIR': str(out / 'tmp'),
           'XDG_CACHE_HOME': str(out / 'cache'), 'BUN_INSTALL_CACHE_DIR': str(out / 'cache/bun'),
           'PATH': f'{bun.parent}:{node.parent}:/usr/bin:/bin', 'LANG': 'C.UTF-8', 'CI': '1',
           'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_NO_LAZY_FETCH': '1',
           'OPENCODE_VERSION': SPEC['version'], 'OPENCODE_CHANNEL': 'ricky'}

    def run(argv, cwd=ROOT, capture=False):
        return subprocess.run([str(a) for a in argv], cwd=cwd, env=env, check=True,
                              text=True, stdout=subprocess.PIPE if capture else None).stdout

    assert run([node, '--version'], capture=True).strip() == 'v' + SPEC['node']
    assert run([bun, '--version'], capture=True).strip() == SPEC['bun']
    run([bun, 'install', '--filter', '@opencode/cli', '--frozen-lockfile', '--ignore-scripts'])
    assert sha(ROOT / 'bun.lock') == SPEC['lock_sha256']
    cli = ROOT / 'packages/cli'
    run([bun, 'test', '--timeout', '30000', './test/acp'], cwd=cli)
    run([bun, 'run', 'script/build.ts', '--target=' + SPEC['target'],
         '--skip-install', '--skip-web-ui', '--outdir=' + str(out / 'compiled')], cwd=cli)
    binary = out / 'compiled/cli-linux-x64-baseline/bin/opencode'
    version = run([binary, '--version'], cwd=out, capture=True).strip()
    assert version == 'opencode v' + SPEC['version'], version
    # Include a digest of the complete non-ignored source, including local uncommitted work.
    paths = git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0')
    source = {p: sha(ROOT / p) for p in sorted(set(paths)) if p and (ROOT / p).is_file()}
    metadata = dict(SPEC, source_commit=git('rev-parse', 'HEAD'), source_tag=args.tag,
                    source_dirty=bool(git('status', '--porcelain')), binary_sha256=sha(binary),
                    source_files_sha256=hashlib.sha256(json.dumps(source, sort_keys=True).encode()).hexdigest())
    assets = out / 'assets'
    (assets / 'metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
    asset = assets / (SPEC['target'] + '-v' + SPEC['version'] + '.tar.gz')
    with tarfile.open(asset, 'w:gz') as archive:
        for path, name in [(binary, 'opencode'), (ROOT / 'LICENSE', 'LICENSE'),
                           (assets / 'metadata.json', 'metadata.json')]:
            info = archive.gettarinfo(str(path), arcname=name)
            info.uid = info.gid = 0
            info.uname = info.gname = ''
            info.mode = 0o755 if name == 'opencode' else 0o644
            info.mtime = int(git('show', '-s', '--format=%ct', 'HEAD'))
            with path.open('rb') as stream:
                archive.addfile(info, stream)
    (assets / 'SHA256SUMS').write_text(''.join(f'{sha(p)}  {p.name}\n' for p in [asset, assets / 'metadata.json']))
    print(version)
    print((assets / 'SHA256SUMS').read_text())


if __name__ == '__main__':
    main()
