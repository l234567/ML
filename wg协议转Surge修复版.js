/*
本脚本支持wg协议链接转换为Surge配置文件，将wg协议链接放到inputtext里面后运行即可
*/
const inputText = `
  wg://vpn-hk-d5v7gci72gfd4mn8.ilovevpn.co:51820?publicKey=mVqx6S0NFfR7PJbW5vLR0RNPQmfYRBYekNM24D0lkz4=&privateKey=oBIJPs//qiFhf58+wSJk1l+XZ6lGj1PUwPugJ+oWk/Y=&ip=10.0.7.151/32&mtu=1384&dns=1.1.1.1,%201.0.0.1&udp=1&reserved=0,0,0&flag=LAN#%E9%A6%99%E6%B8%AF
  wg://vpn-jp-abc123.ilovevpn.co:51820?publicKey=abcDEF123456=&privateKey=xyzABC987654=&ip=10.0.9.99/32&mtu=1380&dns=8.8.8.8,%208.8.4.4#%E6%97%A5%E6%9C%AC
  wg://120.233.41.75:16818?publicKey=F+GuBf6ceJIYwj3vjFNGFIhWBzGq3Mtod0+wMxBBkVE=&privateKey=uLb8+5sqhTubXWZyuPCz6Umetrw0QC912JWVRCrJxnM=&ip=10.0.1.188/16,fd10:10:10:0:10:0:1:188/64&udp=1&flag=HK#HK-%E6%80%A5%E9%80%9F%E7%9B%B4%E8%BF%9E8
`;

const proxyLines = [`
[Proxy]
`];
const wireguardSections = [];

function extractWgUrls(text) {
  const wgRegex = /wg:\/\/[^\s'"]+/g;
  return text.match(wgRegex) || [];
}

function parseWgUrlForSurge(url) {
  try {
    const wgStr = url.slice(5);
    const [hostPort, queryAndFragment] = wgStr.split('?');
    const [host, port] = hostPort.split(':');
    const [queryString, fragment] = queryAndFragment.split('#');

    const rawParams = Object.fromEntries(
      queryString.split('&').map(pair => {
        const [key, ...rest] = pair.split('=');
        const value = rest.join('=');
        if (['publicKey', 'privateKey', 'presharedKey'].includes(key)) {
          return [key, value]; // 保留 + 和 =
        }
        return [key, decodeURIComponent(value.replace(/\+/g, '%20'))];
      })
    );

    const name = decodeURIComponent(fragment || 'WireGuard');
    const publicKey = rawParams.publicKey || '';
    const privateKey = rawParams.privateKey || '';
    const presharedKey = rawParams.presharedKey || '';
    const ipWithCidr = rawParams.ip || '0.0.0.0/32';
    const selfIp = ipWithCidr.split(',')[0].split('/')[0];
    const mtu = rawParams.mtu || '1280';
    const dns = (rawParams.dns || '').replace(/\s+/g, '');

    proxyLines.push(`${name} = wireguard, section-name = ${name}`);

    const section = [
      `[WireGuard ${name}]`,
      `private-key = ${privateKey}`,
      `self-ip = ${selfIp}`,
    ];
    if (dns) section.push(`dns-server = ${dns}`);
    section.push(`mtu = ${mtu}`);

    const peerLine = `peer = (public-key = ${publicKey}, allowed-ips = "0.0.0.0/0, ::0/0", endpoint = ${host}:${port}` +
      (presharedKey ? `, preshared-key = ${presharedKey}` : '') +
      `, keepalive = 25)`;

    section.push(peerLine);
    wireguardSections.push(section.join('\n'));
  } catch (err) {
    console.log(`❌ Error parsing URL: ${err.message}`);
  }
}

// 抓取 wg 链接并解析
const wgUrls = extractWgUrls(inputText);
wgUrls.forEach(parseWgUrlForSurge);

// 输出全部结果
console.log(proxyLines.join('\n') + '\n\n' + wireguardSections.join('\n\n'));

$done && $done();