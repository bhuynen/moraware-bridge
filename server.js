const http = require('http');
const https = require('https');
const MORAWARE_URL = process.env.MORAWARE_URL;
const MORAWARE_USER = process.env.MORAWARE_USER;
const MORAWARE_PASS = process.env.MORAWARE_PASS;
const PORT = process.env.PORT || 3000;
function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function morawareRequest(xmlBody) {
  return new Promise((resolve, reject) => {
    const url = new URL(MORAWARE_URL);
    const auth = Buffer.from(`${MORAWARE_USER}:${MORAWARE_PASS}`).toString('base64');
    const options = { hostname: url.hostname, path: url.pathname, method: 'POST', headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Authorization': `Basic ${auth}`, 'Content-Length': Buffer.byteLength(xmlBody) } };
    const req = https.request(options, (res) => { let data = ''; res.on('data', chunk => data += chunk); res.on('end', () => resolve(data)); });
    req.on('error', reject);
    req.write(xmlBody);
    req.end();
  });
}
function extractBetween(xml, openTag, closeTag) {
  const blocks = []; let start = 0;
  while (true) { const s = xml.indexOf(openTag, start); if (s === -1) break; const e = xml.indexOf(closeTag, s); if (e === -1) break; blocks.push(xml.substring(s + openTag.length, e)); start = e + closeTag.length; }
  return blocks;
}
function buildGetJobsXML() {
  return `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><soap:Body><GetJobs xmlns="http://moraware.com/JobTrackerAPI5"><filter xsi:type="JobFilter"><GetAll>true</GetAll></filter></GetJobs></soap:Body></soap:Envelope>`;
}
function parseJobs(xml) {
  const jobBlocks = extractBetween(xml, '<Job>', '</Job>');
  return jobBlocks.map(block => {
    const get = (tag) => { const m = block.match(new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`)); return m ? m[1].trim() : ''; };
    const activities = extractBetween(block, '<JobActivity>', '</JobActivity>').map(a => { const ag = (tag) => { const m = a.match(new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`)); return m ? m[1].trim() : ''; }; return { name: ag('Name'), status: ag('StatusName'), scheduledDate: ag('ScheduledDate'), assignee: ag('AssigneeName') }; });
    const findActivity = (keywords) => activities.find(a => keywords.some(k => a.name.toLowerCase().includes(k.toLowerCase())));
    const measureActivity = findActivity(['measure', 'template']); const installActivity = findActivity(['install']); const repairActivity = findActivity(['repair', 'service', 'warranty']);
    return { id: get('JobNumber') || get('Id'), customer: get('AccountName') || 'Unknown', email: get('Email') || '', phone: get('Phone') || '', job: get('Name') || 'Job', status: get('PhaseName') || get('StatusName') || 'Scheduled', assignee: get('AssigneeName') || get('SalespersonName') || '—', installDate: installActivity?.scheduledDate || null, measureDate: measureActivity?.scheduledDate || null, repairDate: repairActivity?.scheduledDate || null, activities };
  });
}
const server = http.createServer(async (req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ status: 'ok', moraware: MORAWARE_URL ? 'configured' : 'not configured' })); return; }
  if (req.url === '/debug') { try { const xml = await morawareRequest(buildGetJobsXML()); res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(xml.substring(0, 8000)); } catch (err) { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); } return; }
  if (req.url === '/jobs' && req.method === 'GET') { try { const xml = await morawareRequest(buildGetJobsXML()); const jobs = parseJobs(xml); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ jobs, count: jobs.length, fetched: new Date().toISOString() })); } catch (err) { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); } return; }
  const emailMatch = req.url.match(/^\/jobs\/(.+)$/);
  if (emailMatch) { try { const email = decodeURIComponent(emailMatch[1]).toLowerCase(); const xml = await morawareRequest(buildGetJobsXML()); const jobs = parseJobs(xml).filter(j => j.email.toLowerCase() === email); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ jobs, count: jobs.length })); } catch (err) { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); } return; }
  res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not found' }));
});
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
