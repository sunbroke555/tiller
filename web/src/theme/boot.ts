// The inline script that applies the stored theme before first paint, so the
// page never flashes the wrong theme. vite.config.ts injects it into
// index.html; the Go server allows it in the CSP by its SHA-256 hash.
//
// It must stay dependency-free ES5 that mirrors prefs.ts exactly; the
// "boot script parity" test in theme.test.ts checks both agree.

import { ACCENTS, DEFAULT_PREFS, DENSITIES, THEME_COLORS, THEME_MODES, THEME_STORAGE_KEY } from './prefs.ts'

const j = JSON.stringify

export const themeBootScript =
  `(function(){try{` +
  `var d=document.documentElement,p=null;` +
  `try{p=JSON.parse(localStorage.getItem(${j(THEME_STORAGE_KEY)})||"null")}catch(e){}` +
  `if(!p||typeof p!=="object")p={};` +
  `function o(l,v,f){return typeof v==="string"&&l.indexOf(v)>=0?v:f}` +
  `var mode=o(${j(THEME_MODES)},p.mode,${j(DEFAULT_PREFS.mode)});` +
  `var accent=o(${j(ACCENTS)},p.accent,${j(DEFAULT_PREFS.accent)});` +
  `var glass=typeof p.glass==="boolean"?p.glass:${j(DEFAULT_PREFS.glass)};` +
  `var density=o(${j(DENSITIES)},p.density,${j(DEFAULT_PREFS.density)});` +
  `var dark=!!(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);` +
  `var t=mode==="system"?(dark?"dark":"light"):mode;` +
  `d.setAttribute("data-theme",t);` +
  `d.setAttribute("data-accent",t==="paper"?"clay":accent);` +
  `d.setAttribute("data-glass",t!=="paper"&&glass?"on":"off");` +
  `d.setAttribute("data-density",density);` +
  `if(t==="dark")d.classList.add("dark");else d.classList.remove("dark");` +
  `d.style.colorScheme=t==="dark"?"dark":"light";` +
  `var c=${j(THEME_COLORS)}[t],m=document.querySelector('meta[name="theme-color"]');` +
  `if(m)m.setAttribute("content",c);` +
  `var b=document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');` +
  `if(b)b.setAttribute("content",t==="dark"?"black-translucent":"default");` +
  `}catch(e){}})()`
