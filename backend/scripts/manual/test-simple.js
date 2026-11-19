const http = require('http');

async function makeRequest(options) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data: data.toString() });
        }
      });
    });
    req.on('error', reject);
    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

async function testAPI() {
  const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/health',
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  };

  try {
    console.log('测试健康检查...');
    const result = await makeRequest(options);
    console.log(`状态: ${result.status}`);
    console.log(`响应: ${JSON.stringify(result.data)}`);

    console.log('\n测试warnings端点...');
    const warningsOptions = {
      hostname: 'localhost',
      port: 3000,
      path: '/warnings?scope=class&id=1&status=open',
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    };
    const warningsResult = await makeRequest(warningsOptions);
    console.log(`状态: ${warningsResult.status}`);
    console.log(`响应: ${JSON.stringify(warningsResult.data)}`);

  } catch (error) {
    console.error('测试失败:', error.message);
  }
}

testAPI();
