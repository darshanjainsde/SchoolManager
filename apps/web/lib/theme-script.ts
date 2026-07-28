/**
 * The no-flash theme bootstrap: applies the stored theme to <html> before
 * hydration so a dark-theme user never sees a white flash.
 *
 * It lives here rather than inline in the component so that the exact string
 * the browser executes has one source of truth — needed the moment the console
 * CSP moves to a hash- or nonce-based script-src.
 */
export const THEME_SCRIPT =
  "(function(){try{var c=localStorage.getItem('sk-theme');if(c==='dark'||c==='light'){document.documentElement.setAttribute('data-theme',c);}}catch(e){}})();";
