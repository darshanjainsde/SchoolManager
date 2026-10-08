#!/usr/bin/env python3
"""probe.py <shot> <input> [button...] : focus input, report whether it and the buttons sit above the keyboard."""
import sys, time, subprocess, os, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib.util
spec=importlib.util.spec_from_file_location('ui', os.path.join(os.path.dirname(os.path.abspath(__file__)),'ui.py'))
ui=importlib.util.module_from_spec(spec); sys.argv_backup=sys.argv; sys.argv=['ui','noop']; 
try: spec.loader.exec_module(ui)
except SystemExit: pass
sys.argv=sys.argv_backup
shot, inp, *buttons = sys.argv[1:]
n,b=ui.find(inp)
if n is None: print('NOTFOUND input', inp); sys.exit(2)
ui.sh('shell','input','tap',str((b[0]+b[2])//2),str((b[1]+b[3])//2)); time.sleep(2.2)
o=ui.sh('shell','dumpsys','input_method').stdout.decode(); shown='mInputShown=true' in o
root=ui.dump()
# The React root (first child of android:id/content) ends where the visible
# area ends — at the keyboard's top once the native pad is applied.
top=None
for n in root.iter('node'):
    if n.get('resource-id')=='android:id/content':
        kids=list(n)
        if kids: top=int(re.findall(r'\d+',kids[0].get('bounds'))[3])
        break
if top==2340: top=None if not shown else 2340
def row(q):
    n,b=ui.find(q,root)
    if n is None: return f'  {q}: NOT ON SCREEN (scrolled off or behind keyboard)'
    ok = top is None or b[3] < top-2
    return f"  {q}: {b}  {'OK' if ok else 'CUT AT KEYBOARD'}{' focused' if n.get('focused')=='true' else ''}"
print(f'[{shot}] keyboard={"up" if shown else "DOWN"} top={top}')
print(row(inp))
for q in buttons: print(row(q))
open(os.path.join(os.environ.get('AUDIT_OUT','/tmp/sckools-audit'),shot+'.png'),'wb').write(ui.sh('exec-out','screencap','-p').stdout)
