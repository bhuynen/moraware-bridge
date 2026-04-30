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
function postXML(xmlBody) {
  return new Promise((resolve, reject) => {
    const url = new URL(MORAWARE_URL);
    const options = { hostname: url.hostname, path: url.pathname, method: 'POST', headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Content-Length': Buffer.byteLength(xmlBody) } };
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
function getAttr(xml, attr) {
  const m = xml.match(new RegExp(attr + '="([^"]*)"'));
  return m ? m[1] : '';
}
async function getSessionId() {
  const xml = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope version="5" userName="${MORAWARE_USER}" password="${MORAWARE_PASS}" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><Connect xmlns="http://moraware.com/JobTrackerAPI5"></Connect></soap:Body></soap:Envelope>`;
  const resp = await postXML(xml);
  const m = resp.match(/sessionId="([^"]+)"/);
  if (!m) throw new Error('Login failed: ' + resp.substring(0, 500));
  return m[1];
}
async function getJobs(sessionId) {
  const xml = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope version="5" userName="${MORAWARE_USER}" password="${MORAWARE_PASS}" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><GetJobs sessionId="${sessionId}" xmlns="http://moraware.com/JobTrackerAPI5"><filter></filter></GetJobs></soap:Body></soap:Envelope>`;
  return await postXML(xml);
}
function parseJobs(xml) {
  const jobBlocks = extractBetween(xml, '<Job>', '</Job>');
  return jobBlocks.map(block => {
    const get = (tag) => { const m = block.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`)); return m ? m[1].trim() : ''; };
    const activities = extractBetween(block, '<JobActivity>', '</JobActivity>').map(a => { const ag = (tag) => { const m = a.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`)); return m ? m[1].trim() : ''; }; return { name: ag('Name'), status: ag('StatusName'), scheduledDate: ag('ScheduledDate'), assignee: ag('AssigneeName') }; });
    const findActivity = (kw) => activities.find(a => kw.some(k => a.name.toLowerCase().includes(k)));
    const m = findActivity(['measure','template']), i = findActivity(['install']), r = findActivity(['repair','service','warranty']);
    return { id: get('JobNumber')||get('Id'), customer: get('AccountName')||'Unknown', email: get('Email')||'', phone: get('Phone')||'', job: get('Name')||'Job', status: get('PhaseName')||get('StatusName')||'Scheduled', assignee: get('AssigneeName')||get('SalespersonName')||'—', installDate: i?.scheduledDate||null, measureDate: m?.scheduledDate||null, repairDate: r?.scheduledDate||null };
  });
}
const server = http.createServer(async (req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.url === '/health') { res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({status:'ok',moraware:MORAWARE_URL?'configured':'not configured'})); return; }
  if (req.url === '/debug') {
    try {
      const sid = await getSessionId();
      const xml = await getJobs(sid);
      res.writeHead(200,{'Content-Type':'text/plain'}); res.end(xml.substring(0,8000));
    } catch(err) { res.writeHead(502,{'Content-Type':'application/json'}); res.end(JSON.stringify({error:err.message})); }
    return;
  }
  if (req.url === '/jobs') {
    try {
      const sid = await getSessionId();
      const xml = await getJobs(sid);
      const jobs = parseJobs(xml);
      res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({jobs,count:jobs.length,fetched:new Date().toISOString()}));
    } catch(err) { res.writeHead(502,{'Content-Type':'application/json'}); res.end(JSON.stringify({error:err.message})); }
    return;
  }
  const em = req.url.match(/^\/jobs\/(.+)$/);
  if (em) {
    try {
      const sid = await getSessionId();
      const xml = await getJobs(sid);
      const jobs = parseJobs(xml).filter(j => j.email.toLowerCase() === decodeURIComponent(em[1]).toLowerCase());
      res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({jobs,count:jobs.length}));
    } catch(err) { res.writeHead(502,{'Content-Type':'application/json'}); res.end(JSON.stringify({error:err.message})); }
    return;
  }
  res.writeHead(404,{'Content-Type':'application/json'}); res.end(JSON.stringify({error:'Not found'}));
});
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
