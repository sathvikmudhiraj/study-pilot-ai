const accessToken = process.env.STUDYPILOT_DIAGNOSTIC_ACCESS_TOKEN;
const refreshToken = process.env.STUDYPILOT_DIAGNOSTIC_REFRESH_TOKEN;

if (!accessToken || !refreshToken) {
  throw new Error('Set STUDYPILOT_DIAGNOSTIC_ACCESS_TOKEN and STUDYPILOT_DIAGNOSTIC_REFRESH_TOKEN before running this diagnostic.');
}

const sessionData = {
  access_token: accessToken,
  refresh_token: refreshToken,
  expires_in: 3600,
  token_type: 'bearer',
};

const sessionJson = JSON.stringify(sessionData);
const cookieValue = 'base64-' + Buffer.from(sessionJson).toString('base64');

console.log('Cookie value length:', cookieValue.length);

// Now test with fetch - POST to trigger revision plan
async function testRevisionPost() {
  const fileId = '3a464027-29a5-4df1-854a-37b2c9d84fb5'; // CNSmodule-1.pdf with extracted text
  const startTime = Date.now();
  
  const response = await fetch('http://localhost:3000/api/revision', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `sb-djoqffzmsakrpbyjtwpa-auth-token=${cookieValue}`
    },
    body: JSON.stringify({ fileId })
  });
  
  const duration = Date.now() - startTime;
  console.log('Status:', response.status);
  console.log('Duration:', duration, 'ms');
  const text = await response.text();
  console.log('Response:', text);
}

testRevisionPost().catch(console.error);
