# Healthecareers Jobs Scraper

Extract clean healthcare job data from Healthecareers at scale. Collect job titles, locations, company info, tags, compensation signals, and readable descriptions in a structured dataset. Built for recruiting teams, job intelligence workflows, and healthcare market analysis.

## Features

- **Clean output** — Returns normalized fields with duplicate records removed.
- **Rich listings data** — Captures title, location, company, specialties, tags, and apply metadata.
- **Readable descriptions** — Converts long job descriptions into plain text for analysis.
- **Image URL extraction** — Saves direct image URLs only, without nested image-size objects.
- **Flexible search input** — Supports keyword/location search or a direct Healthecareers search URL.
- **Fast collection** — Handles pagination efficiently to reach your requested results quickly.

## Use Cases

### Recruitment Intelligence
Track open healthcare roles by specialty, region, and employer. Build sourcing lists and monitor changing demand over time.

### Job Board Aggregation
Import structured listings into internal tools, search portals, or candidate-matching systems with minimal cleanup.

### Compensation and Demand Analysis
Analyze compensation ranges, role types, and category trends across markets for strategic hiring decisions.

### Employer Monitoring
Monitor employer hiring activity, role mix, and location expansion to support business development and sales outreach.

---

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `startUrl` | String | No | — | Direct Healthecareers search URL to start from. |
| `keyword` | String | No | `"nurse"` | Job keyword to search (used when `startUrl` is not provided). |
| `location` | String | No | — | Location filter such as city/state. |
| `results_wanted` | Integer | No | `20` | Maximum number of jobs to save. |
| `max_pages` | Integer | No | `20` | Safety cap for pagination depth. |
| `proxyConfiguration` | Object | No | `{"useApifyProxy": false}` | Optional proxy configuration for reliability on larger runs. |

---

## Output Data

Each dataset item contains:

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Unique listing identifier. |
| `jobCode` | String | Numeric job code from source. |
| `title` | String | Job title. |
| `headline` | String | Short listing summary. |
| `url` | String | Canonical job URL. |
| `postedDate` | String | Posted date/time from source. |
| `postedDatePhrase` | String | Relative posting age (for example, `2 days ago`). |
| `companyId` | String | Employer identifier. |
| `companyName` | String | Employer name. |
| `companyProfileUrl` | String | Employer profile URL when available. |
| `locationText` | String | Human-readable location string. |
| `city` | String | Job city. |
| `state` | String | Job state/region. |
| `countryCode` | String | Job country code. |
| `latitude` | Number | Latitude when available. |
| `longitude` | Number | Longitude when available. |
| `profession` | String | Profession group. |
| `category` | String | Assigned job category. |
| `employmentTypes` | Array | Employment type labels. |
| `disciplines` | Array | Discipline labels. |
| `specialties` | Array | Specialty labels. |
| `tags` | Array | Clean tag names only. |
| `applyType` | String | Apply type label. |
| `applyMethod` | String | Apply method label. |
| `contractType` | String | Contract type label. |
| `isRemote` | Boolean | Remote flag. |
| `isSponsored` | Boolean | Sponsored listing flag. |
| `hasCompensation` | Boolean | Compensation availability signal. |
| `compensationMin` | Number | Minimum compensation when available. |
| `compensationMax` | Number | Maximum compensation when available. |
| `compensationUnit` | String | Compensation unit when available. |
| `descriptionText` | String | Plain-text description. |
| `imageUrls` | Array | Direct image URLs only. |
| `source` | String | Source marker (`healthecareers`). |

---

## Usage Examples

### Basic Keyword Search

```json
{
  "keyword": "nurse",
  "location": "California",
  "results_wanted": 20
}
```

### Physician Search with Higher Volume

```json
{
  "keyword": "physician",
  "results_wanted": 100,
  "max_pages": 20
}
```

### Start from a Custom Search URL

```json
{
  "startUrl": "https://www.healthecareers.com/search-jobs?profession=pharmacist&location=Texas",
  "results_wanted": 50
}
```

---

## Sample Output

```json
{
  "id": "54290198-853d-4ee4-a255-0675c0a917b2",
  "jobCode": "9629868",
  "title": "Gynecologist Opportunity-Viera, FL | Beach Living, Minimal Call & Signing Bonus!",
  "url": "https://www.healthecareers.com/job/gynecologist-opportunity-viera-fl-beach-living-minimal-call-signing-bonus/9629868",
  "companyName": "Unified Women's Healthcare",
  "locationText": "Melbourne, Florida",
  "profession": "Physician / Surgeon",
  "tags": ["Private Practice", "Hospital", "Full-Time"],
  "descriptionText": "Overview Florida Woman Care is seeking a Board-Certified or Board-Eligible Gynecologist...",
  "imageUrls": [
    "https://media.healthecareers.com/wp-content/uploads/2022/02/30143502/Unified-Womens-Healthcares-Logo.png"
  ],
  "source": "healthecareers"
}
```

---

## Tips for Best Results

### Start Small
- Run with `results_wanted: 20` first to validate filters.
- Increase result limits after confirming output quality.

### Improve Relevance
- Use specific keywords (for example, `pediatric nurse practitioner` instead of `nurse`).
- Combine keyword and location for tighter results.

### Use Proxy for Stability
- Keep Apify Proxy enabled for production runs.
- Use scheduling for recurring monitoring workflows.

---

## Integrations

Connect the dataset with:

- **Google Sheets** — Reporting and recruiter dashboards.
- **Airtable** — Searchable hiring intelligence tables.
- **Make** — Automated enrichment and notifications.
- **Zapier** — Trigger downstream workflows.
- **Webhooks** — Push results into internal systems.

### Export Formats

- **JSON** — APIs and custom apps
- **CSV** — Spreadsheets and BI tools
- **Excel** — Business reporting

---

## Frequently Asked Questions

### Does user input override defaults?
Yes. Runtime input always has priority. Defaults are used only when a value is not provided.

### Is `INPUT.json` used in production?
No. `INPUT.json` is for local testing only.

### Can I use only `startUrl` without keyword/location?
Yes. If `startUrl` is provided, it can drive the run without separate keyword/location values.

### Does the output include duplicate records?
No. The actor deduplicates records before saving.

### Are tag IDs and nested image sizes included?
No. Tags are simplified to names, and images are direct URLs only.

---

## Support

For issues or feature requests, use Apify Console support channels.

### Resources

- [Apify Documentation](https://docs.apify.com/)
- [Apify API Reference](https://docs.apify.com/api/v2)
- [Apify Scheduling](https://docs.apify.com/platform/schedules)

---

## Legal Notice

Use this actor responsibly and in compliance with website terms and applicable laws. You are responsible for your own data collection and usage practices.
