import sys,os
from PIL import Image, ImageDraw
d=sys.argv[1]; per=int(sys.argv[2]) if len(sys.argv)>2 else 6
fs=sorted(f for f in os.listdir(d) if f.endswith('.png') and not f.startswith('sheet'))
W=360
for k in range(0,len(fs),per):
    imgs=[Image.open(os.path.join(d,f)).convert('RGB') for f in fs[k:k+per]]
    ims=[im.resize((W,int(im.height*W/im.width))) for im in imgs]
    H=max(i.height for i in ims)+28
    sheet=Image.new('RGB',(W*len(ims)+8*(len(ims)-1),H),'white'); dr=ImageDraw.Draw(sheet)
    for j,(im,f) in enumerate(zip(ims,fs[k:k+per])):
        x=j*(W+8); sheet.paste(im,(x,28)); dr.text((x+4,6),f[:-4][:48],fill='black')
    sheet.save(os.path.join(d,f'sheet{k//per:02d}.png'))
print(len(fs),'shots ->',(len(fs)+per-1)//per,'sheets')
