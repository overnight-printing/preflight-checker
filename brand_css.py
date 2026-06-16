import re

with open('src/App.css', 'r') as f:
    css = f.read()

css = css.replace('rgba(168, 85, 247, 0.08)', 'rgba(40, 51, 119, 0.15)')
css = css.replace('rgba(20, 184, 166, 0.08)', 'rgba(137, 197, 232, 0.15)')
css = css.replace('rgba(168, 85, 247, 0.2)', 'rgba(40, 51, 119, 0.3)')
css = css.replace('rgba(168, 85, 247, 0.05)', 'rgba(40, 51, 119, 0.1)')
css = css.replace('rgba(168, 85, 247, 0.03)', 'rgba(40, 51, 119, 0.05)')

with open('src/App.css', 'w') as f:
    f.write(css)

