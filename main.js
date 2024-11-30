const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

function clearConsole() {
  console.clear();
  console.log("==========================================================");
  console.log("\x1b[38;5;213mBY: wrightL\x1b[0m");
  console.log("\x1b[38;5;117mGITHUB: https://github.com/wrightL-dev\x1b[0m");
  console.log("\x1b[38;5;159mTELEGRAM CHANNEL: https://t.me/tahuri01\x1b[0m");
  console.log("\x1b[38;5;147mBOT: OpenLoop\x1b[0m");
  console.log("==========================================================");
}

const colors = {
  reset: '\x1b[0m',
  pastelGreen: '\x1b[38;5;120m',
  pastelYellow: '\x1b[38;5;226m',
  pastelRed: '\x1b[38;5;208m',
  pastelBlue: '\x1b[38;5;114m',
  pastelCyan: '\x1b[38;5;51m',
  pastelMagenta: '\x1b[38;5;198m',
};

async function readProxies() {
  try {
    const data = fs.readFileSync('proxy.txt', 'utf-8');
    const proxies = data.trim().split('\n').filter(line => line.trim() !== '');
    if (proxies.length === 0) {
      console.log(`${colors.pastelRed}File proxy.txt ditemukan tapi kosong. Akan dijalankan tanpa proxy.${colors.reset}`);
    }
    return proxies;
  } catch (error) {
    console.log(`${colors.pastelRed}Tidak ada file proxy.txt ditemukan atau terjadi kesalahan saat membaca file. Akan dijalankan tanpa proxy.${colors.reset}`);
    return [];
  }
}

function readAccounts() {
  try {
    const data = fs.readFileSync('akun.txt', 'utf-8');
    return data.trim().split('\n').filter(line => line.trim() !== '').map(line => {
      const [email, password] = line.split('|');
      return { email, password };
    });
  } catch (error) {
    console.log(`${colors.pastelRed}File akun.txt tidak ditemukan. Membuat file baru.${colors.reset}`);
    return [];
  }
}

async function startWorker(account, proxy) {
  const worker = new Worker(__filename, {
    workerData: { account, proxy },
  });

  worker.on('message', (msg) => {
    console.log(msg);
  });

  worker.on('error', (err) => {
    console.log(`${colors.pastelRed}Terjadi kesalahan di worker untuk akun ${account.email}: ${err.message}${colors.reset}`);
  });

  worker.on('exit', (code) => {
    if (code !== 0) {
      console.log(`${colors.pastelRed}Worker untuk akun ${account.email} keluar dengan kode ${code}.${colors.reset}`);
    }
  });
}

async function retryRequest(fn) {
  while (true) {
    try {
      return await fn();
    } catch (error) {
      console.log(`${colors.pastelRed}Terjadi kesalahan saat request, proxy atau jaringan Anda mungkin down: ${error.message}. Mengulang...${colors.reset}`);
      await new Promise(resolve => setTimeout(resolve, 5000)); // Delay sebelum mencoba lagi
    }
  }
}

async function getPoints(accessToken, agent, maskedEmail) {
  try {
    const response = await retryRequest(() => axios.get('https://api.openloop.so/bandwidth/info', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      httpsAgent: agent,
      httpAgent: agent,
    }));

    if (response.status === 200 && response.data.code === 2000) {
      const points = response.data.data.balances.POINT;
      return points;
    } else {
      parentPort.postMessage(`${maskedEmail} Gagal mendapatkan poin.`);
      return null;
    }
  } catch (error) {
    parentPort.postMessage(`${maskedEmail} Kesalahan saat mendapatkan poin: ${error.message}`);
    return null;
  }
}

