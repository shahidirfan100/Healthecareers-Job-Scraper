import { Actor, log } from 'apify';
import { Dataset } from 'crawlee';
import { gotScraping } from 'got-scraping';

const BASE_URL = 'https://www.healthecareers.com';
const LIST_ENDPOINT = `${BASE_URL}/api/jobs`;
const DETAIL_ENDPOINT = `${BASE_URL}/api/jobs/job-details`;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const DETAIL_BATCH_SIZE = 10;

const toPositiveInt = (value, fallback = undefined) => {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return fallback;
    return Math.floor(num);
};

const normalizeLimit = (value) => {
    if (value === undefined || value === null || value === '') return Number.MAX_SAFE_INTEGER;
    return toPositiveInt(value, Number.MAX_SAFE_INTEGER);
};

const toAbsoluteUrl = (value) => {
    if (!value) return undefined;
    try {
        return new URL(value, BASE_URL).href;
    } catch {
        return undefined;
    }
};

const stripHtml = (html) => {
    if (typeof html !== 'string' || html.trim() === '') return undefined;
    return html
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() || undefined;
};

const uniqueStrings = (values) => {
    const seen = new Set();
    const out = [];
    for (const raw of values) {
        if (typeof raw !== 'string') continue;
        const value = raw.trim();
        if (!value || seen.has(value)) continue;
        seen.add(value);
        out.push(value);
    }
    return out;
};

const cleanValue = (value) => {
    if (value === null || value === undefined) return undefined;

    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed === '' ? undefined : trimmed;
    }

    if (Array.isArray(value)) {
        const cleaned = value.map(cleanValue).filter((item) => item !== undefined);
        return cleaned.length ? cleaned : undefined;
    }

    if (typeof value === 'object') {
        const out = {};
        for (const [key, val] of Object.entries(value)) {
            const cleaned = cleanValue(val);
            if (cleaned !== undefined) out[key] = cleaned;
        }
        return Object.keys(out).length ? out : undefined;
    }

    return value;
};

const parseUrlInput = (candidates) => {
    for (const raw of candidates) {
        if (!raw || typeof raw !== 'string') continue;
        try {
            const parsed = new URL(raw);
            if (!parsed.hostname.includes('healthecareers.com')) continue;
            return {
                keyword: parsed.searchParams.get('keyword')
                    || parsed.searchParams.get('profession')
                    || '',
                location: parsed.searchParams.get('LocationText')
                    || parsed.searchParams.get('locationText')
                    || parsed.searchParams.get('location')
                    || '',
                category: parsed.searchParams.get('catid') || '',
                page: toPositiveInt(parsed.searchParams.get('pg') || parsed.searchParams.get('page'), 1),
                pageSize: toPositiveInt(parsed.searchParams.get('ps'), undefined),
                sort: parsed.searchParams.get('s') || '',
                radius: parsed.searchParams.get('Radius') || parsed.searchParams.get('Search_Radius') || '',
            };
        } catch {
            // Ignore malformed URLs.
        }
    }
    return {};
};

const getJobsBlock = (payload) => {
    if (Array.isArray(payload?.jobs)) return payload.jobs[0] || {};
    if (payload?.jobs && typeof payload.jobs === 'object') return payload.jobs;
    return {};
};

const extractTagNames = (listing, details) => uniqueStrings([
    ...(Array.isArray(listing?.tags) ? listing.tags.map((tag) => tag?.name) : []),
    ...(Array.isArray(details?.jobTags) ? details.jobTags.map((tag) => tag?.tagName) : []),
]);

const extractDisciplineNames = (listing) => uniqueStrings([
    ...(Array.isArray(listing?.disciplines) ? listing.disciplines.map((item) => item?.name) : []),
]);

const extractSpecialtyNames = (listing) => uniqueStrings([
    ...(Array.isArray(listing?.specialties) ? listing.specialties : []),
]);

const extractEmploymentTypes = (details) => uniqueStrings([
    ...(Array.isArray(details?.employmentTypes) ? details.employmentTypes.map((item) => item?.name) : []),
]);

const extractImageUrls = (listing, details) => uniqueStrings([
    listing?.employerLogoUrl,
    details?.employerLogoUrl,
    details?.employerProfile?.logo?.url,
    details?.employerProfile?.enhancedJobPosting?.banner?.url,
    ...(Array.isArray(details?.associationLogos) ? details.associationLogos.map((logo) => logo?.url) : []),
]);

