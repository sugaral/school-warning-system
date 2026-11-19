import json, urllib.request, time, statistics
BASE='http://127.0.0.1:3000'
login=json.dumps({'account':'12345678911','password':'ws12345678911'}).encode()
req=urllib.request.Request(BASE+'/auth/login_admin',data=login,headers={'Content-Type':'application/json'},method='POST')
with urllib.request.urlopen(req,timeout=20) as r:
    body=json.loads(r.read().decode())
    token=body['data']['token']
headers={'Authorization':'Bearer '+token}
vals=[]
for i in range(12):
    t=time.time()
    req=urllib.request.Request(BASE+'/warnings?scope=active&page=1&page_size=20&no_cache=1',headers=headers)
    with urllib.request.urlopen(req,timeout=30) as r:
        r.read()
    vals.append((time.time()-t)*1000)
    print(round(vals[-1],2))
vals_sorted=sorted(vals)
p95=vals_sorted[max(0, min(len(vals_sorted)-1, int(len(vals_sorted)*0.95)-1))]
print(json.dumps({'avg':round(statistics.mean(vals),2),'p95':round(p95,2),'min':round(min(vals),2),'max':round(max(vals),2)}))