async function shareBandwidth(accessToken, agent, maskedEmail) {
  while (true) {
    try {
      const quality = 80 + Math.floor(Math.random() * 20);
      const response = await retryRequest(() => axios.post('https://api.openloop.so/bandwidth/share', { quality }, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        httpsAgent: agent,
        httpAgent: agent,
      }));

      if (response.status === 200 && response.data.code === 2000) {
        const points = await getPoints(accessToken, agent, maskedEmail);
        
        if (points !== null) {
          console.log(`${colors.pastelGreen}Email:${colors.reset} ${colors.pastelCyan}${maskedEmail}${colors.reset} | ${colors.pastelGreen}PING:${colors.reset} ${colors.pastelRed}${quality}${colors.reset} | ${colors.pastelGreen}Saldo:${colors.reset} ${colors.pastelCyan}${points}${colors.reset}`);
        } else {
          console.log(`${colors.pastelGreen}Email:${colors.reset} ${colors.pastelCyan}${maskedEmail}${colors.reset} | ${colors.pastelGreen}PING:${colors.reset} ${colors.pastelRed}${quality}${colors.reset} | ${colors.pastelGreen}Saldo:${colors.reset} Gagal mengambil saldo`);
        }
      } else {
        parentPort.postMessage(`${maskedEmail} Gagal berbagi bandwidth: ${response.data.message}`);
      }
    } catch (error) {
      if (error.response && error.response.status === 429) {
        parentPort.postMessage(`${maskedEmail} Error: Batas rate tercapai. Menunggu...`);
      } else if (error.message.includes('disconnected before secure TLS connection was established')) {
        parentPort.postMessage(`${maskedEmail} Kesalahan TLS, mencoba lagi...`);
      } else {
        parentPort.postMessage(`${maskedEmail} Kesalahan saat berbagi bandwidth: ${error.message}`);
      }
    }
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}

async function workerMain() {
  const { account, proxy } = workerData;

  const proxyDetails = proxy ? proxy.split('@')[1] : null;

  const maskEmail = (email) => {
    return email.replace(/(.{2})(.*)(@.*)/, '$1*****$3');
  }

  const maskedEmail = maskEmail(account.email);

  try {
    const loginResponse = await retryRequest(() => axios.post('https://api.openloop.so/users/login', {
      username: account.email,
      password: account.password,
    }, {
      httpsAgent: proxyDetails ? new HttpsProxyAgent(proxy) : undefined,
      httpAgent: proxyDetails ? new HttpsProxyAgent(proxy) : undefined,
    }));

    if (loginResponse.status === 200 && loginResponse.data.code === 2000) {
      const accessToken = loginResponse.data.data.accessToken;
      parentPort.postMessage(`${colors.pastelGreen}Berhasil Login Dengan Email: ${colors.reset}${colors.pastelCyan}${maskedEmail}${colors.reset} | ${colors.pastelGreen}Proxy: ${colors.reset}${colors.pastelCyan}${proxyDetails ? proxyDetails : 'Tanpa Proxy'}${colors.reset}`);

      await getPoints(accessToken, proxyDetails ? new HttpsProxyAgent(proxy) : undefined, maskedEmail);
      await shareBandwidth(accessToken, proxyDetails ? new HttpsProxyAgent(proxy) : undefined, maskedEmail);
    } else {
      parentPort.postMessage(`${colors.pastelRed}Gagal login untuk akun: ${account.email}${colors.reset}`);
    }
  } catch (error) {
    parentPort.postMessage(`${colors.pastelRed}Kesalahan login untuk akun: ${account.email} - ${error.message}.${colors.reset}`);
  }
}

// Fungsi utama untuk menjalankan program
async function main() {
  clearConsole();
  const accounts = readAccounts();
  const proxies = await readProxies();

  if (accounts.length === 0) {
    console.log(`${colors.pastelRed}Tidak ada akun yang ditemukan di akun.txt.${colors.reset}`);
    return;
  }

  if (proxies.length === 0) {
    console.log(`${colors.pastelRed}Tidak ada proxy ditemukan. Akan dijalankan tanpa proxy.${colors.reset}`);
  }

  for (const account of accounts) {
    let loggedIn = false;

    for (const proxy of proxies) {
      await startWorker(account, proxy);
      loggedIn = true;
      break;
    }

    if (!loggedIn) {
      await startWorker(account, null);
    }
  }
}

if (isMainThread) {
  main().catch(console.error);
} else {
  workerMain();
}
