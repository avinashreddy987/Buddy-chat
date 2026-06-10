// Simple test script to query /api/config on localhost to verify Google Client ID is exposed
const http = require('http');

const PORT = process.env.PORT || 3000;

const options = {
  hostname: 'localhost',
  port: PORT,
  path: '/api/config',
  method: 'GET',
  headers: { 'Content-Type': 'application/json' },
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => (data += chunk));
  res.on('end', () => {
    try {
      console.log('Status:', res.statusCode);
      console.log('Body:', JSON.parse(data));
    } catch (e) {
      console.error('Failed to parse response:', data);
    }
  });
});

req.on('error', (err) => {
  console.error('Request error:', err.message);
});

req.end();