const buildCleanRecord = (listing, details) => {
    const jobCode = details?.jobCode ?? listing?.jobCode;
    const descriptionHtml = details?.description || details?.descriptionWithDCH;
    const imageUrls = extractImageUrls(listing, details);

    const compensationMin = details?.jobCompensation?.compensationRangeMin ?? listing?.compensationRangeMin;
    const compensationMax = details?.jobCompensation?.compensationRangeMax ?? listing?.compensationRangeMax;
    const compensationUnit = details?.jobCompensation?.compensationRangeUnit ?? listing?.compensationRangeUnit;

    const record = {
        id: details?.id || listing?.id,
        jobCode: jobCode !== undefined && jobCode !== null ? String(jobCode) : undefined,
        title: details?.title || listing?.title,
        headline: details?.headline || listing?.headline,
        url: toAbsoluteUrl(details?.jobDetailUrl || listing?.jobDetailUrl || listing?.jobDetailUrlRelative || details?.staticSearchUrl),
        postedDate: details?.postedDate || listing?.postedDate,
        postedDatePhrase: listing?.postedDatePhrase,

        companyId: details?.employer?.id || listing?.employer?.id,
        companyName: details?.employerDisplayName || listing?.employerDisplayName || details?.employer?.name || listing?.employer?.name,
        companyProfileUrl: toAbsoluteUrl(details?.employerProfileUrl),

        locationText: details?.locationText || listing?.locationText || listing?.location?.description || details?.addressText,
        city: details?.city || listing?.location?.city,
        state: details?.state || listing?.location?.stateCode,
        countryCode: details?.countryCode || listing?.location?.countryCode,
        latitude: details?.latitude ?? listing?.location?.latitude,
        longitude: details?.longitude ?? listing?.location?.longitude,

        profession: listing?.profession,
        category: listing?.assignedJobCategoryName,
        employmentTypes: extractEmploymentTypes(details),
        disciplines: extractDisciplineNames(listing),
        specialties: extractSpecialtyNames(listing),
        tags: extractTagNames(listing, details),

        applyType: listing?.applyType,
        applyMethod: details?.applyMethod?.name,
        contractType: listing?.contractType,
        isRemote: details?.isRemote ?? listing?.remote,
        isSponsored: listing?.isSponsored,

        hasCompensation: listing?.hasCompensation || Number(compensationMin) > 0 || Number(compensationMax) > 0,
        compensationMin,
        compensationMax,
        compensationUnit,

        descriptionText: stripHtml(descriptionHtml),
        imageUrls,
        source: 'healthecareers',
    };

    return cleanValue(record);
};

await Actor.init();

