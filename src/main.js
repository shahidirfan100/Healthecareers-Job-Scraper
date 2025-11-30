// Healthecareers jobs scraper - Production-grade CheerioCrawler implementation
import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';
import { load as cheerioLoad } from 'cheerio';
import { HeaderGenerator } from 'header-generator';

// Single-entrypoint main
await Actor.init();

async function main() {
    try {
        const input = (await Actor.getInput()) || {};
        const {
            keyword = '', location = '', category = '', results_wanted: RESULTS_WANTED_RAW = 100,
            max_pages: MAX_PAGES_RAW = 999, collectDetails = true, startUrl, startUrls, url, proxyConfiguration, dedupe = true,
        } = input;

        const RESULTS_WANTED = Number.isFinite(+RESULTS_WANTED_RAW) ? Math.max(1, +RESULTS_WANTED_RAW) : Number.MAX_SAFE_INTEGER;
        const MAX_PAGES = Number.isFinite(+MAX_PAGES_RAW) ? Math.max(1, +MAX_PAGES_RAW) : 999;
        
        // Pre-generate headers for faster requests
        const headerGenerator = new HeaderGenerator();
        const cachedHeaders = headerGenerator.getHeaders({
            browsers: [{ name: 'chrome', minVersion: 115, maxVersion: 120 }],
            operatingSystems: ['windows', 'macos'],
            devices: ['desktop'],
            locales: ['en-US'],
        });
        const seenUrls = dedupe ? new Set() : null;
        
        // Statistics tracking
        let pagesProcessed = 0;
        let detailsProcessed = 0;
        const startTime = Date.now();

        const toAbs = (href, base = 'https://www.healthecareers.com') => {
            try { return new URL(href, base).href; } catch { return null; }
        };

        const cleanText = (html) => {
            if (!html) return '';
            const $ = cheerioLoad(html);
            $('script, style, noscript, iframe').remove();
            return $.root().text().replace(/\s+/g, ' ').trim();
        };

        const buildStartUrl = (kw, loc, cat) => {
            const u = new URL('https://www.healthecareers.com/search-jobs/');
            if (kw) u.searchParams.set('profession', String(kw).trim());
            if (loc) u.searchParams.set('location', String(loc).trim());
            if (cat) u.searchParams.set('category', String(cat).trim()); // assuming category param
            return u.href;
        };

        const initial = [];
        if (Array.isArray(startUrls) && startUrls.length) initial.push(...startUrls);
        if (startUrl) initial.push(startUrl);
        if (url) initial.push(url);
        if (!initial.length) initial.push(buildStartUrl(keyword, location, category));

        const proxyConf = proxyConfiguration ? await Actor.createProxyConfiguration({ ...proxyConfiguration }) : undefined;

        let saved = 0;

        function extractFromJsonLd($) {
            const scripts = $('script[type="application/ld+json"]');
            for (let i = 0; i < scripts.length; i++) {
                try {
                    const parsed = JSON.parse($(scripts[i]).html() || '');
                    const arr = Array.isArray(parsed) ? parsed : [parsed];
                    for (const e of arr) {
                        if (!e) continue;
                        const t = e['@type'] || e.type;
                        if (t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))) {
                            return {
                                title: e.title || e.name || null,
                                company: e.hiringOrganization?.name || null,
                                date_posted: e.datePosted || null,
                                description_html: e.description || null,
                                location: (e.jobLocation && e.jobLocation.address && (e.jobLocation.address.addressLocality || e.jobLocation.address.addressRegion)) || null,
                            };
                        }
                    }
                } catch (e) { /* ignore parsing errors */ }
            }
            return null;
        }

        function findJobLinks($, base) {
            const links = new Set();
            // Primary selector: direct job links from listings
            $('a[href*="/job/"]').each((_, a) => {
                const href = $(a).attr('href');
                if (!href) return;
                const abs = toAbs(href, base);
                if (abs && /\/job\/[^/]+\/\d+/i.test(abs)) {
                    // Only add if we haven't seen it (if dedupe is enabled)
                    if (!seenUrls || !seenUrls.has(abs)) {
                        links.add(abs);
                        if (seenUrls) seenUrls.add(abs);
                    }
                }
            });
            return [...links];
        }

        function findNextPage($, base, pageNo) {
            // Look for "Next Page" link
            const nextLink = $('a').filter((_, el) => {
                const text = $(el).text().trim().toLowerCase();
                return text === 'next page' || /next\s*page/i.test(text);
            }).first().attr('href');
            
            if (nextLink) return toAbs(nextLink, base);
            
            // Look for numeric pagination links - find next number
            const currentPageNum = pageNo;
            const nextNum = currentPageNum + 1;
            const nextNumLink = $('a').filter((_, el) => {
                const text = $(el).text().trim();
                return text === String(nextNum);
            }).first().attr('href');
            
            if (nextNumLink) return toAbs(nextNumLink, base);
            
            // Check if there are any job listings on this page - if none, stop pagination
            const hasJobs = $('a[href*="/job/"]').length > 0;
            if (!hasJobs) return null;
            
            // Fallback: construct next page URL manually
            try {
                const url = new URL(base);
                const currentPage = parseInt(url.searchParams.get('page') || '1');
                url.searchParams.set('page', String(currentPage + 1));
                return url.href;
            } catch {
                return null;
            }
        }

        const crawler = new CheerioCrawler({
            proxyConfiguration: proxyConf,
            maxRequestRetries: 5,
            useSessionPool: true,
            sessionPoolOptions: {
                maxPoolSize: 50,
                sessionOptions: {
                    maxUsageCount: 30,
                    maxErrorScore: 3,
                },
            },
            maxConcurrency: 20,
            minConcurrency: 5,
            requestHandlerTimeoutSecs: 60,
            navigationTimeoutSecs: 45,
            preNavigationHooks: [
                async ({ request }) => {
                    // Use cached headers with minimal modifications for speed
                    request.headers = {
                        ...cachedHeaders,
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'Referer': request.userData.label === 'DETAIL' ? 'https://www.healthecareers.com/search-jobs' : 'https://www.healthecareers.com/',
                        'Sec-Fetch-Dest': 'document',
                        'Sec-Fetch-Mode': 'navigate',
                        'Sec-Fetch-Site': request.userData.label === 'DETAIL' ? 'same-origin' : 'none',
                        'Sec-Fetch-User': '?1',
                        'Upgrade-Insecure-Requests': '1',
                        'Cache-Control': 'max-age=0',
                    };
                    
                    // Minimal delay for stealth without sacrificing speed (50-150ms)
                    await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));
                },
            ],
            async requestHandler({ request, $, enqueueLinks, log: crawlerLog }) {
                const label = request.userData?.label || 'LIST';
                const pageNo = request.userData?.pageNo || 1;

                if (label === 'LIST') {
                    pagesProcessed++;
                    const links = findJobLinks($, request.url);
                    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                    crawlerLog.info(`LIST page ${pageNo} -> ${links.length} links | Saved: ${saved}/${RESULTS_WANTED} | ${elapsed}s`);

                    if (links.length === 0) {
                        crawlerLog.warning(`No job links on page ${pageNo}. Stopping.`);
                        return;
                    }

                    if (collectDetails) {
                        const remaining = RESULTS_WANTED - saved;
                        const toEnqueue = links.slice(0, Math.max(0, remaining));
                        if (toEnqueue.length > 0) {
                            // Enqueue with higher priority for faster processing
                            await enqueueLinks({ 
                                urls: toEnqueue, 
                                userData: { label: 'DETAIL' },
                            });
                            crawlerLog.info(`⚡ Enqueued ${toEnqueue.length} detail pages`);
                        }
                    } else {
                        const remaining = RESULTS_WANTED - saved;
                        const toPush = links.slice(0, Math.max(0, remaining));
                        if (toPush.length > 0) { 
                            await Dataset.pushData(toPush.map(u => ({ url: u, _source: 'healthecareers' }))); 
                            saved += toPush.length;
                        }
                    }

                    // Aggressive pagination for speed
                    if (saved < RESULTS_WANTED && pageNo < MAX_PAGES && links.length > 0) {
                        const next = findNextPage($, request.url, pageNo);
                        if (next && next !== request.url) {
                            // Enqueue next page immediately without waiting
                            await enqueueLinks({ 
                                urls: [next], 
                                userData: { label: 'LIST', pageNo: pageNo + 1 },
                            });
                        }
                    }
                    return;
                }

                if (label === 'DETAIL') {
                    if (saved >= RESULTS_WANTED) return;
                    
                    detailsProcessed++;
                    try {
                        // Try JSON-LD first (fastest)
                        const json = extractFromJsonLd($);
                        const data = json || {};
                        
                        // Extract title - multiple fallbacks
                        if (!data.title) {
                            data.title = $('h1').first().text().trim() 
                                || $('h1.job-title, h1[class*="title"]').first().text().trim()
                                || $('meta[property="og:title"]').attr('content')
                                || null;
                        }
                        
                        // Extract company - check meta tags and common selectors
                        if (!data.company) {
                            data.company = $('[class*="employer"], [class*="company"], .company-name').first().text().trim()
                                || $('a[href*="/employer"]').first().text().trim()
                                || $('meta[property="og:site_name"]').attr('content')
                                || null;
                        }
                        
                        // Extract location - multiple selectors
                        if (!data.location) {
                            data.location = $('[class*="location"]').first().text().trim()
                                || $('[class*="city"], [class*="state"]').first().text().trim()
                                || null;
                        }
                        
                        // Extract salary if available
                        const salary = $('[class*="salary"], [class*="compensation"], [class*="pay"]').first().text().trim() || null;
                        
                        // Extract description efficiently
                        if (!data.description_html) {
                            const descContainer = $('[class*="job-description"], .job-content, .description, article').first();
                            if (descContainer && descContainer.length) {
                                // Quick cleanup
                                descContainer.find('script, style, iframe').remove();
                                data.description_html = String(descContainer.html()).trim() || null;
                            } else {
                                // Fast fallback - get main content
                                const mainContent = $('main, article, [role="main"]').first().html();
                                data.description_html = mainContent || null;
                            }
                        }
                        
                        data.description_text = data.description_html ? cleanText(data.description_html) : null;
                        
                        // Extract benefits/job type if visible
                        const benefits = [];
                        $('[class*="benefit"], [class*="perk"], .job-tags span, .job-type').each((_, el) => {
                            const text = $(el).text().trim();
                            if (text && text.length < 50) benefits.push(text);
                        });

                        const item = {
                            title: data.title || null,
                            company: data.company || null,
                            category: category || null,
                            location: data.location || null,
                            salary: salary || null,
                            date_posted: data.date_posted || null,
                            benefits: benefits.length > 0 ? benefits : null,
                            description_html: data.description_html || null,
                            description_text: data.description_text || null,
                            url: request.url,
                        };

                        // Quick save with minimal logging
                        if (item.title) {
                            await Dataset.pushData(item);
                            saved++;
                            // Log every 10th job to reduce overhead
                            if (saved % 10 === 0 || saved === RESULTS_WANTED) {
                                const rate = (saved / ((Date.now() - startTime) / 1000)).toFixed(1);
                                crawlerLog.info(`✓ Progress: ${saved}/${RESULTS_WANTED} jobs (${rate}/s) | "${item.title}"`);
                            }
                        }
                    } catch (err) { 
                        crawlerLog.error(`DETAIL ${request.url} failed: ${err.message}`, { stack: err.stack }); 
                    }
                }
            }
        });

        log.info(`🚀 Starting high-speed crawler`);
        log.info(`   URLs: ${initial.length} | Target: ${RESULTS_WANTED} | Concurrency: 20 | Details: ${collectDetails}`);
        
        await crawler.run(initial.map(u => ({ url: u, userData: { label: 'LIST', pageNo: 1 } })));
        
        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
        const stats = await Dataset.getData();
        const avgRate = (saved / (totalTime / 60)).toFixed(1);
        
        log.info(`✅ Scraping completed in ${totalTime}s`);
        log.info(`   Jobs saved: ${saved} | Pages: ${pagesProcessed} | Details: ${detailsProcessed}`);
        log.info(`   Average rate: ${avgRate} jobs/min`);
        log.info(`   Unique URLs: ${seenUrls ? seenUrls.size : 'N/A'}`);
        log.info(`   Dataset items: ${stats.items.length}`);
    } catch (error) {
        log.error(`Fatal error in main: ${error.message}`, { stack: error.stack });
        throw error;
    } finally {
        await Actor.exit();
    }
}

main().catch(err => { 
    console.error('Unhandled error:', err); 
    process.exit(1); 
});
