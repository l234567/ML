// 名称:Cloudflare Speed Test for Surge
// 作者:Mr.Eric
// 使用 speed.cloudflare.com 测速 + 自动获取当前出口 IP

// ========= 配置区 =========

// argument 作为“策略名 / 节点名”（可选）
// 仅用于指定 policy；没传 argument 时就不指定 policy，走默认路由
const POLICY_NAME = (typeof $argument === 'string' && $argument.trim().length > 0)
  ? $argument.trim()
  : null;

// 显示在日志里的节点名称（仅展示用）
const NODE_NAME = POLICY_NAME || 'Auto-Route';

// 下载 / 上传 测试包大小（适当缩小，避免超时）
const DOWNLOAD_SIZES = [
  { label: '100.0 KB', bytes: 100 * 1024 },
  { label: '500.0 KB', bytes: 500 * 1024 },
  { label: '1.0 MB',  bytes: 1 * 1024 * 1024 },
];

const UPLOAD_SIZES = [
  { label: '100.0 KB', bytes: 100 * 1024 },
  { label: '500.0 KB', bytes: 500 * 1024 },
  { label: '1.0 MB',  bytes: 1 * 1024 * 1024 },
];

// 单次测试的最大等待时间（毫秒）
const PER_TEST_TIMEOUT = 12000; // 12 秒

// ========= 通用工具函数 =========

function formatDate(date) {
  const pad = n => (n < 10 ? '0' + n : '' + n);
  return (
    date.getFullYear() + '-' +
    pad(date.getMonth() + 1) + '-' +
    pad(date.getDate()) + ' ' +
    pad(date.getHours()) + ':' +
    pad(date.getMinutes()) + ':' +
    pad(date.getSeconds())
  );
}

function toMbps(bytes, ms) {
  if (!ms || ms <= 0) return 0;
  const bps = (bytes * 8 * 1000) / ms;
  return bps / 1e6;
}

function formatMbps(mbps) {
  return mbps.toFixed(2);
}

function speedLevel(mbps) {
  if (mbps < 5) {
    return { icon: '🔴', text: '较差 (<5 Mbps)' };
  } else if (mbps < 20) {
    return { icon: '🟡', text: '一般 (5-20 Mbps)' };
  } else if (mbps < 50) {
    return { icon: '🟢', text: '良好 (20-50 Mbps)' };
  } else {
    return { icon: '🔵', text: '优秀 (>50 Mbps)' };
  }
}

function calcScore(dlMbps, ulMbps) {
  const dlNorm = Math.min(1, dlMbps / 100); // 100Mbps 封顶
  const ulNorm = Math.min(1, ulMbps / 50);  // 50Mbps 封顶
  const score = (dlNorm * 0.7 + ulNorm * 0.3) * 100;
  return Math.round(score * 10) / 10;
}

function qualityText(score) {
  if (score >= 85) return '优秀';
  if (score >= 60) return '良好';
  if (score >= 40) return '一般';
  return '较差';
}

// ========= HTTP 封装（带单次超时保护） =========

function httpGet(options) {
  return new Promise((resolve, reject) => {
    $httpClient.get(options, (error, response, data) => {
      if (error) return reject(error);
      resolve({ response, data });
    });
  });
}

function httpPost(options) {
  return new Promise((resolve, reject) => {
    $httpClient.post(options, (error, response, data) => {
      if (error) return reject(error);
      resolve({ response, data });
    });
  });
}

// 包装一个带超时的 Promise
function withTimeout(promise, ms, tag) {
  return new Promise((resolve, reject) => {
    let finished = false;

    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      reject(new Error(`[${tag}] 单次测试超时 (${ms}ms)`));
    }, ms);

    promise
      .then(res => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve(res);
      })
      .catch(err => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        reject(err);
      });
  });
}

// ========= 业务函数 =========

// 自动获取当前出口 IP（Cloudflare meta）
async function fetchMeta() {
  const options = {
    url: 'https://speed.cloudflare.com/meta',
    headers: {
      'Referer': 'https://speed.cloudflare.com',
      'User-Agent': 'Surge-CF-Speedtest/1.0'
    },
    timeout: 10
  };

  // 仅在配置了策略名时，才指定 policy
  if (POLICY_NAME) {
    options.policy = POLICY_NAME;
  }

  const { data } = await withTimeout(httpGet(options), PER_TEST_TIMEOUT, 'meta');
  try {
    const json = JSON.parse(data || '{}');
    return json; // 包含 clientIp / country / city / colo 等
  } catch (e) {
    return {};
  }
}

// 单次下载测速
async function testDownloadOnce(size) {
  const url = `https://speed.cloudflare.com/__down?bytes=${size.bytes}`;
  const options = {
    url,
    headers: {
      'User-Agent': 'Surge-CF-Speedtest/1.0',
      'Referer': 'https://speed.cloudflare.com'
    },
    'binary-mode': true,
    timeout: 20
  };

  if (POLICY_NAME) {
    options.policy = POLICY_NAME;
  }

  const start = Date.now();
  await withTimeout(httpGet(options), PER_TEST_TIMEOUT, `down-${size.label}`);
  const cost = Date.now() - start;
  const mbps = toMbps(size.bytes, cost);
  return { ...size, ms: cost, mbps };
}

