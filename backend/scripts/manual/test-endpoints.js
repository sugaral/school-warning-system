const axios = require('axios');

async function testEndpoints() {
  const API_URL = 'http://localhost:3000';

  try {
    console.log('测试1: 健康检查');
    const health = await axios.get(`${API_URL}/health`);
    console.log('✓ 健康检查成功:', health.data);

    console.log('\n测试2: 登录');
    const login = await axios.post(`${API_URL}/auth/login_admin`, {
      account: 'admin',
      password: '123456',
      sms_ticket: 'test',
      email_ticket: 'test'
    });
    console.log('✓ 登录成功:', login.data);

    const token = login.data.data.token;

    console.log('\n测试3: 预警查询（无认证）');
    try {
      const warningsNoAuth = await axios.get(`${API_URL}/warnings?scope=class&id=1&status=open`);
      console.log('✗ 无认证查询不应该成功:', warningsNoAuth.data);
    } catch (error) {
      console.log('✓ 无认证查询被拒绝（预期行为）:', error.response?.status);
    }

    console.log('\n测试4: 预警查询（有认证）');
    const warningsWithAuth = await axios.get(`${API_URL}/warnings?scope=class&id=1&status=open`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log('✓ 预警查询成功:', warningsWithAuth.data);

  } catch (error) {
    console.error('✗ 测试失败:', error.message);
    if (error.response) {
      console.error('响应状态:', error.response.status);
      console.error('响应数据:', error.response.data);
    }
  }
}

testEndpoints();
