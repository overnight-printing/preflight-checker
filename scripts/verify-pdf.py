"""Inspect browser regression exports with Poppler; renders still require visual review."""
import json
import os
from pathlib import Path
import re
import subprocess

output = Path(os.environ.get('PREFLIGHT_AUDIT_OUTPUT', 'output/audit')).resolve()
expected = {
    'stamp-knockout-0': ((252, 144), (0, 0, 252, 144), 0),
    'stamp-knockout-9': ((270, 162), (9, 9, 261, 153), 0),
    'layers-bleed': ((270, 162), (9, 9, 261, 153), 0),
    'layers-inset': ((246, 138), (0, 0, 246, 138), 0),
    'ui-layers': ((270, 162), (9, 9, 261, 153), 0),
    'card-bleed': ((270, 162), (9, 9, 261, 153), 0),
    'card-inset': ((246, 138), (0, 0, 246, 138), 0),
    'card-empty-selection': ((252, 144), (0, 0, 252, 144), 0),
    'judge-bleed': ((396, 684), (18, 18, 378, 666), 0),
    'rotated-plain': ((252, 144), (19, 29, 253, 155), 90),
    'rotated-bleed': ((270, 162), (18, 18, 252, 144), 90),
    'rotated-crop': ((234, 126), (0, 0, 234, 126), 90),
    'ui-card-production': ((270, 162), (9, 9, 261, 153), 0),
}
summary = {}
for name, (size, trim, rotation) in expected.items():
    pdf = output / f'{name}.pdf'
    info = subprocess.check_output(['pdfinfo', '-box', str(pdf)], text=True)
    images = subprocess.check_output(['pdfimages', '-list', str(pdf)], text=True)
    actual_size = tuple(map(float, re.search(r'Page size:\s+([\d.]+) x ([\d.]+)', info).groups()))
    actual_trim = tuple(map(float, re.search(r'TrimBox:\s+([^\n]+)', info).group(1).split()))
    actual_rotation = int(re.search(r'Page rot:\s+(\d+)', info).group(1))
    assert actual_size == size, (name, actual_size, size)
    assert actual_trim == trim, (name, actual_trim, trim)
    assert actual_rotation == rotation, (name, actual_rotation, rotation)
    assert len(images.splitlines()) == 2, f'{name}: vector export acquired raster images'
    (output / f'{name}-verification.txt').write_text(info + '\n' + images)
    summary[name] = {'bytes': pdf.stat().st_size, 'size': size, 'trim': trim, 'rotation': rotation, 'images': 0}

for name in [*expected, 'rotated-proof', 'ui-image-proof', 'ui-multi', 'layers-proof']:
    pdf = output / f'{name}.pdf'
    subprocess.run(['pdftoppm', '-scale-to', '1100', '-png', str(pdf), str(output / name)], check=True, capture_output=True)
    if name not in expected:
        info = subprocess.check_output(['pdfinfo', '-box', str(pdf)], text=True)
        images = subprocess.check_output(['pdfimages', '-list', str(pdf)], text=True)
        (output / f'{name}-verification.txt').write_text(info + '\n' + images)
(output / 'pdf-verification.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps(summary, indent=2))
print('Box and image-resource checks passed. Review rendered PNGs before accepting visual fidelity.')