// 单次上传测速
async function testUploadOnce(size) {
  const url = 'https://speed.cloudflare.com/__up';

  // 构造指定大小的 body（限制最大 1MB，避免太大）
  const targetBytes = Math.min(size.bytes, 1 * 1024 * 1024);
  const chunk = '0'.repeat(32 * 1024);
  const times = Math.ceil(targetBytes / (32 * 1024));
  let body = '';

  for (let i = 0; i < times; i++) {
    body += chunk;
  }
  if (body.length > targetBytes) {
    body = body.slice(0, targetBytes);
  }

  const options = {
    url,
    headers: {
      'Content-Type': 'application/octet-stream',
      'User-Agent': 'Surge-CF-Speedtest/1.0',
      'Referer': 'https://speed.cloudflare.com'
    },
    body,
    timeout: 20
  };

  if (POLICY_NAME) {
    options.policy = POLICY_NAME;
  }

  const start = Date.now();
  await withTimeout(httpPost(options), PER_TEST_TIMEOUT, `up-${size.label}`);
  const cost = Date.now() - start;
  const mbps = toMbps(targetBytes, cost);
  return { ...size, ms: cost, mbps };
}

// ========= 主流程 =========

(async () => {
  const lines = [];
  const now = new Date();
  const timeStr = formatDate(now);

  try {
    // 1. 自动获取当前出口 IP
    const meta = await fetchMeta();
    const nodeIP = meta.clientIp || '未知';
    const colo = meta.colo || '';
    const locStr = meta.city
      ? `${meta.city}${meta.region ? ' · ' + meta.region : ''} · ${meta.country || ''}`
      : (meta.country || '');

    lines.push('=== 节点测速开始 ===');
    lines.push(`节点名称: ${NODE_NAME}`);
    lines.push(`节点IP: ${nodeIP}`);
    if (locStr) {
      lines.push(`定位: ${locStr}`);
    }
    if (colo) {
      lines.push(`Cloudflare 节点: ${colo}`);
    }
    lines.push(`时间: ${timeStr}`);

    // 2. 下载测速
    lines.push('开始下载测速...');
    const dlResults = [];
    for (const size of DOWNLOAD_SIZES) {
      try {
        const result = await testDownloadOnce(size);
        dlResults.push(result);
        lines.push(
          `✅ 下载测试成功: ${size.label}: ${formatMbps(result.mbps)} Mbps`
        );
      } catch (e) {
        lines.push(
          `❌ 下载测试失败: ${size.label}: ${String(e.message || e)}`
        );
      }
    }

    // 3. 上传测速
    lines.push('开始上传测速...');
    const ulResults = [];
    for (const size of UPLOAD_SIZES) {
      try {
        const result = await testUploadOnce(size);
        ulResults.push(result);
        lines.push(
          `✅ 上传测试成功: ${size.label}: ${formatMbps(result.mbps)} Mbps`
        );
      } catch (e) {
        lines.push(
          `❌ 上传测试失败: ${size.label}: ${String(e.message || e)}`
        );
      }
    }

    // 4. 汇总
    const avgDl =
      dlResults.length > 0
        ? dlResults.reduce((s, r) => s + r.mbps, 0) / dlResults.length
        : 0;
    const avgUl =
      ulResults.length > 0
        ? ulResults.reduce((s, r) => s + r.mbps, 0) / ulResults.length
        : 0;

    const dlLevel = speedLevel(avgDl);
    const ulLevel = speedLevel(avgUl);
    const score = calcScore(avgDl, avgUl);
    const qText = qualityText(score);

    lines.push('=== 测速结果 ===');
    lines.push(`节点名称: ${NODE_NAME}`);
    lines.push(`节点IP: ${nodeIP}`);
    lines.push('');
    lines.push(`📥 下载速度: ${formatMbps(avgDl)} Mbps`);
    lines.push(`${dlLevel.icon} ${dlLevel.text}`);
    lines.push(`测试次数: ${dlResults.length}/${DOWNLOAD_SIZES.length}`);
    lines.push('');
    lines.push(`📤 上传速度: ${formatMbps(avgUl)} Mbps`);
    lines.push(`${ulLevel.icon} ${ulLevel.text}`);
    lines.push(`测试次数: ${ulResults.length}/${UPLOAD_SIZES.length}`);
    lines.push('');
    lines.push(`📊 综合评分: ${score}/100`);
    lines.push(`👍 节点质量: ${qText}`);
    lines.push('=================');

    const finalLog = lines.join('\n');
    console.log(finalLog);

    $notification.post(
      'Cloudflare 节点测速完成',
      `${NODE_NAME} / ${nodeIP}`,
      `📥 ${formatMbps(avgDl)} Mbps   📤 ${formatMbps(avgUl)} Mbps   评分 ${score}`
    );
  } catch (e) {
    const msg = String(e.message || e);
    console.log('[CF-Speedtest] 运行出错: ' + msg);
    $notification.post('Cloudflare 节点测速失败', NODE_NAME, msg);
  } finally {
    $done();
  }
})();