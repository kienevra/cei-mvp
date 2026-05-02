with open('src/pages/ManageClientOrg.tsx', encoding='utf-8') as f:
    content = f.read()

for i, ch in enumerate(content):
    if ch == '\x8f':
        print(i, repr(content[i-5:i+10]))

content = content.replace('\x8f', '')
with open('src/pages/ManageClientOrg.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print('Done')