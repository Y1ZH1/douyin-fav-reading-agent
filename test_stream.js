// 测试服务器 SSE 流式输出
const http = require('http');

const data = JSON.stringify({
  messages: [{ role: 'user', content: '你好' }]
});

console.log('正在发送请求到 http://localhost:3001/api/chat/stream...');
console.log('请等待 30-60 秒让 DeepSeek 思考...\n');

const req = http.request({
  hostname: 'localhost',
  port: 3001,
  path: '/api/chat/stream',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
}, (res) => {
  console.log('状态码:', res.statusCode);
  console.log('响应头:', JSON.stringify(res.headers));
  console.log('--- 开始接收数据 ---\n');
  
  let hasData = false;
  res.on('data', (chunk) => {
    hasData = true;
    const text = chunk.toString();
    console.log('收到数据:', text.slice(0, 200));
  });
  
  res.on('end', () => {
    if (!hasData) {
      console.log('请求完成，但没有收到任何数据');
    } else {
      console.log('\n--- 数据接收完毕 ---');
    }
  });
});

req.on('error', (e) => {
  console.error('请求错误:', e.message);
});

req.write(data);
req.end();

// 30秒后提示
setTimeout(() => {
  console.log('(已经等了 30 秒，仍在等待 DeepSeek 响应...)');
}, 30000);

// 60秒后提示
setTimeout(() => {
  console.log('(已经等了 60 秒...)');
}, 60000);

// 90秒后提示
setTimeout(() => {
  console.log('(已经等了 90 秒...)');
}, 90000);