try {
    // Runtime input from Apify UI/API always has priority. INPUT.json is only local fallback.
    const input = (await Actor.getInput()) || {};
    const {
        keyword = '',
        location = '',
        category = '',
        results_wanted: resultsWantedRaw = 20,
        max_pages: maxPagesRaw = 20,
        startUrl,
        start_url,
        startUrls,
        url,
        proxyConfiguration: proxyConfig,
    } = input;

    const parsedFromUrl = parseUrlInput([
        start_url,
        startUrl,
        url,
        ...(Array.isArray(startUrls) ? startUrls : []),
    ]);

    const searchKeyword = (keyword || parsedFromUrl.keyword || '').trim();
    const searchLocation = (location || parsedFromUrl.location || '').trim();
    const searchCategory = (category || parsedFromUrl.category || '').trim();
    const sort = (input.s || input.sort || parsedFromUrl.sort || '').trim();
    const radius = String(input.Radius || input.Search_Radius || parsedFromUrl.radius || '').trim();

    const resultsWanted = normalizeLimit(resultsWantedRaw);
    const maxPages = toPositiveInt(maxPagesRaw, 20);
    const initialPage = toPositiveInt(input.pg || parsedFromUrl.page, 1);
    const inputPageSize = toPositiveInt(input.ps || parsedFromUrl.pageSize, DEFAULT_PAGE_SIZE);
    const stablePageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, inputPageSize));

    const proxyConfiguration = proxyConfig
        ? await Actor.createProxyConfiguration({ ...proxyConfig })
        : undefined;

    const requestJson = async (urlToFetch, referer = `${BASE_URL}/search-jobs/`) => {
        const proxyUrl = proxyConfiguration ? await proxyConfiguration.newUrl() : undefined;
        const response = await gotScraping.get(urlToFetch, {
            proxyUrl,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': referer,
                'Origin': BASE_URL,
            },
            timeout: { request: 30000 },
            retry: { limit: 2 },
        });
        return JSON.parse(response.body);
    };

    const buildListUrl = (page, pageSize) => {
        const apiUrl = new URL(LIST_ENDPOINT);
        apiUrl.searchParams.set('siteCode', 'hecc');
        apiUrl.searchParams.set('pg', String(page));
        apiUrl.searchParams.set('ps', String(pageSize));
        if (searchKeyword) apiUrl.searchParams.set('keyword', searchKeyword);
        if (searchLocation) apiUrl.searchParams.set('LocationText', searchLocation);
        if (searchCategory) apiUrl.searchParams.set('catid', searchCategory);
        if (sort) apiUrl.searchParams.set('s', sort);
        if (radius) apiUrl.searchParams.set('Radius', radius);
        return apiUrl.href;
    };

    const fetchDetails = async (jobCode) => {
        if (!jobCode) return undefined;
        const detailUrl = `${DETAIL_ENDPOINT}?jobCode=${encodeURIComponent(String(jobCode))}`;
        try {
            return await requestJson(detailUrl, `${BASE_URL}/job/${jobCode}`);
        } catch (err) {
            log.warning(`Details fetch failed for ${jobCode}: ${err.message}`);
            return undefined;
        }
    };

    const seenRecordKeys = new Set();
    let page = initialPage;
    let saved = 0;
    let pagesProcessed = 0;
    let totalScanned = 0;
    const startedAt = Date.now();

    while (saved < resultsWanted && pagesProcessed < maxPages) {
        const listUrl = buildListUrl(page, stablePageSize);
        log.info(`Fetching page ${page} (${stablePageSize} results): ${listUrl}`);

        let payload;
        try {
            payload = await requestJson(listUrl);
        } catch (err) {
            log.error(`List API failed on page ${page}: ${err.message}`);
            break;
        }

        const jobsBlock = getJobsBlock(payload);
        const jobs = Array.isArray(jobsBlock.jobs) ? jobsBlock.jobs : [];
        const totalPages = toPositiveInt(payload?.meta?.totalPages || jobsBlock.totalPages, undefined);

        pagesProcessed++;
        totalScanned += jobs.length;

        if (!jobs.length) {
            log.info('No jobs returned. Stopping pagination.');
            break;
        }

        const remaining = resultsWanted - saved;
        const pageJobs = jobs.slice(0, Math.max(0, remaining));

        for (let i = 0; i < pageJobs.length && saved < resultsWanted; i += DETAIL_BATCH_SIZE) {
            const chunk = pageJobs.slice(i, i + DETAIL_BATCH_SIZE);
            const enriched = await Promise.all(chunk.map(async (job) => ({
                listing: job,
                details: await fetchDetails(job?.jobCode),
            })));

            for (const { listing, details } of enriched) {
                if (saved >= resultsWanted) break;
                const record = buildCleanRecord(listing, details);
                if (!record) continue;

                const dedupeKey = String(record.id || record.jobCode || record.url || listing?.jobCode || '');
                if (dedupeKey && seenRecordKeys.has(dedupeKey)) continue;
                if (dedupeKey) seenRecordKeys.add(dedupeKey);

                await Dataset.pushData(record);
                saved++;
            }
        }

        const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
        log.info(`Page ${page} processed. Saved ${saved}/${resultsWanted}. Elapsed ${elapsed}s.`);

        if (jobs.length < stablePageSize) {
            log.info('Last page reached (fewer results than requested page size).');
            break;
        }
        if (totalPages && page >= totalPages) {
            log.info(`Reached final page ${totalPages}.`);
            break;
        }
        page++;
    }

    const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    log.info(`Extraction complete in ${elapsedSeconds}s.`);
    log.info(`Pages processed: ${pagesProcessed}`);
    log.info(`Jobs scanned: ${totalScanned}`);
    log.info(`Jobs saved: ${saved}`);
    log.info(`Dataset non-empty: ${saved > 0 ? 'yes' : 'no'}`);
} catch (error) {
    log.error(`Fatal error: ${error.message}`, { stack: error.stack });
    throw error;
} finally {
    await Actor.exit();
}
