import os
import re

# 1. Update index.css
with open('src/index.css', 'r') as f:
    css = f.read()

# Dark / Default theme replacements
css = re.sub(r'--primary: #[a-f0-9]+;', '--primary: #283377;', css)
css = re.sub(r'--primary-hover: #[a-f0-9]+;', '--primary-hover: #3a4699;', css)
css = re.sub(r'--primary-glow: rgba\([^)]+\);', '--primary-glow: rgba(40, 51, 119, 0.3);', css)

css = re.sub(r'--accent: #[a-f0-9]+;', '--accent: #89c5e8;', css)
css = re.sub(r'--accent-glow: rgba\([^)]+\);', '--accent-glow: rgba(137, 197, 232, 0.2);', css)

with open('src/index.css', 'w') as f:
    f.write(css)

# 2. Update index.html
with open('index.html', 'r') as f:
    html = f.read()

html = re.sub(r'<link rel="icon".*?>', '<link rel="icon" type="image/png" href="/logo.png" />', html)
html = re.sub(r'<title>.*?</title>', '<title>Overnight Printing Seattle - Preflight Checker</title>', html)
html = re.sub(r'<meta name="description" content="[^"]+" />', '<meta name="description" content="Preflight Checker and Union Bug auto-placement tool for print artwork." />', html)

with open('index.html', 'w') as f:
    f.write(html)

# 3. Update App.jsx
with open('src/App.jsx', 'r') as f:
    app = f.read()

app = app.replace('<Shield size={28} className="logo-icon" />', '<img src="/logo.png" alt="Logo" style={{ height: \'32px\' }} className="logo-icon" />')
app = app.replace('<h1>Overnight Preflight</h1>', '<h1>Overnight Printing</h1>')

with open('src/App.jsx', 'w') as f:
    f.write(app)

