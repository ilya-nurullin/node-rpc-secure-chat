const net = require("net");
const crypto = require("crypto");
const AddressInfo = require("./AddressInfo");
const RPCMethods = require("./RPCMethods");
const readline = require('readline');

const SERVER_ADDRESS = "localhost";
const SERVER_PORT = 39874;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'client> '
});

class Client {
  serverInfo; // информация об адресе сервера
  connectedClients = []; // адреса подключенных клиентов
  openConnections = {}; // установленные соединения с клиентами
  secretKeys = {}; // ключи шифрования сообщений
  me = crypto.createECDH("secp256k1");
  mePublicKeyBase64;

  constructor() {
    this.me.generateKeys();
    this.mePublicKeyBase64 = this.me.getPublicKey().toString('base64');
  }

  run() {
    const server = net.createServer(connection => {
      connection.on('error', () => null);
      connection.on('close', () => null);

      connection.setEncoding('utf8');

      connection.on('data', (data) => {
        let request = JSON.parse(data.toString());

        switch (request.method) {
          case "updateClients": {
            this.connectedClients = request.params[0].filter(v => !(v.address === this.serverInfo.address && v.port === this.serverInfo.port));
          }
            break;
          case "message": {
            console.log(this.formatMessageString(request.params[0],
                this.decryptMessage(request.params[1],
                    this.secretKeys[this.getAddressHash(request.params[0])]),
                request.params[2]));
            rl.prompt();
          }
            break;
          case "handshakeStart": {
            this.handshakeFinish(request.params[1], connection, request.params[0]);
          }
        }
      });
    });

    server.listen(0, () => {
      this.serverInfo = new AddressInfo(server.address().address, server.address().port);

      console.info("Client's server started: " + this.serverInfo);

      let self = this;
      const client = net.connect(SERVER_PORT, SERVER_ADDRESS, function () {
        console.log("Connected to server");
        self.initPrompt();
      });

      client.on("error", () => {
        console.log("Start working in serverless mode!");
        rl.prompt();
      });

      let request = RPCMethods.login(this.serverInfo.address, this.serverInfo.port);
      client.write(JSON.stringify(request));
    });
  }


  initPrompt() {
    console.log(this.clients2String());
    console.log("Enter: \n exit to quit \n list to show all clients \n <client-id>|-1 <message> to send a message to the client or -1 to send to all:");

    rl.on("line", (res) => {
      if (res === "") {
        // no operation
      }
      else if (res === "list")
        console.log(this.clients2String());
      else if (res === "exit" || res === "quit")
        process.exit(0);
      else {
        try {
          let splitIndex = res.indexOf(" ");
          let clientId = parseInt(res.substring(0, splitIndex));
          let message = res.substring(splitIndex + 1);

          if (clientId === -1) {
            this.sendBroadcast(message);
            rl.prompt();
            return;
          }

          let foundClient = this.connectedClients.filter(v => v.port === clientId);
          if (foundClient.length === 0) {
            console.log("Invalid client index. Try to use list command");
            rl.prompt();
            return;
          }

          this.sendMessage(message, foundClient[0]);

        } catch (e) {
          console.log("Something went wrong: ");
          console.log(e);
        }
      }

      rl.prompt();
    });

    rl.prompt();
  }

  getAddressHash(clientAddress) {
    return clientAddress.address + '-' + clientAddress.port;
  }

  getConnection(clientAddress) {
    let hash = this.getAddressHash(clientAddress);
    if (!(hash in this.openConnections)) {
      let connect = net.connect(clientAddress.port, clientAddress.address).setEncoding('utf8');
      this.openConnections[hash] = connect;

      const errF = () =>
          this.connectedClients = this.connectedClients.filter(v => !(v.address === clientAddress.address && v.port === clientAddress.port));
      connect.on("error", errF);
      connect.on("close", errF);
    }

    return this.openConnections[hash];
  }

  handshakeStart(clientAddress, connection, queuedMessage = null) {
    connection.write(JSON.stringify(RPCMethods.handshakeStart(this.mePublicKeyBase64, this.serverInfo)));

    connection.on('data', (data) => {
      let request = JSON.parse(data);
      if (request.method === "handshakeFinish") {
        this.secretKeys[this.getAddressHash(clientAddress)] = this.me.computeSecret(request.params[0], "base64");
        this.sendMessage(queuedMessage, clientAddress);
      }
    })
  }

  handshakeFinish(clientAddress, connection, otherPublicKeyBase64) {
    this.secretKeys[this.getAddressHash(clientAddress)] = this.me.computeSecret(otherPublicKeyBase64, "base64");

    connection.write(JSON.stringify(RPCMethods.handshakeFinish(this.mePublicKeyBase64)));
  }

  sendBroadcast(message) {
    for (let i = 0; i < this.connectedClients.length; i++) {
      this.sendMessage(message, this.connectedClients[i]);
    }
  }

  clients2String() {
    let res = "Connected clients list: \n";

    for (let i = 0; i < this.connectedClients.length; i++) {
      res += this.connectedClients[i].port + " = " + JSON.stringify(this.connectedClients[i]) + "\n";
    }

    return res;
  }

  sendMessage(message, addressInfo) {
    let connection = this.getConnection(addressInfo);

    if (!(this.getAddressHash(addressInfo) in this.secretKeys)) {
      this.handshakeStart(addressInfo, connection, message);
    }
    else {
      const key = this.secretKeys[this.getAddressHash(addressInfo)];
      connection
          .write(JSON.stringify(RPCMethods.message(this.serverInfo, this.encryptMessage(message, key), (new Date()).getTime())))
    }
  }

  encryptMessage(message, key) {
    const IV = crypto.randomBytes(16);

    const cipher = crypto.createCipheriv('aes-256-gcm', key, IV);
    let encrypt = cipher.update(message, "utf8", "hex");
    encrypt += cipher.final('hex');

    const authTag = cipher.getAuthTag().toString("hex");

    const payload = IV.toString("hex") + encrypt + authTag;
    const payloadBase64 = Buffer.from(payload, "hex").toString("base64");

    return payloadBase64;
  }

  decryptMessage(encryptedBase64, key) {
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

  formatMessageString(from, message, time) {
    return `
NEW MESSAGE!
    From = ${from.address} - ${from.port}
    To = ${this.serverInfo.address} - ${this.serverInfo.port}
    Date = ${new Date(time)}
    Message = ${message}
`
  }
}

const client = new Client();
client.run();