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
        
        const headerGenerator = new HeaderGenerator();
        const seenUrls = dedupe ? new Set() : null;

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
            maxConcurrency: 5,
            minConcurrency: 1,
            requestHandlerTimeoutSecs: 90,
            navigationTimeoutSecs: 60,
            preNavigationHooks: [
                async ({ request }) => {
                    // Generate realistic headers for stealth
                    const headers = headerGenerator.getHeaders({
                        browsers: [{ name: 'chrome', minVersion: 110, maxVersion: 120 }],
                        operatingSystems: ['windows', 'macos'],
                        devices: ['desktop'],
                        locales: ['en-US'],
                    });
                    
                    request.headers = {
                        ...headers,
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'Referer': request.userData.label === 'DETAIL' ? 'https://www.healthecareers.com/search-jobs' : 'https://www.healthecareers.com/',
                        'Sec-Fetch-Dest': 'document',
                        'Sec-Fetch-Mode': 'navigate',
                        'Sec-Fetch-Site': request.userData.label === 'DETAIL' ? 'same-origin' : 'none',
                        'Sec-Fetch-User': '?1',
                        'Upgrade-Insecure-Requests': '1',
                    };
                    
                    // Add small random delay between requests (100-500ms)
                    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 400));
                },
            ],
            async requestHandler({ request, $, enqueueLinks, log: crawlerLog }) {
                const label = request.userData?.label || 'LIST';
                const pageNo = request.userData?.pageNo || 1;

                if (label === 'LIST') {
                    const links = findJobLinks($, request.url);
                    crawlerLog.info(`LIST page ${pageNo} (${request.url}) -> found ${links.length} unique job links | Total saved: ${saved}/${RESULTS_WANTED}`);

                    if (links.length === 0) {
                        crawlerLog.warning(`No job links found on page ${pageNo}. Stopping pagination.`);
                        return;
                    }

                    if (collectDetails) {
                        const remaining = RESULTS_WANTED - saved;
                        const toEnqueue = links.slice(0, Math.max(0, remaining));
                        if (toEnqueue.length > 0) {
                            await enqueueLinks({ urls: toEnqueue, userData: { label: 'DETAIL' } });
                            crawlerLog.info(`Enqueued ${toEnqueue.length} job detail pages for scraping`);
                        }
                    } else {
                        const remaining = RESULTS_WANTED - saved;
                        const toPush = links.slice(0, Math.max(0, remaining));
                        if (toPush.length > 0) { 
                            await Dataset.pushData(toPush.map(u => ({ url: u, _source: 'healthecareers' }))); 
                            saved += toPush.length;
                            crawlerLog.info(`Saved ${toPush.length} job URLs without details`);
                        }
                    }

                    if (saved < RESULTS_WANTED && pageNo < MAX_PAGES && links.length > 0) {
                        const next = findNextPage($, request.url, pageNo);
                        if (next && next !== request.url) {
                            await enqueueLinks({ urls: [next], userData: { label: 'LIST', pageNo: pageNo + 1 } });
                            crawlerLog.info(`Proceeding to page ${pageNo + 1}`);
                        } else {
                            crawlerLog.info(`No more pages to crawl. Stopping pagination.`);
                        }
                    }
                    return;
                }

                if (label === 'DETAIL') {
                    if (saved >= RESULTS_WANTED) {
                        crawlerLog.info(`Already reached target of ${RESULTS_WANTED} jobs. Skipping.`);
                        return;
                    }
                    
                    try {
                        // Try JSON-LD first
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
                        
                        // Extract description - look in main content area
                        if (!data.description_html) {
                            const descContainer = $('[class*="job-description"], .job-content, .description, article, main').first();
                            if (descContainer && descContainer.length) {
                                // Remove unwanted elements
                                descContainer.find('script, style, noscript, iframe, .social-share, .similar-jobs').remove();
                                data.description_html = String(descContainer.html()).trim() || null;
                            }
                        }
                        
                        // If still no description, try broader selectors
                        if (!data.description_html) {
                            const bodyText = $('body').html();
                            if (bodyText && bodyText.length > 200) {
                                data.description_html = bodyText;
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

                        // Only save if we have at least title
                        if (item.title) {
                            await Dataset.pushData(item);
                            saved++;
                            crawlerLog.info(`✓ Saved job #${saved}: "${item.title}" at ${item.company || 'N/A'}`);
                        } else {
                            crawlerLog.warning(`Skipped job at ${request.url} - no title found`);
                        }
                    } catch (err) { 
                        crawlerLog.error(`DETAIL ${request.url} failed: ${err.message}`, { stack: err.stack }); 
                    }
                }
            }
        });

        log.info(`Starting crawler with ${initial.length} initial URL(s):`);
        initial.forEach((url, i) => log.info(`  ${i + 1}. ${url}`));
        log.info(`Target: ${RESULTS_WANTED} jobs | Max pages: ${MAX_PAGES} | Collect details: ${collectDetails} | Dedupe: ${dedupe}`);
        
        await crawler.run(initial.map(u => ({ url: u, userData: { label: 'LIST', pageNo: 1 } })));
        
        const stats = await Dataset.getData();
        log.info(`✓ Scraping completed successfully!`);
        log.info(`  Total jobs saved: ${saved}`);
        log.info(`  Dataset items: ${stats.items.length}`);
        log.info(`  Unique URLs seen: ${seenUrls ? seenUrls.size : 'N/A (dedupe disabled)'}`);
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
