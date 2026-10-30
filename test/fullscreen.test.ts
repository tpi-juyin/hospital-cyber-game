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
 Object.defineProperty(w.document,'fullscreenEnabled',{value:false});const count=calls;click();assert.equal(calls,count);assert.ok(w.document.querySelector('#fullscreen-help')!.hasAttribute('open'));assert.match(w.document.querySelector('#fullscreen-help')!.textContent!,/全螢幕/);
});

test('Safari prefixed fullscreen and standalone mode', async t => {
 const w=new Window({settings:{enableJavaScriptEvaluation:true,suppressInsecureJavaScriptEnvironmentWarning:true}});t.after(()=>w.happyDOM.close());
 const js=await build({stdin:{contents:"import {fullscreenButton} from './src/client/fullscreen'; window.mount=()=>document.body.innerHTML=fullscreenButton();",resolveDir:process.cwd()},bundle:true,format:'iife',write:false});
 let active:unknown=null,calls=0;
 Object.defineProperty(w.document.documentElement,'requestFullscreen',{value:undefined});
 Object.defineProperty(w.document,'webkitFullscreenElement',{get:()=>active});
 (w.document.documentElement as any).webkitRequestFullscreen=function(){assert.equal(this,w.document.documentElement);calls++;active=this;w.document.dispatchEvent(new w.Event('webkitfullscreenchange'));};
 (w.document as any).webkitExitFullscreen=function(){assert.equal(this,w.document);active=null;w.document.dispatchEvent(new w.Event('webkitfullscreenchange'));};
 w.eval(js.outputFiles[0].text);w.eval('mount()');
 const click=()=>w.document.querySelector<HTMLButtonElement>('[data-fullscreen]')!.click();
 click();await new Promise(r=>setTimeout(r,0));assert.equal(calls,1);assert.equal(w.document.querySelector('button')!.getAttribute('aria-pressed'),'true');
 click();await new Promise(r=>setTimeout(r,0));assert.equal(active,null);
 Object.defineProperty(w.navigator,'standalone',{value:true});w.dispatchEvent(new w.Event('pageshow'));assert.equal(w.document.querySelector<HTMLButtonElement>('button')!.hidden,true);
 w.eval('mount()');assert.equal(w.document.querySelector('[data-fullscreen]'),null);
});
