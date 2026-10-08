#!/usr/bin/env python3
"""crawl.py <role> <email> : log in, visit every tab and every home tool, screenshot top + one scroll, collect JS errors."""
import sys, os, time, subprocess, importlib.util
H=os.path.dirname(os.path.abspath(__file__))
spec=importlib.util.spec_from_file_location('ui', os.path.join(H,'ui.py')); ui=importlib.util.module_from_spec(spec)
sys_argv=sys.argv; sys.argv=['ui','noop']
try: spec.loader.exec_module(ui)
except SystemExit: pass
sys.argv=sys_argv
role,email=sys.argv[1],sys.argv[2]; OUT=os.path.join(os.environ.get('AUDIT_OUT','/tmp/sckools-audit'),role); os.makedirs(OUT,exist_ok=True)
def sh(*a): return ui.sh(*a)
def shot(name):
    time.sleep(1.2); p=os.path.join(OUT,name+'.png'); open(p,'wb').write(sh('exec-out','screencap','-p').stdout)
    subprocess.run(['sips','-Z','900',p],capture_output=True)
def tapq(q):
    n,b=ui.find(q)
    if n is None: return False
    sh('shell','input','tap',str((b[0]+b[2])//2),str((b[1]+b[3])//2)); return True
def swipe(): sh('shell','input','swipe','540','1800','540','700','350'); time.sleep(0.8)
def ids(prefix):
    out=[]
    for n,b in ui.nodes(ui.dump()):
        r=n.get('resource-id','')
        if r.startswith(prefix) and r not in out and '-badge-' not in r and 'indicator' not in r: out.append(r)
    return out
sh('shell','pm','clear','com.sckools.app'); sh('shell','logcat','-c')
sh('shell','am','start','-n','com.sckools.app/.MainActivity'); time.sleep(9)
tapq('login-id'); sh('shell','input','text',email); sh('shell','input','tap','940','2127'); time.sleep(1)
sh('shell','input','text',os.environ.get('AUDIT_PASSWORD','password')); sh('shell','input','tap','940','2127'); time.sleep(10)
shot('00-landing')
tabs=ids('tab-'); print('tabs',tabs)
for t in tabs:
    tapq(t); time.sleep(3); name=t.replace('tab-','')
    shot(f'tab-{name}-1'); swipe(); shot(f'tab-{name}-2'); swipe(); shot(f'tab-{name}-3')
    for _ in range(4): sh('shell','input','swipe','540','700','540','1900','200')
    tools=ids('hometool-')
    for tool in tools:
        tapq(t); time.sleep(1.5)
        for _ in range(6):
            if ui.find(tool)[0] is not None: break
            swipe()
        if not tapq(tool): continue
        time.sleep(3.5); nm=tool.replace('hometool-','').replace(' ','_').replace('&','and')
        shot(f'{name}-tool-{nm}-1'); swipe(); shot(f'{name}-tool-{nm}-2')
        sh('shell','input','keyevent','4'); time.sleep(1.2)
        for _ in range(4): sh('shell','input','swipe','540','700','540','1900','200')
errs=sh('shell','logcat','-d','-s','ReactNativeJS:W','ReactNativeJS:E','AndroidRuntime:E').stdout.decode('utf8','ignore')
open(os.path.join(OUT,'logcat.txt'),'w').write(errs); print('log lines',len(errs.splitlines()))
print('shots',len(os.listdir(OUT)))
