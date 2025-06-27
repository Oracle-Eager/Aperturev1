// a1-engine.js (V2 - "Vanguard" Edition)

/**
 * A1EngineV2 (Vanguard Edition): A sophisticated fetching, parsing, and sandboxing engine.
 * This version is designed to handle complex, JavaScript-heavy websites by creating a
 * controlled, high-compatibility environment for the target page. It goes beyond simple
 * fetching by rewriting, neutralizing, and enhancing the remote document before it's rendered.
 */
export class A1EngineV2 {
    constructor() {
        // More proxies for better resilience. The first one is used for dynamic content by default.
        this.proxies = [
            'https://api.allorigins.win/raw?url=', // Good general-purpose proxy
            'https://cors.sh/?url=',             // Another solid option
            // 'https://proxy.example.com/?url=' // Add your own proxies here
        ];
        this.fetchTimeout = 15000; // 15 seconds, as some JS-heavy sites can be slow
        this.mobileUserAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';
        this.desktopUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0';
        
        // A highly permissive CSP to override server-sent policies that would block our sandboxing.
        this.permissiveCsp = "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; script-src * 'unsafe-inline' 'unsafe-eval'; connect-src * 'unsafe-inline'; img-src * data: blob:; style-src * 'unsafe-inline';";
    }

    /**
     * Fetches and processes a page, returning a sandboxed, ready-to-render HTML string.
     * @param {string} targetUrl The URL of the page to fetch.
     * @param {object} options Configuration options { mode: 'interactive' | 'desktop' }.
     * @returns {Promise<string>} A promise that resolves with the processed page's HTML.
     */
    async fetchAndProcessPage(targetUrl, options = { mode: 'interactive' }) {
        const userAgent = options.mode === 'desktop' ? this.desktopUserAgent : this.mobileUserAgent;
        const headers = { 'User-Agent': userAgent, 'X-Requested-With': 'XMLHttpRequest' };

        const fetchWithProxy = (proxyUrl) => {
            return new Promise(async (resolve, reject) => {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => {
                    controller.abort();
                    reject(new Error(`Timeout with proxy: ${new URL(proxyUrl).hostname}`));
                }, this.fetchTimeout);

                try {
                    const response = await fetch(`${proxyUrl}${encodeURIComponent(targetUrl)}`, {
                        headers,
                        signal: controller.signal,
                        referrerPolicy: 'no-referrer'
                    });
                    
                    clearTimeout(timeoutId);

                    if (!response.ok) {
                        return reject(new Error(`Proxy responded with status ${response.status}`));
                    }

                    const text = await response.text();
                    
                    if (/Cloudflare|hCaptcha|Verifying you are human|Checking your browser/i.test(text)) {
                        return reject(new Error('Proxy returned a challenge page.'));
                    }
                    
                    console.log(`[A1EngineV2] Success with proxy: ${new URL(proxyUrl).hostname}`);
                    resolve(text);
                } catch (error) {
                    clearTimeout(timeoutId);
                    reject(error);
                }
            });
        };

