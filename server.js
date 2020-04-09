const net = require("net");
const AddressInfo = require("./AddressInfo");
const RPCMethods = require("./RPCMethods");

class Server {
  serverInfo; // информация об адресе сервера
  connectedClients = []; // адреса подключенных клиентов
  openConnections = {}; // установленные соединения с клиентами
  port;

  constructor(port) {
    this.port = port;
  }

  run() {
    const server = net.createServer(connection => {
      let currentClientsServerConnection;

      connection.on('error', () => this.logout(currentClientsServerConnection));
      connection.on('close', () => this.logout(currentClientsServerConnection));

      connection.on('data', (data) => {
        let request = JSON.parse(data.toString());
        switch (request.method) {
          case "login": {
            currentClientsServerConnection = this.newLogIn(request.params[0], request.params[1]);
            this.broadcastClientsUpdated();
          } break;
        }
      });
    });

    server.listen(this.port, () => {
      this.serverInfo = new AddressInfo(server.address().address, server.address().port);

      console.info("Server started: " + this.serverInfo);
    });
  }

  newLogIn(address, port) {
    let connectionInfo = new AddressInfo(address, port);

    console.info("New connection: " + connectionInfo);

    this.connectedClients.push(connectionInfo);

    return connectionInfo;
  }

  logout(addressInfo) {
    if (this.connectedClients.filter(v => v.address === addressInfo.address && v.port === addressInfo.port).length === 0)
      return;

    this.connectedClients = this.connectedClients.filter(v => !(v.address === addressInfo.address && v.port === addressInfo.port));
    console.log("Disconnected: " + addressInfo);
    this.broadcastClientsUpdated();
  }

  getConnection(clientAddress) {
    let hash = clientAddress.address + '-' + clientAddress.port;
    if (!(hash in this.openConnections)) {
      let connect = net.connect(clientAddress.port, clientAddress.address);
      this.openConnections[hash] = connect;

      connect.on("error", () => this.logout(clientAddress));
    }
    return this.openConnections[hash];
  }

  broadcastClientsUpdated() {
    for (let i = 0; i < this.connectedClients.length; i++) {
      let clientAddress = this.connectedClients[i];
      this.getConnection(clientAddress).write(JSON.stringify(RPCMethods.updateClients(this.connectedClients)));
    }
  }
}

const server = new Server(39874);
server.run();