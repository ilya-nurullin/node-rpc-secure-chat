const net = require("net");
const crypto = require("crypto");
const AddressInfo = require("./AddressInfo");
const RPCMethods = require("./RPCMethods");
const readline = require('readline');

const SERVER_ADDRESS = "localhost";
const SERVER_PORT = 39874;

let serverInfo; // информация об адресе сервера
let connectedClients = []; // адреса подключенных клиентов
let openConnections = {}; // установленные соединения с клиентами
let secretKeys = {}; // ключи шифрования сообщений


const me = crypto.createECDH("secp256k1");
me.generateKeys();
const mePublicKeyBase64 = me.getPublicKey().toString('base64');


const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'client> '
});

const server = net.createServer(connection => {
  connection.on('error', (err) => null);
  connection.on('close', (err) => null);

  connection.setEncoding('utf8');

  connection.on('data', (data) => {
    let request = JSON.parse(data.toString());

    switch (request.method) {
      case "updateClients": {
        connectedClients = request.params[0].filter(v => !(v.address === serverInfo.address && v.port === serverInfo.port));
      } break;
      case "message": {
        console.log(formatMessageString(request.params[0], decryptMessage(request.params[1], secretKeys[getAddressHash(request.params[0])]), request.params[2]));
        rl.prompt();
      } break;
      case "handshakeStart": {
        handshakeFinish(request.params[1], connection, request.params[0]);
      }
    }
  });
});

server.listen(0, socket => {
  serverInfo = new AddressInfo(server.address().address, server.address().port);

  console.info("Client's server started: " + serverInfo);

  const client = net.connect(SERVER_PORT, SERVER_ADDRESS, function () {
    console.log("Connected to server");
    initPrompt();
  });

  client.on("error", () => {
    console.log("Start working in serverless mode!");
    rl.prompt();
  });

  let request = RPCMethods.login(serverInfo.address, serverInfo.port);
  client.write(JSON.stringify(request));
});


function initPrompt() {
  console.log(clients2String());
  console.log("Enter: \n exit to quit \n list to show all clients \n <client-id>|-1 <message> to send a message to the client or -1 to send to all:");

  rl.on("line", (res) => {
    if (res === "")
    {
      // no operation
    }
    else if (res === "list")
      console.log(clients2String());
    else if (res === "exit" || res === "quit")
      process.exit(0);
    else {
      try {
        let splitIndex = res.indexOf(" ");
        let clientId = parseInt(res.substring(0, splitIndex));
        let message = res.substring(splitIndex + 1);

        if (clientId === -1) {
          sendBroadcast(message);
          rl.prompt();
          return;
        }

        let foundClient = connectedClients.filter(v => v.port === clientId);
        if (foundClient.length === 0) {
          console.log("Invalid client index. Try to use list command");
          rl.prompt();
          return;
        }

        sendMessage(message, foundClient[0]);

      }
      catch (e) {
        console.log("Something went wrong: ");
        console.log(e);
      }
    }

    rl.prompt();
  });

  rl.prompt();
}

function getAddressHash(clientAddress) {
  return clientAddress.address + '-' + clientAddress.port;
}

function getConnection(clientAddress) {
  let hash = getAddressHash(clientAddress);
  if (!(hash in openConnections)) {
    let connect = net.connect(clientAddress.port, clientAddress.address).setEncoding('utf8');
    openConnections[hash] = connect;

    connect.on("error", err => connectedClients = connectedClients.filter(v => !(v.address === clientAddress.address && v.port === clientAddress.port)));
    connect.on("close", err => connectedClients = connectedClients.filter(v => !(v.address === clientAddress.address && v.port === clientAddress.port)));
  }

  return openConnections[hash];
}

function handshakeStart(clientAddress, connection, queuedMessage = null) {
  connection.write(JSON.stringify(RPCMethods.handshakeStart(mePublicKeyBase64, serverInfo)));

  connection.on('data', (data) => {
    let request = JSON.parse(data);
    if (request.method === "handshakeFinish") {
      secretKeys[getAddressHash(clientAddress)] = me.computeSecret(request.params[0], "base64");
      sendMessage(queuedMessage, clientAddress);
    }
  })
}

function handshakeFinish(clientAddress, connection, otherPublicKeyBase64) {
  secretKeys[getAddressHash(clientAddress)] = me.computeSecret(otherPublicKeyBase64, "base64");

  connection.write(JSON.stringify(RPCMethods.handshakeFinish(mePublicKeyBase64)));
}

function sendBroadcast(message) {
  for (let i = 0; i < connectedClients.length; i++) {
    sendMessage(message, connectedClients[i]);
  }
}

function clients2String() {
  let res = "Connected clients list: \n";

  for (let i = 0; i < connectedClients.length; i++) {
    res += connectedClients[i].port + " = " + JSON.stringify(connectedClients[i]) + "\n";
  }

  return res;
}

function sendMessage(message, addressInfo) {
  let connection = getConnection(addressInfo);

  if (!(getAddressHash(addressInfo) in secretKeys)) {
    handshakeStart(addressInfo, connection, message);
  }
  else {
    const key = secretKeys[getAddressHash(addressInfo)];
    connection
        .write(JSON.stringify(RPCMethods.message(serverInfo, encryptMessage(message, key), (new Date()).getTime())))
  }
}

function encryptMessage(message, key) {
  const IV = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, IV);
  let encrypt = cipher.update(message, "utf8", "hex");
  encrypt += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString("hex");

  const payload = IV.toString("hex") + encrypt + authTag;
  const payloadBase64 = Buffer.from(payload, "hex").toString("base64");

  return payloadBase64;
}

function decryptMessage(encryptedBase64, key) {
  const payload = Buffer.from(encryptedBase64, "base64").toString('hex');
  const IV = payload.substr(0, 32);
  const encryptedMessage = payload.substr(32, payload.length - (32 * 2));
  const authTag = payload.substr(payload.length - 32, 32);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(IV, "hex"));
  decipher.setAuthTag(Buffer.from(authTag, "hex"));

  try {
    let decrypted = decipher.update(encryptedMessage, "hex", "utf8");
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (e) {
    console.log("Cannot decrypt message:");
    console.log(e);
  }

}

function formatMessageString(from, message, time) {
  return `
NEW MESSAGE!
    From = ${from.address} - ${from.port}
    To = ${serverInfo.address} - ${serverInfo.port}
    Date = ${new Date(time)}
    Message = ${message}
`
}