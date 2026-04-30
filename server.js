const http = require('http');
const https = require('https');

// ── Config (set these as environment variables in Railway) ──
const MORAWARE_URL = process.env.MORAWARE_URL; // e.g. https://canadiancountertops.moraware.net/api.aspx
const MORAWARE_USER = process.env.MORAWARE_USER;
const MORAWARE_PASS = process.env.MORAWARE_PASS;
const PORT = process.env.PORT || 3000;

// ── CORS helper ──
function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ── Call Moraware XML API ──
function morawareRequest(xmlBody) {
  return new Promise((resolve, reject) => {
    const url = new URL(MORAWARE_URL);
    const auth = Buffer.from(`${MORAWARE_USER}:${MORAWARE_PASS}`).toString('base64');

    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'Authorization': `Basic ${auth}`,
        'Content-Length': Buffer.byteLength(xmlBody),
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });

    req.on('error', reject);
    req.write(xmlBody);
    req.end();
  });
}

// ── Parse simple XML values ──
function extractXMLValues(xml, tag) {
  const regex = new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`, 'g');
  const results = [];
  let match;
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[1].trim());
  }
  return results;
}

function extractBetween(xml, openTag, closeTag) {
  const blocks = [];
  let start = 0;
  while (true) {
    const s = xml.indexOf(openTag, start);
    if (s === -1) break;
    const e = xml.indexOf(closeTag, s);
    if (e === -1) break;
    blocks.push(xml.substring(s + openTag.length, e));
    start = e + closeTag.length;
  }
  return blocks;
}

// ── Build GetJobs XML request ──
function buildGetJobsXML() {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetJobs xmlns="http://moraware.com/JobTrackerAPI5">
      <filter>
        <IncludeJobPhases>true</IncludeJobPhases>
      </filter>
    </GetJobs>
  </soap:Body>
</soap:Envelope>`;
}

// ── Parse jobs from XML response ──
function parseJobs(xml) {
  const jobBlocks = extractBetween(xml, '<Job>', '</Job>');

  return jobBlocks.map(block => {
    const get = (tag) => {
      const m = block.match(new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`));
      return m ? m[1].trim() : '';
    };

    // Extract activities (schedule events)
    const activities = extractBetween(block, '<JobActivity>', '</JobActivity>').map(a => {
      const ag = (tag) => {
        const m = a.match(new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`));
        return m ? m[1].trim() : '';
      };
      return {
        name: ag('Name'),
        status: ag('StatusName'),
        scheduledDate: ag('ScheduledDate'),
        assignee: ag('AssigneeName'),
      };
    });

    // Find measure, install, repair dates from activities
    const findActivity = (keywords) => activities.find(a =>
      keywords.some(k => a.name.toLowerCase().includes(k.toLowerCase()))
    );

    const measureActivity = findActivity(['measure', 'template', 'template/measure']);
    const installActivity = findActivity(['install', 'installation']);
    const repairActivity  = findActivity(['repair', 'service', 'warranty']);

    return {
      id: get('JobNumber') || get('Id'),
      customer: get('AccountName') || get('CustomerName') || 'Unknown',
      email: get('Email') || '',
      phone: get('Phone') || '',
      job: get('Name') || get('JobName') || 'Job',
      status: get('PhaseName') || get('StatusName') || 'Scheduled',
      assignee: get('AssigneeName') || get('SalespersonName') || '—',
      installDate: installActivity?.scheduledDate || get('InstallDate') || null,
      measureDate: measureActivity?.scheduledDate || get('MeasureDate') || null,
      repairDate:  repairActivity?.scheduledDate  || null,
      activities,
    };
  });
}

// ── HTTP Server ──
const server = http.createServer(async (req, res) => {
  setCORS(res);

  // Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', moraware: MORAWARE_URL ? 'configured' : 'not configured' }));
    return;
  }

  // GET /jobs — fetch all jobs from Moraware
  if (req.url === '/jobs' && req.method === 'GET') {
    if (!MORAWARE_URL || !MORAWARE_USER || !MORAWARE_PASS) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Moraware credentials not configured. Set MORAWARE_URL, MORAWARE_USER, MORAWARE_PASS environment variables.' }));
      return;
    }

    try {
      console.log(`[${new Date().toISOString()}] Fetching jobs from Moraware...`);
      const xml = await morawareRequest(buildGetJobsXML());
      const jobs = parseJobs(xml);
      console.log(`[${new Date().toISOString()}] Fetched ${jobs.length} jobs`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jobs, count: jobs.length, fetched: new Date().toISOString() }));
    } catch (err) {
      console.error('Moraware error:', err.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to connect to Moraware', detail: err.message }));
    }
    return;
  }

  // GET /jobs/:email — get jobs for a specific customer email (for magic link portal)
  const emailMatch = req.url.match(/^\/jobs\/(.+)$/);
  if (emailMatch && req.method === 'GET') {
    const email = decodeURIComponent(emailMatch[1]).toLowerCase();

    try {
      const xml = await morawareRequest(buildGetJobsXML());
      const allJobs = parseJobs(xml);
      const customerJobs = allJobs.filter(j => j.email.toLowerCase() === email);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jobs: customerJobs, count: customerJobs.length }));
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to connect to Moraware', detail: err.message }));
    }
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found. Available endpoints: GET /jobs, GET /jobs/:email, GET /health' }));
});

server.listen(PORT, () => {
  console.log(`Canadian Countertops — Moraware API Server`);
  console.log(`Running on port ${PORT}`);
  console.log(`Moraware URL: ${MORAWARE_URL || 'NOT SET'}`);
  console.log(`Endpoints: GET /jobs  |  GET /jobs/:email  |  GET /health`);
});
