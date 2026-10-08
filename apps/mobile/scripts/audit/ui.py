#!/usr/bin/env python3
"""Tiny adb UI driver: ui.py tap <id|text> | type <text> | shot <name> | ime | find <substr> | key <code> | dump"""
import subprocess, sys, re, os, time, xml.etree.ElementTree as ET
S=os.path.dirname(os.path.abspath(__file__)); DEV=os.environ.get('DEV','emulator-5556')
ADB=[os.path.expanduser('~/Library/Android/sdk/platform-tools/adb'),'-s',DEV]
def sh(*a, **k): return subprocess.run(ADB+list(a), capture_output=True, **k)
def dump():
    sh('shell','uiautomator','dump','/sdcard/u.xml'); x=sh('exec-out','cat','/sdcard/u.xml').stdout.decode('utf8','ignore')
    return ET.fromstring(x[x.index('<?xml'):]) if '<?xml' in x else ET.fromstring(x)
def nodes(root):
    for n in root.iter('node'):
        b=re.findall(r'\d+',n.get('bounds','')); 
        if len(b)==4: yield n,[int(v) for v in b]
def find(q, root=None):
    root=root or dump()
    for n,b in nodes(root):
        if n.get('resource-id','').endswith(q) or n.get('text')==q or n.get('content-desc')==q: return n,b
    for n,b in nodes(root):
        if q.lower() in (n.get('text') or '').lower() or q.lower() in (n.get('content-desc') or '').lower(): return n,b
    return None,None
def ime():
    o=sh('shell','dumpsys','window','InputMethod').stdout.decode()
    m=re.search(r'mFrame=\[?(\d+),(\d+)\]?\[(\d+),(\d+)\]',o)
    shown='isVisible=true' in o or 'mViewVisibility=0x0' in o
    return shown, (m.groups() if m else None)
cmd=sys.argv[1]
if cmd=='tap':
    n,b=find(sys.argv[2]); 
    if n is None: print('NOTFOUND',sys.argv[2]); sys.exit(2)
    x,y=(b[0]+b[2])//2,(b[1]+b[3])//2; sh('shell','input','tap',str(x),str(y)); print('tapped',sys.argv[2],b)
elif cmd=='type': sh('shell','input','text',sys.argv[2].replace(' ','%s'))
elif cmd=='key': sh('shell','input','keyevent',sys.argv[2])
elif cmd=='shot':
    time.sleep(float(os.environ.get('WAIT','1.5'))); os.makedirs(os.environ.get('AUDIT_OUT','/tmp/sckools-audit'),exist_ok=True); open(os.path.join(os.environ.get('AUDIT_OUT','/tmp/sckools-audit'),sys.argv[2]+'.png'),'wb').write(sh('exec-out','screencap','-p').stdout); print(sys.argv[2])
elif cmd=='find':
    n,b=find(sys.argv[2]); print(b if n is not None else 'NOTFOUND')
elif cmd=='dump':
    for n,b in nodes(dump()):
        t=n.get('text') or n.get('content-desc') or ''; r=n.get('resource-id','')
        if t or r: print(b, r, repr(t[:60]), 'focused' if n.get('focused')=='true' else '')
elif cmd=='ime':
    o=sh('shell','dumpsys','input_method').stdout.decode(); print('shown' if 'mInputShown=true' in o else 'hidden')
if cmd=='reveal':
    for i in range(10):
        n,b=find(sys.argv[2])
        if n is not None and b[3] < 1900 and b[1] > 250: print('visible',b); break
        sh('shell','input','swipe','540','1700','540','1100','400'); time.sleep(0.8)
    else: print('NOTFOUND after scrolling', sys.argv[2])
