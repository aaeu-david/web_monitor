"use strict";

const { spawn } = require("node:child_process");
const dgram = require("node:dgram");

const HTTP_PORT = 3210;
const UDP_PORT = 5015;
const BASE_URL = `http://127.0.0.1:${HTTP_PORT}`;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendUdp(payload) {
  return new Promise((resolve, reject) => {
    const client = dgram.createSocket("udp4");
    const message = Buffer.from(JSON.stringify(payload));

    client.send(message, UDP_PORT, "127.0.0.1", (err) => {
      client.close();
      if (err) reject(err);
      else resolve();
    });
  });
}

async function waitForServer() {
  const deadline = Date.now() + 5000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/api/summary`);
      if (response.ok) return;
    } catch {
      await wait(100);
    }
  }

  throw new Error("HTTP server did not become ready.");
}

async function main() {
  const server = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HTTP_HOST: "127.0.0.1",
      HTTP_PORT: String(HTTP_PORT),
      UDP_HOST: "127.0.0.1",
      UDP_PORT: String(UDP_PORT)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stderr = "";
  server.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForServer();
    await sendUdp({ device_id: "device_1", key: "rotation", value: 24.7 });
    await sendUdp({ device_id: "device_2", key: "rotation", value: 18.3 });
    await wait(250);

    const summary = await fetch(`${BASE_URL}/api/summary`).then((response) => response.json());
    const device1 = summary.devices.device_1.latest;
    const device2 = summary.devices.device_2.latest;

    if (!device1 || device1.value !== 24.7) {
      throw new Error("Device 1 reading was not stored correctly.");
    }

    if (!device2 || device2.value !== 18.3) {
      throw new Error("Device 2 reading was not stored correctly.");
    }

    console.log("Smoke test passed.");
  } finally {
    server.kill();
  }

  if (stderr.trim()) {
    console.error(stderr.trim());
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
