"""Verify release integrity, English launchers, permissions and source/artifact parity."""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parent.parent
checks = dict(line.split('  ')[::-1] for line in (root / 'release/SHA256SUMS.txt').read_text().splitlines())
assert len(checks) == 3, 'Expected all three platform archives'
for name, expected in checks.items():
    archive = root / 'release' / name
    digest = hashlib.sha256()
    with archive.open('rb') as f:
        for block in iter(lambda: f.read(1048576), b''):
            digest.update(block)
    assert digest.hexdigest() == expected, name
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None
        names = z.namelist()
        base = name[:-4]
        assert not any('/.runtime/' in n or '/logs/' in n or '/node_modules/' in n for n in names)
        for rel in ['dist-server/game.cjs', 'scripts/launch.mjs', 'scripts/tunnel-controller.mjs', 'scripts/open-host.mjs', 'README.md', 'docs/TEST_RESULTS.md']:
            assert z.read(base + '/' + rel) == (root / rel).read_bytes(), (name, rel)
        for file in (root / 'dist').rglob('*'):
            if file.is_file():
                rel = file.relative_to(root).as_posix()
                assert z.read(base + '/' + rel) == file.read_bytes(), (name, rel)
        assert json.loads(z.read(base + '/VERSION.json'))['node'] == '24.21.0'
        assert json.loads(z.read(base + '/VERSION.json'))['game'] == json.loads((root / 'package.json').read_text())['version']
        launcher = 'start-game.command' if 'macos' in name else 'start-game.cmd'
        assert base + '/' + launcher in names
        assert not any(n.endswith(('/啟動遊戲.command', '/啟動遊戲.cmd')) for n in names)
        if 'macos' in name:
            for rel in ['runtime/node', 'runtime/cloudflared', launcher]:
                assert (z.getinfo(base + '/' + rel).external_attr >> 16) & 0o111
        else:
            cmd = z.read(base + '/' + launcher)
            assert b'\r\n' in cmd and b'\n' not in cmd.replace(b'\r\n', b'')
        print(f'{name}: SHA256, ZIP, source parity and English launcher metadata PASS')
