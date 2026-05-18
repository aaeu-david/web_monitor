"use strict";

const dgram = require("node:dgram");

const [deviceId = "device_1", key = "rotation", rawValue = "24.7", host = "127.0.0.1", rawPort = "5005"] = process.argv.slice(2);
const value = Number(rawValue);
const port = Number(rawPort);

const payload = Buffer.from(JSON.stringify({ device_id: deviceId, key, value }));
const client = dgram.createSocket("udp4");

client.send(payload, port, host, (err) => {
  client.close();
  if (err) {
    console.error(err.message);
    process.exitCode = 1;
    return;
  }

  console.log(`Sent UDP message to ${host}:${port}: ${payload.toString()}`);
});