        try {
            // Race all proxies to get the initial HTML fast.
            const rawHtml = await Promise.any(this.proxies.map(p => fetchWithProxy(p)));
            // Process the raw HTML to make it safe and functional.
            return this._processAndInject(rawHtml, targetUrl);
        } catch (error) {
            console.error("[A1EngineV2] All proxies failed.", error);
            throw new Error('All proxies failed to fetch the content. The site may be down or blocking access.');
        }
    }

    /**
     * Parses, sanitizes, and injects our core sandboxing scripts into the document.
     * This is the heart of the engine, turning a hostile document into a cooperative one.
     * @param {string} html The raw HTML string from the fetch.
     * @param {string} targetUrl The original URL of the page.
     * @returns {string} The processed HTML string.
     * @private
     */
    _processAndInject(html, targetUrl) {
        const doc = new DOMParser().parseFromString(html, 'text/html');

        // 1. Set Base URL: This is crucial. It makes all relative paths on the page
        // (like /images/logo.png or /styles.css) resolve relative to the original
        // target URL, not the proxy's URL.
        const base = doc.createElement('base');
        base.href = targetUrl;
        doc.head.prepend(base);

        // 2. Override CSP: Inject a meta tag to define a very permissive Content-Security-Policy.
        // This overrides the server's CSP header, which would otherwise block many of our
        // modifications and the page's own scripts from loading in this new context.
        const cspMeta = doc.createElement('meta');
        cspMeta.setAttribute('http-equiv', 'Content-Security-Policy');
        cspMeta.setAttribute('content', this.permissiveCsp);
        doc.head.prepend(cspMeta);

        // 3. Inject the Vanguard Core Script: This script performs all the client-side magic.
        const vanguardScript = doc.createElement('script');
        vanguardScript.textContent = this._getVanguardScript(targetUrl, this.proxies[0]);
        doc.head.prepend(vanguardScript); // Prepend to run before any other scripts.

        // 4. Final Sanitization: Remove script tags that try to detect proxies or integrity issues.
        doc.querySelectorAll('script[integrity], script[crossorigin]').forEach(s => {
            s.removeAttribute('integrity');
            s.removeAttribute('crossorigin');
        });

        return doc.documentElement.outerHTML;
    }

    /**
     * Generates the client-side sandboxing script to be injected into the page.
     * @param {string} targetUrl The original URL.
     * @param {string} proxyUrl The primary proxy to use for dynamic requests.
     * @returns {string} The full JavaScript code for injection.
     * @private
     */
    _getVanguardScript(targetUrl, proxyUrl) {
        return `
            (function() {
                'use strict';

                // --- 1. NEUTRALIZE ANTI-EMBEDDING & ANTI-PROXY SCRIPTS ---
                // Defeat basic frame-busting techniques by faking the top window.
                try {
                    if (window.self !== window.top) {
                        Object.defineProperty(window, 'top', { value: window.self, writable: false, configurable: false });
                        window.parent = window.self;
                    }
                } catch (e) { console.warn('Aperture Vanguard: Could not redefine window.top.', e.message); }

                // --- 2. INTERCEPT DYNAMIC DATA REQUESTS (XHR & FETCH) ---
                // This is critical for single-page applications (SPAs) to function.
                const originalFetch = window.fetch;
                const originalXhrOpen = window.XMLHttpRequest.prototype.open;
                const PROXY_URL = '${proxyUrl}';
                const TARGET_URL = '${targetUrl}';

                const resolveUrl = (url) => new URL(url, TARGET_URL).href;

                // Intercept fetch()
                window.fetch = function(resource, options) {
                    const requestUrl = (resource instanceof Request) ? resource.url : resource;
                    const absoluteUrl = resolveUrl(requestUrl);
                    console.log('[Aperture Vanguard] Intercepted fetch:', absoluteUrl);
                    const proxiedUrl = \`\${PROXY_URL}\${encodeURIComponent(absoluteUrl)}\`;
                    
                    if (resource instanceof Request) {
                        // Re-create the request object to avoid "already used" errors.
                        return originalFetch(proxiedUrl, { ...options, headers: resource.headers, body: resource.body });
                    }
                    return originalFetch(proxiedUrl, options);
                };

                // Intercept XMLHttpRequest
                window.XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
                    const absoluteUrl = resolveUrl(url);
                    const proxiedUrl = \`\${PROXY_URL}\${encodeURIComponent(absoluteUrl)}\`;
                    console.log('[Aperture Vanguard] Intercepted XHR:', absoluteUrl);
                    return originalXhrOpen.call(this, method, proxiedUrl, async, user, password);
                };

                // --- 3. INTERCEPT NAVIGATION ---
                const interceptAndPost = (url) => {
                    try {
                        const absoluteUrl = resolveUrl(url);
                        window.parent.postMessage({ type: 'aperture-navigate', url: absoluteUrl }, '*');
                    } catch(e) { console.error('Aperture Vanguard: Navigation intercept error:', e); }
                };

                // For links
                document.addEventListener('click', e => {
                    const anchor = e.target.closest('a');
                    if (anchor && anchor.href && anchor.target !== '_blank' && !anchor.href.startsWith('javascript:') && !anchor.hasAttribute('download')) {
                        e.preventDefault();
                        e.stopPropagation();
                        interceptAndPost(anchor.href);
                    }
                }, true);

                // For forms
                document.addEventListener('submit', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    const form = e.target;
                    const formData = new FormData(form);
                    const params = new URLSearchParams(formData);
                    const actionUrl = form.action || TARGET_URL;
                    const targetUrl = new URL(actionUrl);
                    
                    if (form.method.toLowerCase() === 'post') {
                        // POST requests are complex to proxy this way, we'll navigate via GET for now.
                        // A more advanced implementation would need a backend to handle POST.
                        targetUrl.search = params.toString();
                        interceptAndPost(targetUrl.href);
                    } else { // GET
                        targetUrl.search = params.toString();
                        interceptAndPost(targetUrl.href);
                    }
                }, true);


                // --- 4. AGGRESSIVE DOM SANITIZATION ---
                // Removes overlays, cookie banners, popups, etc.
                const cleanDom = () => {
                    const selectorsToRemove = [
                        '[id*="cookie"]', '[class*="cookie"]', '[aria-label*="cookie"]',
                        '[id*="consent"]', '[class*="consent"]',
                        '[id*="banner"]', '[class*="banner"]',
                        '[id*="modal"]', '[class*="modal"]',
                        '[id*="popup"]', '[class*="popup"]',
                        '[id*="newsletter"]', '[class*="newsletter"]',
                        '#onetrust-consent-sdk', '.fc-consent-root', '.cc-window',
                        'aside', '[class*="aside"]', 'div[role="dialog"]'
                    ];
                    document.querySelectorAll(selectorsToRemove.join(', ')).forEach(el => {
                        // Be more aggressive: remove if it's likely an overlay
                        const style = getComputedStyle(el);
                        if (style.position === 'fixed' || style.position === 'sticky') {
                           el.remove();
                        }
                    });
                    // Restore scrolling
                    document.documentElement.style.overflow = 'auto !important';
                    document.body.style.overflow = 'auto !important';
                };
                
                // Run cleanup at different stages of page load
                window.addEventListener('DOMContentLoaded', () => {
                    setTimeout(cleanDom, 50);
                    setTimeout(cleanDom, 500);
                    setTimeout(cleanDom, 2000);
                });

            })();
        `;
    }
}
