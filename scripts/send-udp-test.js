"use strict";

const dgram = require("node:dgram");

const [deviceId = "device_1", host = "127.0.0.1", rawPort = "5005"] = process.argv.slice(2);
const port = Number(rawPort);

const payload = Buffer.from(
  JSON.stringify({
    device_id: deviceId,
    values: [
      { key: "x", value: parseFloat((Math.random() * 2 - 1).toFixed(3)) },
      { key: "y", value: parseFloat((Math.random() * 2 - 1).toFixed(3)) },
      { key: "z", value: parseFloat((9.0 + Math.random()).toFixed(3)) },
      { key: "temperature", value: parseFloat((20 + Math.random() * 15).toFixed(1)) }
    ]
  })
);

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
