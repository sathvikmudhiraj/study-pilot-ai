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

// Now test with fetch
async function testRevision() {
  const response = await fetch('http://localhost:3000/api/revision', {
    method: 'GET',
    headers: {
      'Cookie': `sb-djoqffzmsakrpbyjtwpa-auth-token=${cookieValue}`
    }
  });
  
  console.log('Status:', response.status);
  const text = await response.text();
  console.log('Response:', text);
}

testRevision().catch(console.error);
