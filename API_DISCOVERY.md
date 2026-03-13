## Selected API
- Endpoint: `https://www.healthecareers.com/api/jobs`
- Method: `GET`
- Auth: None
- Pagination: `pg` (page number), `ps` (page size)
- Query params used: `siteCode=hecc`, `keyword`, `LocationText`, `catid`, `s`, `Radius`
- Fields available (list payload):
  - `id`, `jobCode`, `title`, `headline`, `jobDetailUrl`, `jobDetailUrlRelative`
  - `postedDate`, `postedDatePhrase`, `profession`, `remote`, `isSponsored`, `contractType`, `applyType`
  - `location.*`, `locationText`, `employer.*`, `employerDisplayName`, `employerLogoUrl`
  - `disciplines[]`, `specialties[]`, `tags[]`, compensation fields, and status flags
- Estimated unique field paths (first payload): **65**

## Detail API
- Endpoint: `https://www.healthecareers.com/api/jobs/job-details?jobCode=<jobCode>`
- Method: `GET`
- Auth: None
- Pagination: N/A (single job)
- Fields available (detail payload):
  - Full job description (`description`, `descriptionWithDCH`)
  - Employer profile payload (`employerProfile.*`)
  - Compensation object (`jobCompensation.*`)
  - Job categories/tags/work hours, apply method metadata, geo fields
- Estimated unique field paths (first payload): **160**

## Candidate Scoring
### Candidate A
- Endpoint: `GET /api/jobs?siteCode=hecc...`
- Returns JSON directly: +30
- >15 unique fields: +25
- No auth required: +20
- Pagination support: +15
- Matches/extends current fields: +10
- **Total: 100/100**

### Candidate B
- Endpoint: `GET /api/jobs/job-details?jobCode=...`
- Returns JSON directly: +30
- >15 unique fields: +25
- No auth required: +20
- Pagination support: +0
- Matches/extends current fields: +10
- **Total: 85/100**

## Existing vs New Field Coverage
- Existing actor fields (HTML-based): `title`, `company`, `category`, `location`, `salary`, `date_posted`, `benefits`, `description_html`, `description_text`, `url`
- Newly available examples from API:
  - `id`, `jobCode`, `headline`, `postedDatePhrase`, `applyMethod`, `contractType`, `remote`
  - `employerProfile.*`, `jobCompensation.*`, `jobCategories.*`, `jobTags.*`
  - `latitude`, `longitude`, `workHours`, `atsType`, `atsTech`, `productCode`

## Selected Implementation
Use `GET /api/jobs` as the primary listing source and enrich each listing with `GET /api/jobs/job-details?jobCode=...` when `collectDetails=true`.
