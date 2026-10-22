import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Window, type HTMLButtonElement } from 'happy-dom';

test('fullscreen is explicit, uses the stable root, survives scenes and handles exit/rejection/unsupported browsers', async t => {
 const w=new Window({settings:{enableJavaScriptEvaluation:true,suppressInsecureJavaScriptEnvironmentWarning:true}});t.after(()=>w.happyDOM.close());
 const js=await build({stdin:{contents:"import {fullscreenButton} from './src/client/fullscreen'; window.mount=()=>document.body.innerHTML=fullscreenButton();",resolveDir:process.cwd()},bundle:true,format:'iife',write:false});
 let calls=0,active:unknown=null,reject=false;
 Object.defineProperty(w.document,'fullscreenElement',{get:()=>active});Object.defineProperty(w.document,'fullscreenEnabled',{value:true,configurable:true});
 (w.document.documentElement as any).requestFullscreen=async()=>{calls++;if(reject)throw new Error('denied');active=w.document.documentElement;w.document.dispatchEvent(new w.Event('fullscreenchange'));};
 (w.document as any).exitFullscreen=async()=>{active=null;w.document.dispatchEvent(new w.Event('fullscreenchange'));};
 w.eval(js.outputFiles[0].text);w.eval('mount()');assert.equal(calls,0);
 const click=()=>w.document.querySelector<HTMLButtonElement>('[data-fullscreen]')!.click();
 const settle=()=>new Promise(r=>setTimeout(r,0));
 click();await settle();assert.equal(active,w.document.documentElement);assert.equal(w.document.querySelector('button')!.getAttribute('aria-pressed'),'true');
 w.eval('mount()');assert.equal(w.document.querySelector('button')!.getAttribute('aria-pressed'),'true');click();await settle();assert.equal(active,null);
 reject=true;click();await settle();assert.match(w.document.querySelector('#fullscreen-notice')!.textContent!,/無法/);assert.equal(w.document.querySelector<HTMLButtonElement>('button')!.disabled,false);
 Object.defineProperty(w.document,'fullscreenEnabled',{value:false});const count=calls;click();assert.equal(calls,count);assert.match(w.document.querySelector('#fullscreen-notice')!.textContent!,/不支援/);
});
