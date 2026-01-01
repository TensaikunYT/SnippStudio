// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Local, hidden Chromium canvas regression check. No project files or network.
const { app, BrowserWindow } = require('electron')
const { buildSync } = require('esbuild')
const fs = require('node:fs')
const path = require('node:path')
app.setPath('userData', path.resolve('out-test/render-qa-profile'))
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }))
  await win.loadURL('about:blank')
  const code = buildSync({ stdin: { contents: `
    import { renderFrame } from './src/renderer/src/playback/render'
    import { defaultProject } from './src/renderer/src/types'
    crypto.randomUUID ??= (() => 'qa-' + Math.random().toString(36).slice(2));
    const p = defaultProject(); p.settings.width=640; p.settings.height=360;
    const track=p.tracks[0]; track.clipIds=['a','b'];
    const sources={};
    for(const [i,id] of ['a','b','cover'].entries()) {
      const cv=document.createElement('canvas');cv.width=640;cv.height=360;
      const c=cv.getContext('2d');c.fillStyle=['#438faf','#c99367','#35da87'][i];c.fillRect(0,0,640,360);
      if(i<2) { c.fillStyle='#eee4cc'; for(let x=0;x<640;x+=40)c.fillRect(x,0,12,360); }
      sources[id]=cv;
      p.assets.push({id,name:id,kind:'image',url:'',size:1,duration:0,width:640,height:360,hasAudio:false});
      p.clips[id]={id,assetId:id,trackId:track.id,start:id==='b'?5:0,duration:id==='cover'?10:5,inPoint:0,volume:1,transform:{x:320,y:180,scale:1,rotation:0}};
    }
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
    const ctx=canvas.getContext('2d');const resolve=(clip)=>sources[clip.id];
    const sheet=document.createElement('canvas');sheet.width=1280;sheet.height=1080;const sc=sheet.getContext('2d');
    const types=['flash','ramp-up','ramp-right','light-leak','slide','wipe','zoom','whip','blur','iris','push','ramp-left','ramp-down','mix'];
    let checks=0;
    for(const type of types){
      p.clips.a.transitionOut={type,duration:.8};
      for(const time of [4.65,4.85,5,5.15,5.35]){
        renderFrame(ctx,p,time,resolve,{includeCaptions:false});
        if(type.startsWith('ramp-')){
          const data=ctx.getImageData(0,0,640,360).data;
          for(let i=0;i<data.length;i+=4)if(data[i]+data[i+1]+data[i+2]<15)throw Error(type+' black seam at '+time);
        }
        p.tracks.unshift({...track,id:'upper',clipIds:['cover']});p.clips.cover.trackId='upper';
        renderFrame(ctx,p,time,resolve,{includeCaptions:false});
        const pixel=ctx.getImageData(320,180,1,1).data;
        if(pixel[0]!==53||pixel[1]!==218||pixel[2]!==135)throw Error(type+' covers upper layer');
        p.tracks.shift();checks++;
      }
    }
    for(const [row,type] of ['flash','ramp-up'].entries())for(const [col,time] of [4.9,5].entries()){
      p.clips.a.transitionOut={type,duration:.8};renderFrame(ctx,p,time,resolve,{includeCaptions:false});sc.drawImage(canvas,col*640,row*360);
    }
    delete p.clips.a.transitionOut;
    renderFrame(ctx,p,2,resolve,{includeCaptions:false});const before=ctx.getImageData(0,0,640,360).data;sc.drawImage(canvas,0,720);
    p.clips.a.ambientFx={style:'living-frame',amount:.8,seed:42,timeOffset:0};
    renderFrame(ctx,p,2,resolve,{includeCaptions:false});const after=ctx.getImageData(0,0,640,360).data;sc.drawImage(canvas,640,720);
    let edgeChanged=false;
    for(let y=0;y<360;y++)for(let x=0;x<640;x++){
      const i=(y*640+x)*4;const diff=Math.abs(before[i]-after[i])+Math.abs(before[i+1]-after[i+1])+Math.abs(before[i+2]-after[i+2]);
      if(x>200&&x<440&&y>130&&y<230&&diff)throw Error('Living Frame changes center');
      if(x<50&&diff>3)edgeChanged=true;
    }
    if(!edgeChanged)throw Error('Living Frame is invisible');
    window.qa={checks,png:sheet.toDataURL('image/png')};
  `, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife', platform: 'browser' }).outputFiles[0].text
  const failure = await win.webContents.executeJavaScript(`try { ${code}; null } catch(error) { String(error.stack) }`)
  if (failure) throw new Error(failure)
  const result = await win.webContents.executeJavaScript('window.qa')
  fs.writeFileSync('out-test/transition-qa.png', Buffer.from(result.png.split(',')[1], 'base64'))
  fs.writeFileSync('out-test/transition-qa.json', JSON.stringify({ checks: result.checks, passed: true }))
  app.exit(0)
}).catch(error => { fs.writeFileSync('out-test/transition-qa.json', JSON.stringify({error:String(error)}));app.exit(1) })
