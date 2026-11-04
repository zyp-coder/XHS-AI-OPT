const fs=require('fs'), http=require('http');
const get=(p,m='GET')=>new Promise((res,rej)=>{const r=http.request({host:'127.0.0.1',port:9334,path:p,method:m},x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>{try{res(JSON.parse(d))}catch(e){res(d)}})});r.on('error',rej);r.end();});
(async()=>{
  const url='file:///D:/AIproject/%E5%B0%8F%E7%BA%A2%E4%B9%A6%E8%BF%90%E8%90%A5/tmp/demo-plan-diag-20261031.html';
  const t=await get('/json/new?'+encodeURIComponent(url),'PUT');
  const ws=new WebSocket(t.webSocketDebuggerUrl); let id=0; const pend=new Map();
  const send=(method,params={})=>new Promise((res,rej)=>{const i=++id;pend.set(i,{res,rej});ws.send(JSON.stringify({id:i,method,params}))});
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){const p=pend.get(m.id);pend.delete(m.id);m.error?p.rej(m.error):p.res(m.result)}};
  await new Promise(r=>ws.onopen=r);
  await send('Page.enable'); await send('Runtime.enable');
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  await wait(1500);
  let s=await send('Page.captureScreenshot',{format:'png'}); fs.writeFileSync('demo-plan.png',Buffer.from(s.data,'base64'));
  await send('Runtime.evaluate',{expression:`document.querySelectorAll('.tabs button')[1].click(); 'ok'`,returnByValue:true});
  await wait(600);
  s=await send('Page.captureScreenshot',{format:'png'}); fs.writeFileSync('demo-diag.png',Buffer.from(s.data,'base64'));
  // 打开平台菜单截图
  await send('Runtime.evaluate',{expression:`document.querySelectorAll('.tabs button')[0].click(); document.querySelector('[data-platopen="fri"]')||document.querySelector('[data-platopen]').click(); 'ok'`,returnByValue:true});
  await wait(600);
  s=await send('Page.captureScreenshot',{format:'png'}); fs.writeFileSync('demo-menu.png',Buffer.from(s.data,'base64'));
  ws.close(); console.log('done'); process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
