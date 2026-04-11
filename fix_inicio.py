import re

with open('js/inicio.js', 'r', encoding='utf-8') as f:
    c = f.read()

# Replace chr(39) + o.id + chr(39) -> "'" + o.id + "'"
c = re.sub(r"chr\(39\)\s*\+\s*o\.id\s*\+\s*chr\(39\)", '"\'\" + o.id + \"\'\"', c)

# Replace chr(39) + ORDER_STATUS.X + chr(39) -> "'" + ORDER_STATUS.X + "'"
c = re.sub(r"chr\(39\)\s*\+\s*(ORDER_STATUS\.\w+)\s*\+\s*chr\(39\)", lambda m: '"\'\" + ' + m.group(1) + ' + \"\'\"', c)

with open('js/inicio.js', 'w', encoding='utf-8') as f:
    f.write(c)

remaining = c.count('chr(39)')
print(f'Done. chr(39) remaining: {remaining}')
print(f'Total lines: {len(c.splitlines())}')
