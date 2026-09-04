#!/usr/bin/env node
// Tiny static server for foil-eleven, with a POST /save endpoint that writes
// the request body to scripts/new-cards.json - used only to get the browser's
// extracted card JSON onto disk during a sync, without routing megabytes of
// text through the assistant's own context.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2] || 'C:\\Users\\leifp\\Downloads\\foil-eleven';
const SAVE_PATH = process.argv[3] || 'C:\\Users\\leifp\\Downloads\\drucker\\scripts\\new-cards.json';
const PORT = 8934;

const MIME = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json',
  '.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2'};

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/save') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      fs.writeFileSync(SAVE_PATH, body);
      res.writeHead(200, {'Content-Type':'text/plain'});
      res.end('saved ' + body.length + ' bytes');
      console.log('Saved', body.length, 'bytes to', SAVE_PATH);
    });
    return;
  }
  let filePath = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (filePath.endsWith('/')) filePath = path.join(filePath, 'index.html');
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, {'Content-Type': MIME[ext] || 'application/octet-stream'});
    res.end(data);
  });
}).listen(PORT, '127.0.0.1', () => console.log('listening on', PORT));
