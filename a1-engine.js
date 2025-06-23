// a1-engine.js

/**
 * A1Engine (Apex Version): The core fetching, parsing, and sanitization engine for Aperture.
 * This version uses parallel proxy racing for maximum speed and reliability.
 */
export class A1Engine {
    constructor() {
        this.proxies = [
            'https://api.allorigins.win/raw?url=',
            'https://cors.sh/?url=',
        ];
        this.fetchTimeout = 10000; // 10 seconds per proxy
        this.mobileUserAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';
        this.desktopUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0';
    }

    /**
     * Fetches a page by racing multiple proxies and returning the first valid response.
     * @param {string} targetUrl The URL of the page to fetch.
     * @param {object} options Configuration options { mode: 'interactive' | 'desktop' }.
     * @returns {Promise<string>} A promise that resolves with the page's HTML content.
     */
    async fetchPage(targetUrl, options = { mode: 'interactive' }) {
        const userAgent = options.mode === 'desktop' ? this.desktopUserAgent : this.mobileUserAgent;
        const headers = { 'User-Agent': userAgent, 'X-Requested-With': 'XMLHttpRequest' };

        const fetchWithProxy = (proxy) => {
            return new Promise(async (resolve, reject) => {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => {
                    controller.abort();
                    reject(new Error(`Timeout with proxy: ${proxy.split('/')[2]}`));
                }, this.fetchTimeout);

                try {
                    const response = await fetch(`${proxy}${encodeURIComponent(targetUrl)}`, {
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
                    
                    console.log(`[A1Engine] Success with proxy: ${proxy.split('/')[2]}`);
                    resolve(text);
                } catch (error) {
                    clearTimeout(timeoutId);
                    reject(error);
                }
            });
        };

        try {
            // Race all proxies. The first to resolve with valid content wins.
            return await Promise.any(this.proxies.map(p => fetchWithProxy(p)));
        } catch (error) {
            console.error("[A1Engine] All proxies failed.", error);
            throw new Error('All proxies failed to fetch the content. The site may be down or blocking access.');
        }
    }

    /**
     * Injects an aggressive sanitization and navigation script into the parsed document.
     * @param {Document} doc The DOM document parsed from the fetched HTML.
     * @returns {Document} The modified document with the script injected.
     */
    sanitizeAndInject(doc) {
        const scriptContent = `
            (function() {
                const cleanDom = () => {
                    const selectorsToRemove = [
                        '[id*="cookie"]', '[class*="cookie"]', '[aria-label*="cookie"]',
                        '[id*="consent"]', '[class*="consent"]',
                        '[id*="banner"]', '[class*="banner"]',
                        '[id*="modal"]', '[class*="modal"]',
                        '[id*="popup"]', '[class*="popup"]',
                        '[id*="newsletter"]', '[class*="newsletter"]',
                        '#onetrust-consent-sdk', '.fc-consent-root', '.cc-window',
                        'aside', '[class*="aside"]'
                    ];
                    document.querySelectorAll(selectorsToRemove.join(', ')).forEach(el => {
                        const rect = el.getBoundingClientRect();
                        if ((rect.height > 40 || rect.width > (window.innerWidth / 2)) && getComputedStyle(el).position !== 'static') {
                            el.remove();
                        }
                    });
                    document.documentElement.style.overflow = 'auto';
                    document.body.style.overflow = 'auto';
                    document.querySelectorAll('body *').forEach(el => {
                        const style = getComputedStyle(el);
                        if (style.position === 'fixed' || style.position === 'sticky') {
                            el.style.position = 'absolute';
                        }
                    });
                };
                window.addEventListener('DOMContentLoaded', () => {
                    setTimeout(cleanDom, 50); setTimeout(cleanDom, 500); setTimeout(cleanDom, 2000);
                });
                const interceptAndPost = (url) => {
                    try {
                        const absoluteUrl = new URL(url, window.location.href).href;
                        window.parent.postMessage({ type: 'aperture-navigate', url: absoluteUrl }, '*');
                    } catch(e) { console.error('Aperture intercept error:', e); }
                };
                document.addEventListener('click', e => {
                    const anchor = e.target.closest('a');
                    if (anchor && anchor.href && anchor.target !== '_blank' && !anchor.href.startsWith('javascript:')) {
                        e.preventDefault(); e.stopPropagation(); interceptAndPost(anchor.href);
                    }
                }, true);
            })();
        `;
        const scriptEl = doc.createElement('script');
        scriptEl.textContent = scriptContent;
        doc.head.appendChild(scriptEl);
        return doc;
    }
}