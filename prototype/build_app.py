import re, json
SRC='/workspace/games/'
FILES=[('1_uznat_glubzhe.md','deep','Узнать глубже','💬'),('2_posmeyatsya.md','fun','Посмеяться','😂'),('3_final_18.md','x18','Финал 18+','🔥')]
LV='🟢🟡🔴🔥💞'
def lvl(s):
    for ch in LV:
        if ch in s: return ch
    return ''
data=[]; report=[]
for fn,sid,stitle,icon in FILES:
    txt=open(SRC+fn,encoding='utf-8').read()
    parts=re.split(r'(?m)^(?=## )',txt)
    head=parts[0]; secs=parts[1:]
    m=re.match(r'# (.*)',head); full=m.group(1)
    intro=head[m.end():].strip()
    S={'id':sid,'title':stitle,'full':full,'icon':icon,'intro':intro,'games':[],'info':[]}
    gi=0
    for sec in secs:
        h,body=sec.split('\n',1); h=h[3:].strip()
        if h.startswith('Игра'):
            gi+=1
            chunks=re.split(r'(?m)^### Колода:\s*',body)
            rules=chunks[0].strip().rstrip('-').strip()
            decks=[]
            for ch in chunks[1:]:
                dn,db=ch.split('\n',1); dn=dn.strip()
                cards=[]
                for line in db.split('\n'):
                    mm=re.match(r'^(\d+)\.\s+(.*)$',line)
                    if mm:
                        t=mm.group(2).strip()
                        cards.append({'n':int(mm.group(1)),'t':t,'l':lvl(t[:3]) or lvl(dn)})
                    elif line.strip() not in ('','---'):
                        print('UNPARSED',fn,dn,line)
                decks.append({'name':dn,'cards':cards})
            mt=re.match(r'Игра \d+\.\s*(.*)',h); title=mt.group(1)
            short=re.findall(r'«([^»]*)»',title)
            g={'id':f'{sid}{gi}','title':title,'short':' + '.join(short) if short else title,'rules':rules,'decks':decks}
            if sid=='x18' and any(d['name'].startswith('Бандит') for d in decks): g['mode']='bandit'
            S['games'].append(g)
        elif h.startswith('Перед игрой'):
            S['before']={'title':h,'md':body.strip()}
        else:
            S['info'].append({'title':h,'md':body.strip().rstrip('-').strip()})
    # raw check
    raw=0
    for blk in re.split(r'(?m)^(?=##)',txt):
        if blk.startswith('### Колода'): raw+=len(re.findall(r'(?m)^\d+\. ',blk))
    parsed=sum(len(d['cards']) for g in S['games'] for d in g['decks'])
    report.append((stitle,S,raw,parsed))
    data.append(S)
tot=0
for stitle,S,raw,parsed in report:
    print(f'== {stitle}: games={len(S["games"])} cards parsed={parsed} raw-in-deck-blocks={raw}')
    for g in S['games']:
        print('  ',g['short'], g.get('mode',''))
        for d in g['decks']: print('     ',len(d['cards']),d['name'])
    tot+=parsed
print('TOTAL',tot)
tpl=open('/workspace/games/app/template.html',encoding='utf-8').read()
js=json.dumps(data,ensure_ascii=False).replace('</','<\\/')
open('/workspace/games/app/index.html','w',encoding='utf-8').write(tpl.replace('/*__DATA__*/null',js))
